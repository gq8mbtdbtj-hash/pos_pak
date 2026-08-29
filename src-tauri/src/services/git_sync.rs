use crate::error::{AppError, AppResult};
use crate::services::vault::SyncRemoteConfig;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub author: String,
    pub time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub message: String,
    pub commits: Vec<GitCommitInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPullResult {
    pub status: String, // up_to_date | updated | conflict | empty
    pub revision: Option<String>,
    pub content_hash: Option<String>,
    pub conflict: Option<SyncConflict>,
}

pub struct GitSyncService {
    repo_dir: PathBuf,
}

impl GitSyncService {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            repo_dir: data_dir.join("sync-repo"),
        }
    }

    pub fn repo_dir(&self) -> &Path {
        &self.repo_dir
    }

    pub fn test_connection(&self, remote: &SyncRemoteConfig, pat: &str) -> AppResult<String> {
        if remote.repo_url.trim().is_empty() {
            return Err(AppError::Other("请先填写并保存仓库 URL".into()));
        }
        if pat.is_empty() {
            return Err(AppError::Other("请先填写并保存访问令牌 PAT".into()));
        }
        let url = auth_url(&remote.repo_url, &remote.username, pat)?;
        let branch = default_branch(remote);
        let output = Command::new("git")
            .args(["ls-remote", "--heads", &url, &branch])
            .output()
            .map_err(|e| {
                AppError::Other(format!("无法执行 git：{e}。请确认已安装 Git 并在 PATH 中。"))
            })?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            let out = String::from_utf8_lossy(&output.stdout);
            let detail = format!("{} {}", err.trim(), out.trim())
                .trim()
                .to_string();
            let hint = if detail.to_lowercase().contains("authentication")
                || detail.contains("403")
                || detail.contains("401")
                || detail.contains("denied")
            {
                "认证失败，请检查用户名与 PAT 权限"
            } else if detail.contains("not found") || detail.contains("404") {
                "仓库不存在或无权访问，请检查 URL"
            } else if detail.is_empty() {
                "无法访问远端仓库"
            } else {
                "连接失败"
            };
            return Err(AppError::Other(if detail.is_empty() {
                hint.into()
            } else {
                format!("{hint}：{detail}")
            }));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let has_branch = stdout.lines().any(|l| !l.trim().is_empty());
        let provider = if remote.provider.trim().is_empty() {
            "git"
        } else {
            remote.provider.trim()
        };
        if has_branch {
            Ok(format!(
                "连接成功 · {provider} · 分支 {branch} 可访问"
            ))
        } else {
            Ok(format!(
                "连接成功 · {provider} · 仓库可访问（分支 {branch} 尚不存在，首次推送时会创建）"
            ))
        }
    }

    pub fn ensure_repo(&self, remote: &SyncRemoteConfig, pat: &str) -> AppResult<()> {
        if remote.repo_url.trim().is_empty() {
            return Err(AppError::Other("请先配置仓库 URL".into()));
        }
        if pat.is_empty() {
            return Err(AppError::Other("请先配置访问令牌 PAT".into()));
        }
        let url = auth_url(&remote.repo_url, &remote.username, pat)?;
        if self.repo_dir.join(".git").exists() {
            self.git(&["remote", "set-url", "origin", &url])?;
            return Ok(());
        }
        fs::create_dir_all(&self.repo_dir)?;
        // Try clone; if remote empty / fails, init and set remote
        let branch = if remote.branch.trim().is_empty() {
            "main"
        } else {
            remote.branch.trim()
        };
        let clone = Command::new("git")
            .args([
                "clone",
                "--branch",
                branch,
                "--single-branch",
                &url,
                self.repo_dir.to_str().unwrap_or("."),
            ])
            .output();
        match clone {
            Ok(out) if out.status.success() => Ok(()),
            _ => {
                // Fresh repo
                if self.repo_dir.exists() {
                    let _ = fs::remove_dir_all(&self.repo_dir);
                }
                fs::create_dir_all(&self.repo_dir)?;
                self.git(&["init", "-b", branch])?;
                self.git(&["remote", "add", "origin", &url])?;
                // placeholder so push works
                fs::write(
                    self.repo_dir.join("README.md"),
                    "# Personal OS Sync\n\nEncrypted snapshots only. Do not commit plaintext.\n",
                )?;
                self.git(&["add", "README.md"])?;
                self.git(&["-c", "user.email=personal-os@local", "-c", "user.name=Personal OS", "commit", "-m", "chore: init sync repo"])?;
                let _ = self.git(&["push", "-u", "origin", branch]);
                Ok(())
            }
        }
    }

    pub fn pull(&self, remote: &SyncRemoteConfig, pat: &str) -> AppResult<SyncPullResult> {
        self.ensure_repo(remote, pat)?;
        let url = auth_url(&remote.repo_url, &remote.username, pat)?;
        self.git(&["remote", "set-url", "origin", &url])?;
        let branch = default_branch(remote);

        let fetch = self.git_output(&["fetch", "origin", &branch]);
        if let Err(e) = fetch {
            // Remote may be empty
            return Ok(SyncPullResult {
                status: "empty".into(),
                revision: None,
                content_hash: None,
                conflict: Some(SyncConflict {
                    message: format!("拉取失败（可能是空仓库）：{e}"),
                    commits: vec![],
                }),
            });
        }

        let local = self.rev_parse("HEAD").unwrap_or_default();
        let remote_ref = format!("origin/{branch}");
        let remote_head = match self.rev_parse(&remote_ref) {
            Ok(h) => h,
            Err(_) => {
                return Ok(SyncPullResult {
                    status: "empty".into(),
                    revision: None,
                    content_hash: None,
                    conflict: None,
                });
            }
        };

        if !local.is_empty() && local == remote_head {
            return Ok(SyncPullResult {
                status: "up_to_date".into(),
                revision: Some(local),
                content_hash: None,
                conflict: None,
            });
        }

        // Try merge/rebase fast-forward
        let merge = self.git_output(&["merge", "--ff-only", &remote_ref]);
        match merge {
            Ok(_) => Ok(SyncPullResult {
                status: "updated".into(),
                revision: self.rev_parse("HEAD").ok(),
                content_hash: None,
                conflict: None,
            }),
            Err(_) => {
                let commits = self.list_conflict_candidates(&remote_ref)?;
                Ok(SyncPullResult {
                    status: "conflict".into(),
                    revision: None,
                    content_hash: None,
                    conflict: Some(SyncConflict {
                        message: "本地与远端分叉，请选择一个提交作为基准".into(),
                        commits,
                    }),
                })
            }
        }
    }

    pub fn resolve_with_commit(&self, commit_id: &str) -> AppResult<()> {
        // Adopt selected commit as HEAD (sync snapshots are whole-state)
        self.git(&["reset", "--hard", commit_id])?;
        Ok(())
    }

    pub fn push_pack(
        &self,
        remote: &SyncRemoteConfig,
        pat: &str,
        message: &str,
    ) -> AppResult<String> {
        self.ensure_repo(remote, pat)?;
        let url = auth_url(&remote.repo_url, &remote.username, pat)?;
        self.git(&["remote", "set-url", "origin", &url])?;
        let branch = default_branch(remote);

        // Pull first (ff-only); caller should handle conflict before push
        let _ = self.git_output(&["fetch", "origin", &branch]);
        let _ = self.git_output(&["merge", "--ff-only", &format!("origin/{branch}")]);

        self.git(&["add", "sync", "README.md"])?;
        let status = self.git_output(&["status", "--porcelain"])?;
        if status.trim().is_empty() {
            return self.rev_parse("HEAD");
        }
        self.git(&[
            "-c",
            "user.email=personal-os@local",
            "-c",
            "user.name=Personal OS",
            "commit",
            "-m",
            message,
        ])?;
        self.git(&["push", "-u", "origin", &branch])?;
        self.rev_parse("HEAD")
    }

    fn list_conflict_candidates(&self, remote_ref: &str) -> AppResult<Vec<GitCommitInfo>> {
        let mut commits = Vec::new();
        for rev in ["HEAD", remote_ref] {
            if let Ok(list) = self.git_output(&[
                "log",
                rev,
                "-n",
                "8",
                "--pretty=format:%H|%h|%s|%an|%cI",
            ]) {
                for line in list.lines() {
                    let parts: Vec<_> = line.splitn(5, '|').collect();
                    if parts.len() == 5 {
                        let c = GitCommitInfo {
                            id: parts[0].to_string(),
                            short_id: parts[1].to_string(),
                            summary: parts[2].to_string(),
                            author: parts[3].to_string(),
                            time: parts[4].to_string(),
                        };
                        if !commits.iter().any(|x: &GitCommitInfo| x.id == c.id) {
                            commits.push(c);
                        }
                    }
                }
            }
        }
        Ok(commits)
    }

    fn rev_parse(&self, rev: &str) -> AppResult<String> {
        Ok(self.git_output(&["rev-parse", rev])?.trim().to_string())
    }

    fn git(&self, args: &[&str]) -> AppResult<()> {
        self.git_output(args).map(|_| ())
    }

    fn git_output(&self, args: &[&str]) -> AppResult<String> {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.repo_dir)
            .output()
            .map_err(|e| AppError::Other(format!("无法执行 git：{e}。请确认已安装 Git 并在 PATH 中。")))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            let out = String::from_utf8_lossy(&output.stdout);
            return Err(AppError::Other(format!(
                "git {} 失败：{} {}",
                args.join(" "),
                err.trim(),
                out.trim()
            )));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

fn default_branch(remote: &SyncRemoteConfig) -> String {
    if remote.branch.trim().is_empty() {
        "main".into()
    } else {
        remote.branch.trim().to_string()
    }
}

fn auth_url(repo_url: &str, username: &str, pat: &str) -> AppResult<String> {
    let url = repo_url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::Other("仓库 URL 请使用 HTTPS 地址".into()));
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap();
    let user = if username.trim().is_empty() {
        "git"
    } else {
        username.trim()
    };
    // PAT as password
    Ok(format!(
        "https://{}:{}@{}",
        urlencoding_user(user),
        urlencoding_user(pat),
        rest
    ))
}

fn urlencoding_user(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
