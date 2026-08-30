package core

import (
	"encoding/json"
)

// Dispatch routes a gated RPC command (session already validated) to its service.
// Argument shapes mirror src/services/api.ts exactly (contract-first).
func (a *App) Dispatch(command string, raw json.RawMessage) (any, error) {
	// App-level commands that manage their own locking / DB lifecycle (sync, git
	// config transfer). Everything else runs against a session snapshot below.
	switch command {
	case "sync_list_remotes":
		return a.SyncListRemotes()
	case "sync_get_config":
		return a.SyncGetConfig()
	case "sync_upsert_remote":
		var b struct {
			ID       *string `json:"id"`
			Label    *string `json:"label"`
			Provider string  `json:"provider"`
			RepoURL  string  `json:"repoUrl"`
			Username string  `json:"username"`
			Branch   string  `json:"branch"`
			Pat      *string `json:"pat"`
		}
		if err := decode(raw, &b); err != nil {
			return nil, err
		}
		return a.UpsertRemote(strOr(b.ID, ""), strOr(b.Label, ""), b.Provider, b.RepoURL, b.Username, b.Branch, b.Pat)
	case "sync_delete_remote":
		var b struct{ ID string `json:"id"` }
		if err := decode(raw, &b); err != nil {
			return nil, err
		}
		return a.DeleteRemote(b.ID)
	case "sync_set_default_remote":
		var b struct{ ID string `json:"id"` }
		if err := decode(raw, &b); err != nil {
			return nil, err
		}
		return a.SetDefaultRemote(b.ID)
	case "sync_set_config":
		var b struct {
			Provider string  `json:"provider"`
			RepoURL  string  `json:"repoUrl"`
			Username string  `json:"username"`
			Branch   string  `json:"branch"`
			Pat      *string `json:"pat"`
		}
		if err := decode(raw, &b); err != nil {
			return nil, err
		}
		return a.SetSyncConfig(b.Provider, b.RepoURL, b.Username, b.Branch, b.Pat)
	case "sync_test_connection":
		var b struct {
			Provider *string `json:"provider"`
			RepoURL  *string `json:"repoUrl"`
			Username *string `json:"username"`
			Branch   *string `json:"branch"`
			Pat      *string `json:"pat"`
			RemoteID *string `json:"remoteId"`
		}
		if err := decode(raw, &b); err != nil {
			return nil, err
		}
		return a.TestConnection(TestConnDraft{Provider: b.Provider, RepoURL: b.RepoURL, Username: b.Username, Branch: b.Branch, Pat: b.Pat, RemoteID: b.RemoteID})
	case "sync_pull":
		return a.SyncPull()
	case "sync_push":
		return a.SyncPush()
	case "sync_resolve_commit":
		return nil, errf("当前为 HTTPS 快照同步，无需选择提交；请使用「立即拉取 / 立即推送」")
	case "export_git_config_text":
		var b struct{ TransferPassword string `json:"transferPassword"` }
		if err := decode(raw, &b); err != nil {
			return nil, err
		}
		return a.ExportGitConfigText(b.TransferPassword)
	case "import_git_config_text":
		var b struct {
			BundleText       string `json:"bundleText"`
			TransferPassword string `json:"transferPassword"`
		}
		if err := decode(raw, &b); err != nil {
			return nil, err
		}
		return a.ImportGitConfigText(b.BundleText, b.TransferPassword)
	case "export_git_config", "import_git_config":
		return nil, errf("Web 版请使用「复制/粘贴加密配置」文本（无需文件路径）")
	case "export_backup", "import_backup":
		return nil, errf("Web 版备份请使用设置页的「下载备份 / 上传恢复」按钮")
	case "fetch_update_manifest", "app_prepare_exit":
		return nil, nil
	}

	var result any
	err := a.withSession(func(s *session) error {
		r, e := dispatchSession(s, command, raw)
		result = r
		return e
	})
	return result, err
}

func decode(raw json.RawMessage, v any) error {
	if len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, v)
}

