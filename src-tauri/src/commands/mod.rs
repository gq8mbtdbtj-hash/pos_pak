use crate::error::AppResult;
use crate::models::debt::{
    CalibrateRateInput, CalibrateRateResult, CreateDebtInput, CreateDebtPaymentInput,
    CreateRepaymentPlanInput, Debt, DebtDetail, DebtOverview, RepaymentPlan, UpdateDebtInput,
};
use crate::models::finance::{
    CreateTransactionInput, FinanceSummary, Transaction, UpdateTransactionInput,
};
use crate::models::habit::{CreateHabitInput, HabitWithStats};
use crate::models::goal::{
    CreateGoalInput, CreateMilestoneInput, Goal, GoalDetail, UpdateGoalInput,
};
use crate::models::knowledge::{
    CreateKnowledgeInput, KnowledgeFile, KnowledgeTreeNode, UpdateKnowledgeInput,
};
use crate::models::quick_note::{CreateQuickNoteInput, QuickNote};
use crate::models::search::{DashboardStats, SearchResult};
use crate::models::task::{CreateTaskInput, Task, UpdateTaskInput};
use crate::services::backup::BackupService;
use crate::services::debt::DebtService;
use crate::services::finance::FinanceService;
use crate::services::git_sync::{GitSyncService, SyncPullResult};
use crate::services::habit::HabitService;
use crate::services::goal::GoalService;
use crate::services::knowledge::KnowledgeService;
use crate::services::profile::ProfileService;
use crate::services::quick_capture::{parse_quick_capture, QuickCaptureResult};
use crate::services::quick_note::QuickNoteService;
use crate::services::remember;
use crate::services::search::SearchService;
use crate::services::sync_https::HttpsGitHostTransport;
use crate::services::sync_pack::SyncPackService;
use crate::services::task::TaskService;
use crate::services::vault::{VaultService, VaultStatus};
use crate::AppState;
use serde::Serialize;
use tauri::State;

fn remember_mask(state: &AppState) -> Option<String> {
    remember::load(&state.root_dir)
        .ok()
        .flatten()
        .map(|r| r.password_mask)
}

fn current_status(state: &AppState) -> AppResult<VaultStatus> {
    let can_auto = remember::exists(&state.root_dir);
    // Skip decrypting remember (mask) unless UI needs it — faster locked peeks.
    let mask = if can_auto {
        remember_mask(state)
    } else {
        None
    };
    if state.is_unlocked() {
        return state.with_session(|s| {
            VaultService::new(&s.data_dir).status_with_meta(
                true,
                Some(s.profile_id.clone()),
                can_auto,
                mask.clone(),
            )
        });
    }
    let initialized = ProfileService::has_any_profile(&state.root_dir)?;
    Ok(VaultStatus {
        initialized,
        unlocked: false,
        device_id: None,
        sync_configured: false,
        provider: None,
        repo_url: None,
        username: None,
        branch: None,
        has_pat: false,
        remote_count: 0,
        default_remote_id: None,
        needs_default_remote: false,
        last_sync_at: None,
        last_revision: None,
        last_content_hash: None,
        can_auto_unlock: can_auto,
        profile_id: None,
        password_mask: mask,
    })
}

#[tauri::command]
pub fn vault_status(state: State<AppState>) -> AppResult<VaultStatus> {
    current_status(&state)
}

#[tauri::command]
pub fn vault_try_auto_unlock(state: State<AppState>) -> AppResult<VaultStatus> {
    let _ = state.try_auto_unlock()?;
    current_status(&state)
}

#[tauri::command]
pub fn vault_init(state: State<AppState>, password: String) -> AppResult<VaultStatus> {
    state.init_and_open(&password)?;
    current_status(&state)
}

#[tauri::command]
pub fn vault_unlock(state: State<AppState>, password: String) -> AppResult<VaultStatus> {
    state.open_session(&password)?;
    current_status(&state)
}

#[tauri::command]
pub fn vault_lock(state: State<AppState>) -> AppResult<VaultStatus> {
    // Soft lock: keep remember so next launch can auto-unlock
    state.lock()?;
    current_status(&state)
}

