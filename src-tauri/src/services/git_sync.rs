//! Sync result types + local sync-repo path helper.
//! Network transport lives in `sync_https` (HTTPS Contents API).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

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

/// Local cache directory for the last pulled/pushed pack (`…/sync-repo`).
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
}