func dispatchSession(s *session, command string, raw json.RawMessage) (any, error) {
	db := s.db
	switch command {

	// ---- dashboard / capture ----
	case "get_dashboard":
		prefs, err := loadPrefs(s.dataDir)
		if err != nil {
			return nil, err
		}
		return dashboard(db, prefs.Payday)
	case "quick_capture_parse":
		var a struct{ Text string `json:"text"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return parseQuickCapture(a.Text), nil

	// ---- prefs ----
	case "prefs_get":
		return loadPrefs(s.dataDir)
	case "prefs_set_payday":
		var a struct{ Payday int `json:"payday"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return setPayday(s.dataDir, a.Payday)

	// ---- tasks ----
	case "task_create":
		var a struct{ Input CreateTaskInput `json:"input"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newTaskService(db).create(a.Input)
	case "task_list":
		var a struct{ Status *string `json:"status"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newTaskService(db).list(a.Status)
	case "task_list_today":
		return newTaskService(db).listToday()
	case "task_complete":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newTaskService(db).complete(a.ID)
	case "task_delete":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return nil, newTaskService(db).delete(a.ID)
	case "task_update":
		var a struct {
			ID    string          `json:"id"`
			Input UpdateTaskInput `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newTaskService(db).update(a.ID, a.Input)

	// ---- habits (legacy table) ----
	case "habit_create":
		var a struct{ Input CreateHabitInput `json:"input"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newHabitService(db).create(a.Input)
	case "habit_list":
		return newHabitService(db).listWithStats()
	case "habit_check_in":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return nil, newHabitService(db).checkIn(a.ID)
	case "habit_uncheck":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return nil, newHabitService(db).uncheck(a.ID)
	case "habit_delete":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return nil, newHabitService(db).delete(a.ID)

	// ---- goals ----
	case "goal_list":
		gs := newGoalService(db)
		_ = gs.syncPlanReminders()
		return gs.list()
	case "goal_detail":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newGoalService(db).detail(a.ID)
	case "goal_create":
		var a struct{ Input CreateGoalInput `json:"input"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newGoalService(db).create(a.Input)
	case "goal_update":
		var a struct {
			ID    string          `json:"id"`
			Input UpdateGoalInput `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newGoalService(db).update(a.ID, a.Input)
	case "goal_delete":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return nil, newGoalService(db).delete(a.ID)
	case "goal_add_milestone":
		var a struct {
			GoalID string               `json:"goalId"`
			Input  CreateMilestoneInput `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newGoalService(db).addMilestone(a.GoalID, a.Input)
	case "goal_set_milestone_done":
		var a struct {
			MilestoneID string `json:"milestoneId"`
			Done        bool   `json:"done"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newGoalService(db).setMilestoneDone(a.MilestoneID, a.Done)
	case "goal_delete_milestone":
		var a struct{ MilestoneID string `json:"milestoneId"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newGoalService(db).deleteMilestone(a.MilestoneID)
	case "goal_add_checkin":
		var a struct {
			GoalID string             `json:"goalId"`
			Input  CreateCheckinInput `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newGoalService(db).addCheckin(a.GoalID, a.Input)
	case "goal_delete_checkin":
		var a struct{ CheckinID string `json:"checkinId"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newGoalService(db).deleteCheckin(a.CheckinID)

	// ---- finance ----
	case "finance_create":
		var a struct{ Input CreateTransactionInput `json:"input"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newFinanceService(db).create(a.Input)
	case "finance_quick_add":
		var a struct{ Text string `json:"text"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newFinanceService(db).quickAdd(a.Text)
	case "finance_update":
		var a struct {
			ID    string                 `json:"id"`
			Input UpdateTransactionInput `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newFinanceService(db).update(a.ID, a.Input)
	case "finance_list":
		var a struct{ Limit *int `json:"limit"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newFinanceService(db).list(a.Limit)
	case "finance_summary":
		prefs, err := loadPrefs(s.dataDir)
		if err != nil {
			return nil, err
		}
		return newFinanceService(db).summary(prefs.Payday)
	case "finance_confirm_pay_period":
		var a struct {
			Input struct {
				Net  *float64 `json:"net"`
				Note *string  `json:"note"`
			} `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		prefs, err := loadPrefs(s.dataDir)
		if err != nil {
			return nil, err
		}
		return newFinanceService(db).confirmPreviousSnapshot(prefs.Payday, a.Input.Net, a.Input.Note)
	case "finance_update_pay_period":
		var a struct {
			ID    string `json:"id"`
			Input struct {
				Net  *float64 `json:"net"`
				Note *string  `json:"note"`
			} `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newFinanceService(db).updateSnapshot(a.ID, a.Input.Net, a.Input.Note)
	case "finance_delete":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return nil, newFinanceService(db).delete(a.ID)
	case "finance_categories":
		return newFinanceService(db).listCategories()

	// ---- debt ----
	case "debt_overview":
		ds := newDebtService(db)
		ov, err := ds.overview()
		if err != nil {
			return nil, err
		}
		_ = ds.syncRepaymentReminders()
		return ov, nil
	case "debt_list":
		return newDebtService(db).list()
	case "debt_detail":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newDebtService(db).detail(a.ID)
	case "debt_create":
		var a struct{ Input CreateDebtInput `json:"input"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newDebtService(db).create(a.Input)
	case "debt_update":
		var a struct {
			ID    string          `json:"id"`
			Input UpdateDebtInput `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newDebtService(db).update(a.ID, a.Input)
	case "debt_delete":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return nil, newDebtService(db).delete(a.ID)
	case "debt_add_payment":
		var a struct {
			ID    string                 `json:"id"`
			Input CreateDebtPaymentInput `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newDebtService(db).addPayment(a.ID, a.Input)
	case "debt_calibrate_rate":
		var a struct {
			ID    string             `json:"id"`
			Input CalibrateRateInput `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newDebtService(db).calibrateRate(a.ID, a.Input)
	case "debt_create_plan":
		var a struct {
			ID    string                   `json:"id"`
			Input CreateRepaymentPlanInput `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newDebtService(db).createPlan(a.ID, a.Input)
	case "debt_pay_installment":
		var a struct{ InstallmentID string `json:"installmentId"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newDebtService(db).payInstallment(a.InstallmentID)

	// ---- quick notes ----
	case "quick_note_create":
		var a struct{ Input CreateQuickNoteInput `json:"input"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newQuickNoteService(db).create(a.Input)
	case "quick_note_list":
		var a struct{ Limit *int `json:"limit"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return newQuickNoteService(db).list(a.Limit)
	case "quick_note_delete":
		var a struct{ ID string `json:"id"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		return nil, newQuickNoteService(db).delete(a.ID)

	// ---- knowledge (web build allows editing regardless of platform) ----
	case "knowledge_tree":
		ks, err := newKnowledgeService(db, s.knowledgeDir)
		if err != nil {
			return nil, err
		}
		return ks.tree()
	case "knowledge_read":
		var a struct{ Path string `json:"path"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		ks, err := newKnowledgeService(db, s.knowledgeDir)
		if err != nil {
			return nil, err
		}
		return ks.read(a.Path)
	case "knowledge_create":
		var a struct{ Input CreateKnowledgeInput `json:"input"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		ks, err := newKnowledgeService(db, s.knowledgeDir)
		if err != nil {
			return nil, err
		}
		return ks.create(a.Input)
	case "knowledge_update":
		var a struct {
			Path  string               `json:"path"`
			Input UpdateKnowledgeInput `json:"input"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		ks, err := newKnowledgeService(db, s.knowledgeDir)
		if err != nil {
			return nil, err
		}
		return ks.update(a.Path, a.Input)
	case "knowledge_delete":
		var a struct{ Path string `json:"path"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		ks, err := newKnowledgeService(db, s.knowledgeDir)
		if err != nil {
			return nil, err
		}
		return nil, ks.delete(a.Path)
	case "knowledge_rename":
		var a struct {
			Path     string `json:"path"`
			NewTitle string `json:"newTitle"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		ks, err := newKnowledgeService(db, s.knowledgeDir)
		if err != nil {
			return nil, err
		}
		return ks.rename(a.Path, a.NewTitle)
	case "knowledge_list_folders":
		ks, err := newKnowledgeService(db, s.knowledgeDir)
		if err != nil {
			return nil, err
		}
		return ks.listFolders()
	case "knowledge_create_folder":
		var a struct{ Name string `json:"name"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		ks, err := newKnowledgeService(db, s.knowledgeDir)
		if err != nil {
			return nil, err
		}
		return ks.createFolder(a.Name)
	case "knowledge_rename_folder":
		var a struct {
			From string `json:"from"`
			To   string `json:"to"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		ks, err := newKnowledgeService(db, s.knowledgeDir)
		if err != nil {
			return nil, err
		}
		return ks.renameFolder(a.From, a.To)
	case "knowledge_delete_folder":
		var a struct{ Name string `json:"name"` }
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		ks, err := newKnowledgeService(db, s.knowledgeDir)
		if err != nil {
			return nil, err
		}
		return nil, ks.deleteFolder(a.Name)

	// ---- search ----
	case "search_query":
		var a struct {
			Query string `json:"query"`
			Limit *int   `json:"limit"`
		}
		if err := decode(raw, &a); err != nil {
			return nil, err
		}
		limit := 20
		if a.Limit != nil {
			limit = *a.Limit
		}
		return newSearchService(db).search(a.Query, limit)

	default:
		return nil, errf("未知命令：%s", command)
	}
}

// ---- sync views built from the in-memory vault (no network) ----

type syncRemoteView struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	DisplayLabel string `json:"displayLabel"`
	Provider     string `json:"provider"`
	RepoURL      string `json:"repoUrl"`
	Username     string `json:"username"`
	Branch       string `json:"branch"`
	HasPat       bool   `json:"hasPat"`
	IsDefault    bool   `json:"isDefault"`
}

type syncRemotesViewT struct {
	Remotes            []syncRemoteView `json:"remotes"`
	DefaultRemoteID    *string          `json:"defaultRemoteId"`
	NeedsDefaultRemote bool             `json:"needsDefaultRemote"`
}

func syncRemotesView(v *VaultFile) syncRemotesViewT {
	out := syncRemotesViewT{Remotes: []syncRemoteView{}}
	if v == nil {
		return out
	}
	sole := len(v.Remotes) == 1
	out.DefaultRemoteID = v.DefaultRemoteID
	out.NeedsDefaultRemote = len(v.Remotes) > 1 && v.DefaultRemoteID == nil
	for _, r := range v.Remotes {
		isDefault := sole || (v.DefaultRemoteID != nil && *v.DefaultRemoteID == r.ID)
		out.Remotes = append(out.Remotes, syncRemoteView{
			ID: r.ID, Label: r.Label, DisplayLabel: r.Label, Provider: r.Provider,
			RepoURL: r.RepoURL, Username: r.Username, Branch: r.Branch, HasPat: r.HasPat, IsDefault: isDefault,
		})
	}
	return out
}

type syncConfigViewT struct {
	ID       *string `json:"id"`
	Label    string  `json:"label"`
	Provider string  `json:"provider"`
	RepoURL  string  `json:"repoUrl"`
	Username string  `json:"username"`
	Branch   string  `json:"branch"`
	HasPat   bool    `json:"hasPat"`
}

func syncGetConfigView(v *VaultFile) syncConfigViewT {
	def := syncConfigViewT{Provider: "github", Branch: "main"}
	if v == nil || len(v.Remotes) == 0 {
		return def
	}
	var r *SyncRemoteConfig
	if len(v.Remotes) == 1 {
		r = &v.Remotes[0]
	} else if v.DefaultRemoteID != nil {
		for i := range v.Remotes {
			if v.Remotes[i].ID == *v.DefaultRemoteID {
				r = &v.Remotes[i]
				break
			}
		}
	}
	if r == nil {
		return def
	}
	return syncConfigViewT{ID: &r.ID, Label: r.Label, Provider: r.Provider, RepoURL: r.RepoURL, Username: r.Username, Branch: r.Branch, HasPat: r.HasPat}
}