#[tauri::command]
pub fn vault_logout(state: State<AppState>) -> AppResult<VaultStatus> {
    state.logout()?;
    current_status(&state)
}

/// Seal DB quickly on exit. Sync push is intentional (Settings), not on close —
/// blocking upload made the app feel frozen.
pub fn run_prepare_exit(state: &AppState) -> AppResult<()> {
    if !state.is_unlocked() {
        return Ok(());
    }
    let _ = state.lock();
    Ok(())
}

#[tauri::command]
pub fn app_prepare_exit(state: State<AppState>) -> AppResult<()> {
    run_prepare_exit(&state)
}

#[tauri::command]
pub fn vault_change_password(
    state: State<AppState>,
    old_password: String,
    new_password: String,
) -> AppResult<VaultStatus> {
    let data_dir = state.with_session(|session| {
        session.db.checkpoint()?;
        Ok(session.data_dir.clone())
    })?;
    let vault_svc = VaultService::new(&data_dir);
    let new_keys = vault_svc.change_password(&old_password, &new_password)?;
    crate::services::db_crypto::seal_database_file(&data_dir, &new_keys.db_key)?;
    {
        let mut guard = state
            .session
            .lock()
            .map_err(|e| crate::error::AppError::Other(e.to_string()))?;
        *guard = None;
    }
    state.open_session(&new_password)?;
    current_status(&state)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRemoteView {
    pub id: String,
    pub label: String,
    pub display_label: String,
    pub provider: String,
    pub repo_url: String,
    pub username: String,
    pub branch: String,
    pub has_pat: bool,
    pub is_default: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRemotesView {
    pub remotes: Vec<SyncRemoteView>,
    pub default_remote_id: Option<String>,
    pub needs_default_remote: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfigView {
    pub id: Option<String>,
    pub label: String,
    pub provider: String,
    pub repo_url: String,
    pub username: String,
    pub branch: String,
    pub has_pat: bool,
}

fn refresh_session_vault(state: &AppState) {
    if let Ok(mut guard) = state.session.lock() {
        if let Some(session) = guard.as_mut() {
            if let Ok(v) = VaultService::new(&session.data_dir).load() {
                // Prefer portable sync key stored in vault (from Git config import).
                let _ = VaultService::apply_portable_sync_key(&v, &mut session.keys);
                // Fallback: re-derive from remembered password + sync salt.
                if v.sync_key_wrapped_b64.is_none() {
                    if let Ok(Some(saved)) = remember::load(&state.root_dir) {
                        if let Ok((_, keys)) =
                            VaultService::new(&session.data_dir).unlock(&saved.password)
                        {
                            session.keys = keys;
                        }
                    }
                }
                session.vault = v;
            }
        }
    }
}

fn remotes_view(state: &AppState) -> AppResult<SyncRemotesView> {
    state.with_session(|s| {
        let (remotes, default_remote_id) = VaultService::new(&s.data_dir).list_remotes()?;
        let needs_default_remote = remotes.len() > 1 && default_remote_id.is_none();
        let sole = remotes.len() == 1;
        let views = remotes
            .into_iter()
            .map(|r| {
                let is_default = sole || default_remote_id.as_deref() == Some(r.id.as_str());
                SyncRemoteView {
                    display_label: r.display_label(),
                    is_default,
                    id: r.id,
                    label: r.label,
                    provider: r.provider,
                    repo_url: r.repo_url,
                    username: r.username,
                    branch: r.branch,
                    has_pat: r.has_pat,
                }
            })
            .collect::<Vec<_>>();
        Ok(SyncRemotesView {
            remotes: views,
            default_remote_id,
            needs_default_remote,
        })
    })
}

#[tauri::command]
pub fn sync_list_remotes(state: State<AppState>) -> AppResult<SyncRemotesView> {
    remotes_view(&state)
}

#[tauri::command]
pub fn sync_get_config(state: State<AppState>) -> AppResult<SyncConfigView> {
    state.with_session(|s| {
        let v = VaultService::new(&s.data_dir).load()?;
        if v.remotes.is_empty() {
            return Ok(SyncConfigView {
                id: None,
                label: String::new(),
                provider: "github".into(),
                repo_url: String::new(),
                username: String::new(),
                branch: "main".into(),
                has_pat: false,
            });
        }
        let remote = if v.remotes.len() == 1 {
            Some(&v.remotes[0])
        } else {
            v.default_remote_id
                .as_ref()
                .and_then(|id| v.remotes.iter().find(|r| &r.id == id))
        };
        let Some(remote) = remote else {
            return Ok(SyncConfigView {
                id: None,
                label: String::new(),
                provider: "github".into(),
                repo_url: String::new(),
                username: String::new(),
                branch: "main".into(),
                has_pat: false,
            });
        };
        Ok(SyncConfigView {
            id: Some(remote.id.clone()),
            label: remote.label.clone(),
            provider: remote.provider.clone(),
            repo_url: remote.repo_url.clone(),
            username: remote.username.clone(),
            branch: remote.branch.clone(),
            has_pat: remote.has_pat,
        })
    })
}

#[tauri::command]
pub fn sync_upsert_remote(
    state: State<AppState>,
    id: Option<String>,
    label: Option<String>,
    provider: String,
    repo_url: String,
    username: String,
    branch: String,
    pat: Option<String>,
) -> AppResult<SyncRemotesView> {
    state.with_session(|session| {
        VaultService::new(&session.data_dir).upsert_remote(
            &session.keys,
            id,
            label.unwrap_or_default(),
            provider,
            repo_url,
            username,
            branch,
            pat,
        )?;
        Ok(())
    })?;
    refresh_session_vault(&state);
    remotes_view(&state)
}

#[tauri::command]
pub fn sync_delete_remote(state: State<AppState>, id: String) -> AppResult<SyncRemotesView> {
    state.with_session(|session| {
        VaultService::new(&session.data_dir).delete_remote(&id)?;
        Ok(())
    })?;
    refresh_session_vault(&state);
    remotes_view(&state)
}

#[tauri::command]
pub fn sync_set_default_remote(state: State<AppState>, id: String) -> AppResult<SyncRemotesView> {
    state.with_session(|session| {
        VaultService::new(&session.data_dir).set_default_remote(&id)?;
        Ok(())
    })?;
    refresh_session_vault(&state);
    remotes_view(&state)
}

#[tauri::command]
pub fn sync_set_config(
    state: State<AppState>,
    provider: String,
    repo_url: String,
    username: String,
    branch: String,
    pat: Option<String>,
) -> AppResult<VaultStatus> {
    state.with_session(|session| {
        VaultService::new(&session.data_dir).set_sync_config(
            &session.keys,
            provider,
            repo_url,
            username,
            branch,
            pat,
        )?;
        Ok(())
    })?;
    refresh_session_vault(&state);
    current_status(&state)
}

#[tauri::command]
pub fn sync_test_connection(
    state: State<AppState>,
    provider: Option<String>,
    repo_url: Option<String>,
    username: Option<String>,
    branch: Option<String>,
    pat: Option<String>,
    remote_id: Option<String>,
) -> AppResult<String> {
    use crate::services::vault::SyncRemoteConfig;

    state.with_session(|session| {
        let vault_svc = VaultService::new(&session.data_dir);
        let vault = vault_svc.load()?;
        let draft_url = repo_url.unwrap_or_default();
        let draft_user = username.unwrap_or_default();
        let draft_branch = branch.unwrap_or_default();
        let draft_provider = provider.unwrap_or_default();
        let draft_pat = pat.unwrap_or_default();

        let base = if let Some(rid) = remote_id.as_deref().filter(|s| !s.is_empty()) {
            vault
                .remotes
                .iter()
                .find(|r| r.id == rid)
                .cloned()
                .ok_or_else(|| crate::error::AppError::Other("远端不存在".into()))?
        } else if vault.remotes.len() == 1 {
            vault.remotes[0].clone()
        } else if let Ok(active) = vault.active_remote() {
            active.clone()
        } else {
            SyncRemoteConfig {
                id: String::new(),
                label: String::new(),
                provider: "github".into(),
                repo_url: String::new(),
                username: String::new(),
                branch: "main".into(),
                pat_ciphertext_b64: None,
                has_pat: false,
            }
        };

        let remote = SyncRemoteConfig {
            id: base.id.clone(),
            label: base.label.clone(),
            provider: if draft_provider.trim().is_empty() {
                base.provider
            } else {
                draft_provider.trim().to_string()
            },
            repo_url: if draft_url.trim().is_empty() {
                base.repo_url
            } else {
                draft_url.trim().to_string()
            },
            username: if draft_user.trim().is_empty() {
                base.username
            } else {
                draft_user.trim().to_string()
            },
            branch: {
                let b = if draft_branch.trim().is_empty() {
                    base.branch
                } else {
                    draft_branch.trim().to_string()
                };
                if b.is_empty() {
                    "main".into()
                } else {
                    b
                }
            },
            pat_ciphertext_b64: base.pat_ciphertext_b64,
            has_pat: base.has_pat,
        };

        if remote.repo_url.is_empty() {
            return Err(crate::error::AppError::Other(
                "请先填写仓库 HTTPS URL".into(),
            ));
        }

        let token = if !draft_pat.trim().is_empty() {
            draft_pat.trim().to_string()
        } else {
            vault_svc
                .decrypt_remote_pat(&remote, &session.keys)?
                .or_else(|| {
                    vault_svc
                        .decrypt_pat(&vault, &session.keys)
                        .ok()
                        .flatten()
                })
                .ok_or_else(|| {
                    crate::error::AppError::Other("请填写 PAT（或先保存过令牌）".into())
                })?
        };

        let transport = HttpsGitHostTransport::new();
        let msg = transport.test_connection(&remote, &token)?;
        Ok(format!("{msg}。确认无误后可点击「保存配置」"))
    })
}

fn do_sync_pull(state: &AppState) -> AppResult<SyncPullResult> {
    let (result, pulled) = state.with_session(|session| {
        let vault_svc = VaultService::new(&session.data_dir);
        let vault = vault_svc.load()?;
        let remote = vault.active_remote()?.clone();
        let pat = vault_svc
            .decrypt_remote_pat(&remote, &session.keys)?
            .ok_or_else(|| crate::error::AppError::Other("未配置 PAT".into()))?;
        let local_hash = vault.last_content_hash.clone();
        let transport = HttpsGitHostTransport::new();
        transport.pull_result(&remote, &pat, local_hash.as_deref())
    })?;

    if result.status == "updated" {
        if let Some(pulled) = pulled {
            state.apply_remote_pack_bytes(&pulled.ciphertext, &pulled.manifest)?;
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn sync_pull(state: State<AppState>) -> AppResult<SyncPullResult> {
    do_sync_pull(&state)
}

#[tauri::command]
pub fn sync_resolve_commit(state: State<AppState>, commit_id: String) -> AppResult<SyncPullResult> {
    let _ = (state, commit_id);
    Err(crate::error::AppError::Other(
        "当前为 HTTPS 快照同步，无需选择提交；请使用「立即拉取 / 立即推送」".into(),
    ))
}

fn do_sync_push(state: &AppState) -> AppResult<SyncPullResult> {
    let pull = do_sync_pull(state)?;
    if pull.status == "conflict" {
        return Ok(pull);
    }

    state.with_session(|session| {
        let _ = session.db.checkpoint();
        crate::services::db_crypto::seal_database_file(&session.data_dir, &session.keys.db_key)?;

        let vault_svc = VaultService::new(&session.data_dir);
        let vault = vault_svc.load()?;
        let remote = vault.active_remote()?.clone();
        let pat = vault_svc
            .decrypt_remote_pat(&remote, &session.keys)?
            .ok_or_else(|| crate::error::AppError::Other("未配置 PAT".into()))?;

        let pack = SyncPackService::new(session.data_dir.clone());
        let (ciphertext, manifest) =
            pack.build_encrypted_pack(&session.keys.sync_key, &vault.device_id)?;

        let transport = HttpsGitHostTransport::new();
        // Only skip upload when the *remote* already has this content hash.
        // Local last_content_hash alone is not enough (e.g. prior failed/partial pushes).
        let remote_hash = transport.remote_content_hash(&remote, &pat)?;
        if remote_hash.as_deref() == Some(manifest.content_hash.as_str()) {
            vault_svc.update_sync_meta(
                Some(chrono::Utc::now().to_rfc3339()),
                Some(manifest.revision.clone()),
                Some(manifest.content_hash.clone()),
            )?;
            return Ok(SyncPullResult {
                status: "up_to_date".into(),
                revision: Some(manifest.revision),
                content_hash: Some(manifest.content_hash),
                conflict: None,
            });
        }

        let rev = transport.push_pack(&remote, &pat, &ciphertext, &manifest)?;

        // Verify remote actually has the pack (catches silent/wrong-branch failures).
        let verified = transport.remote_content_hash(&remote, &pat)?;
        if verified.as_deref() != Some(manifest.content_hash.as_str()) {
            return Err(crate::error::AppError::Other(format!(
                "推送未生效：远端未见 sync/manifest.json（请确认分支为「{}」，Gitee 空仓常见默认分支是 master）",
                remote.branch
            )));
        }

        let git = GitSyncService::new(&session.data_dir);
        let _ = std::fs::create_dir_all(git.repo_dir().join("sync"));
        let _ = pack.write_pack_files(git.repo_dir(), &ciphertext, &manifest);

        vault_svc.update_sync_meta(
            Some(chrono::Utc::now().to_rfc3339()),
            Some(rev.clone()),
            Some(manifest.content_hash.clone()),
        )?;
        Ok(SyncPullResult {
            status: "pushed".into(),
            revision: Some(rev),
            content_hash: Some(manifest.content_hash),
            conflict: None,
        })
    })
}

#[tauri::command]
pub fn sync_push(state: State<AppState>) -> AppResult<SyncPullResult> {
    do_sync_push(&state)
}

#[tauri::command]
pub fn get_dashboard(state: State<AppState>) -> AppResult<DashboardStats> {
    state.with_session(|s| SearchService::new(&s.db).dashboard())
}

#[tauri::command]
pub fn quick_capture_parse(text: String) -> QuickCaptureResult {
    parse_quick_capture(&text)
}

#[tauri::command]
pub fn task_create(state: State<AppState>, input: CreateTaskInput) -> AppResult<Task> {
    state.with_session(|s| TaskService::new(&s.db).create(input))
}

#[tauri::command]
pub fn task_list(state: State<AppState>, status: Option<String>) -> AppResult<Vec<Task>> {
    state.with_session(|s| TaskService::new(&s.db).list(status.as_deref()))
}

#[tauri::command]
pub fn task_list_today(state: State<AppState>) -> AppResult<Vec<Task>> {
    state.with_session(|s| TaskService::new(&s.db).list_today())
}

#[tauri::command]
pub fn task_update(state: State<AppState>, id: String, input: UpdateTaskInput) -> AppResult<Task> {
    state.with_session(|s| TaskService::new(&s.db).update(&id, input))
}

#[tauri::command]
pub fn task_complete(state: State<AppState>, id: String) -> AppResult<Task> {
    state.with_session(|s| TaskService::new(&s.db).complete(&id))
}

#[tauri::command]
pub fn task_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.with_session(|s| TaskService::new(&s.db).delete(&id))
}

#[tauri::command]
pub fn habit_create(
    state: State<AppState>,
    input: CreateHabitInput,
) -> AppResult<crate::models::habit::Habit> {
    state.with_session(|s| HabitService::new(&s.db).create(input))
}

#[tauri::command]
pub fn habit_list(state: State<AppState>) -> AppResult<Vec<HabitWithStats>> {
    state.with_session(|s| HabitService::new(&s.db).list_with_stats())
}

#[tauri::command]
pub fn habit_check_in(state: State<AppState>, id: String) -> AppResult<()> {
    state.with_session(|s| {
        HabitService::new(&s.db).check_in(&id, None)?;
        Ok(())
    })
}

#[tauri::command]
pub fn habit_uncheck(state: State<AppState>, id: String) -> AppResult<()> {
    state.with_session(|s| HabitService::new(&s.db).uncheck(&id, None))
}

fn reject_mobile_knowledge_edit(platform: Option<&str>) -> AppResult<()> {
    if platform.is_some_and(|p| p.eq_ignore_ascii_case("mobile")) {
        return Err(crate::error::AppError::Other(
            "移动端知识库仅支持查看与问答，编辑请在桌面端操作".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn habit_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.with_session(|s| HabitService::new(&s.db).delete(&id))
}

#[tauri::command]
pub fn goal_list(state: State<AppState>) -> AppResult<Vec<Goal>> {
    state.with_session(|s| GoalService::new(&s.db).list())
}

#[tauri::command]
pub fn goal_detail(state: State<AppState>, id: String) -> AppResult<GoalDetail> {
    state.with_session(|s| GoalService::new(&s.db).detail(&id))
}

#[tauri::command]
pub fn goal_create(state: State<AppState>, input: CreateGoalInput) -> AppResult<Goal> {
    state.with_session(|s| GoalService::new(&s.db).create(input))
}

#[tauri::command]
pub fn goal_update(
    state: State<AppState>,
    id: String,
    input: UpdateGoalInput,
) -> AppResult<Goal> {
    state.with_session(|s| GoalService::new(&s.db).update(&id, input))
}

#[tauri::command]
pub fn goal_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.with_session(|s| GoalService::new(&s.db).delete(&id))
}

#[tauri::command]
pub fn goal_add_milestone(
    state: State<AppState>,
    goal_id: String,
    input: CreateMilestoneInput,
) -> AppResult<GoalDetail> {
    state.with_session(|s| GoalService::new(&s.db).add_milestone(&goal_id, input))
}

#[tauri::command]
pub fn goal_set_milestone_done(
    state: State<AppState>,
    milestone_id: String,
    done: bool,
) -> AppResult<GoalDetail> {
    state.with_session(|s| GoalService::new(&s.db).set_milestone_done(&milestone_id, done))
}

#[tauri::command]
pub fn goal_delete_milestone(
    state: State<AppState>,
    milestone_id: String,
) -> AppResult<GoalDetail> {
    state.with_session(|s| GoalService::new(&s.db).delete_milestone(&milestone_id))
}

#[tauri::command]
pub fn finance_create(
    state: State<AppState>,
    input: CreateTransactionInput,
) -> AppResult<Transaction> {
    state.with_session(|s| FinanceService::new(&s.db).create(input))
}

#[tauri::command]
pub fn finance_quick_add(state: State<AppState>, text: String) -> AppResult<Transaction> {
    state.with_session(|s| FinanceService::new(&s.db).quick_add(&text))
}

#[tauri::command]
pub fn finance_update(
    state: State<AppState>,
    id: String,
    input: UpdateTransactionInput,
) -> AppResult<Transaction> {
    state.with_session(|s| FinanceService::new(&s.db).update(&id, input))
}

#[tauri::command]
pub fn finance_list(state: State<AppState>, limit: Option<i32>) -> AppResult<Vec<Transaction>> {
    state.with_session(|s| FinanceService::new(&s.db).list(limit))
}

#[tauri::command]
pub fn finance_summary(state: State<AppState>) -> AppResult<FinanceSummary> {
    state.with_session(|s| FinanceService::new(&s.db).summary())
}

#[tauri::command]
pub fn finance_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.with_session(|s| FinanceService::new(&s.db).delete(&id))
}

#[tauri::command]
pub fn finance_categories(state: State<AppState>) -> AppResult<Vec<String>> {
    state.with_session(|s| Ok(FinanceService::new(&s.db).default_categories()))
}

#[tauri::command]
pub fn debt_overview(state: State<AppState>) -> AppResult<DebtOverview> {
    state.with_session(|s| {
        let svc = DebtService::new(&s.db);
        let overview = svc.overview()?;
        let _ = svc.sync_repayment_reminders();
        Ok(overview)
    })
}

#[tauri::command]
pub fn debt_list(state: State<AppState>) -> AppResult<Vec<Debt>> {
    state.with_session(|s| DebtService::new(&s.db).list())
}

#[tauri::command]
pub fn debt_detail(state: State<AppState>, id: String) -> AppResult<DebtDetail> {
    state.with_session(|s| DebtService::new(&s.db).detail(&id))
}

#[tauri::command]
pub fn debt_create(state: State<AppState>, input: CreateDebtInput) -> AppResult<Debt> {
    state.with_session(|s| DebtService::new(&s.db).create(input))
}

#[tauri::command]
pub fn debt_update(
    state: State<AppState>,
    id: String,
    input: UpdateDebtInput,
) -> AppResult<Debt> {
    state.with_session(|s| DebtService::new(&s.db).update(&id, input))
}

#[tauri::command]
pub fn debt_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.with_session(|s| DebtService::new(&s.db).delete(&id))
}

#[tauri::command]
pub fn debt_add_payment(
    state: State<AppState>,
    id: String,
    input: CreateDebtPaymentInput,
) -> AppResult<Debt> {
    state.with_session(|s| DebtService::new(&s.db).add_payment(&id, input))
}

#[tauri::command]
pub fn debt_calibrate_rate(
    state: State<AppState>,
    id: String,
    input: CalibrateRateInput,
) -> AppResult<CalibrateRateResult> {
    state.with_session(|s| DebtService::new(&s.db).calibrate_rate(&id, input))
}

#[tauri::command]
pub fn debt_create_plan(
    state: State<AppState>,
    id: String,
    input: CreateRepaymentPlanInput,
) -> AppResult<RepaymentPlan> {
    state.with_session(|s| DebtService::new(&s.db).create_plan(&id, input))
}

#[tauri::command]
pub fn debt_pay_installment(
    state: State<AppState>,
    installment_id: String,
) -> AppResult<DebtDetail> {
    state.with_session(|s| DebtService::new(&s.db).pay_installment(&installment_id))
}

#[tauri::command]
pub fn quick_note_create(
    state: State<AppState>,
    input: CreateQuickNoteInput,
) -> AppResult<QuickNote> {
    state.with_session(|s| QuickNoteService::new(&s.db).create(input))
}

#[tauri::command]
pub fn quick_note_list(state: State<AppState>, limit: Option<i32>) -> AppResult<Vec<QuickNote>> {
    state.with_session(|s| QuickNoteService::new(&s.db).list(limit))
}

#[tauri::command]
pub fn quick_note_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.with_session(|s| QuickNoteService::new(&s.db).delete(&id))
}

#[tauri::command]
pub fn knowledge_tree(state: State<AppState>) -> AppResult<KnowledgeTreeNode> {
    state.with_session(|s| KnowledgeService::new(&s.db, s.knowledge_dir.clone())?.tree())
}

#[tauri::command]
pub fn knowledge_read(state: State<AppState>, path: String) -> AppResult<KnowledgeFile> {
    state.with_session(|s| KnowledgeService::new(&s.db, s.knowledge_dir.clone())?.read(&path))
}

#[tauri::command]
pub fn knowledge_create(
    state: State<AppState>,
    input: CreateKnowledgeInput,
    platform: Option<String>,
) -> AppResult<KnowledgeFile> {
    reject_mobile_knowledge_edit(platform.as_deref())?;
    state.with_session(|s| KnowledgeService::new(&s.db, s.knowledge_dir.clone())?.create(input))
}

#[tauri::command]
pub fn knowledge_update(
    state: State<AppState>,
    path: String,
    input: UpdateKnowledgeInput,
    platform: Option<String>,
) -> AppResult<KnowledgeFile> {
    reject_mobile_knowledge_edit(platform.as_deref())?;
    state.with_session(|s| {
        KnowledgeService::new(&s.db, s.knowledge_dir.clone())?.update(&path, input)
    })
}

#[tauri::command]
pub fn knowledge_delete(
    state: State<AppState>,
    path: String,
    platform: Option<String>,
) -> AppResult<()> {
    reject_mobile_knowledge_edit(platform.as_deref())?;
    state.with_session(|s| KnowledgeService::new(&s.db, s.knowledge_dir.clone())?.delete(&path))
}

#[tauri::command]
pub fn knowledge_rename(
    state: State<AppState>,
    path: String,
    new_title: String,
    platform: Option<String>,
) -> AppResult<KnowledgeFile> {
    reject_mobile_knowledge_edit(platform.as_deref())?;
    state.with_session(|s| {
        KnowledgeService::new(&s.db, s.knowledge_dir.clone())?.rename(&path, &new_title)
    })
}

#[tauri::command]
pub fn search_query(
    state: State<AppState>,
    query: String,
    limit: Option<i32>,
) -> AppResult<Vec<SearchResult>> {
    state.with_session(|s| SearchService::new(&s.db).search(&query, limit.unwrap_or(20)))
}

#[tauri::command]
pub fn export_backup(state: State<AppState>, output_path: String) -> AppResult<()> {
    state.with_session(|s| {
        let _ = s.db.checkpoint();
        crate::services::db_crypto::seal_database_file(&s.data_dir, &s.keys.db_key)?;
        BackupService::new(s.data_dir.clone()).export(std::path::Path::new(&output_path))
    })
}

#[tauri::command]
pub fn import_backup(state: State<AppState>, input_path: String) -> AppResult<()> {
    state.import_local_backup(std::path::Path::new(&input_path))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConfigImportResult {
    pub imported: bool,
    pub sync: Option<SyncPullResult>,
    /// Present when config saved but sync skipped/failed (e.g. Android has no git).
    pub sync_note: Option<String>,
}

#[tauri::command]
pub fn export_git_config(
    state: State<AppState>,
    output_path: String,
    transfer_password: String,
) -> AppResult<()> {
    state.with_session(|s| {
        let vault_svc = VaultService::new(&s.data_dir);
        let vault = vault_svc.load()?;
        crate::services::git_config_bundle::GitConfigBundle::export_to_file(
            &vault_svc,
            &vault,
            &s.keys,
            std::path::Path::new(&output_path),
            &transfer_password,
        )
    })
}

#[tauri::command]
pub fn export_git_config_text(
    state: State<AppState>,
    transfer_password: String,
) -> AppResult<String> {
    state.with_session(|s| {
        let vault_svc = VaultService::new(&s.data_dir);
        let vault = vault_svc.load()?;
        crate::services::git_config_bundle::GitConfigBundle::export_text(
            &vault_svc,
            &vault,
            &s.keys,
            &transfer_password,
        )
    })
}

fn apply_git_config_import(
    state: &AppState,
    raw_or_path: &str,
    transfer_password: &str,
    from_file: bool,
) -> AppResult<GitConfigImportResult> {
    let imported_key = state.with_session(|s| {
        let vault_svc = VaultService::new(&s.data_dir);
        let (_vault, sync_key) = if from_file {
            crate::services::git_config_bundle::GitConfigBundle::import_from_file(
                &vault_svc,
                &s.keys,
                std::path::Path::new(raw_or_path),
                transfer_password,
            )?
        } else {
            crate::services::git_config_bundle::GitConfigBundle::import_from_text(
                &vault_svc,
                &s.keys,
                raw_or_path,
                transfer_password,
            )?
        };
        Ok(sync_key)
    })?;

    // Apply imported sync key to live session immediately.
    if let Some(sk) = imported_key {
        if let Ok(mut guard) = state.session.lock() {
            if let Some(session) = guard.as_mut() {
                session.keys.sync_key.copy_from_slice(&sk);
                if let Ok(v) = VaultService::new(&session.data_dir).load() {
                    session.vault = v;
                }
            }
        }
    } else {
        refresh_session_vault(state);
    }

    Ok(GitConfigImportResult {
        imported: true,
        sync: None,
        sync_note: Some(
            "配置已导入。启动不会自动同步，请用左下角「拉 / 推」手动同步。".into(),
        ),
    })
}

#[tauri::command]
pub fn import_git_config(
    state: State<AppState>,
    input_path: String,
    transfer_password: String,
) -> AppResult<GitConfigImportResult> {
    apply_git_config_import(&state, &input_path, &transfer_password, true)
}

#[tauri::command]
pub fn import_git_config_text(
    state: State<AppState>,
    bundle_text: String,
    transfer_password: String,
) -> AppResult<GitConfigImportResult> {
    apply_git_config_import(&state, &bundle_text, &transfer_password, false)
}
