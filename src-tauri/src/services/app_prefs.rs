//! Lightweight per-profile preferences (payday, etc.).

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const PREFS_FILE: &str = "app_prefs.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPrefs {
    /// Day of month for payday (1–28).
    #[serde(default = "default_payday")]
    pub payday: u32,
}

fn default_payday() -> u32 {
    1
}

impl Default for AppPrefs {
    fn default() -> Self {
        Self { payday: 1 }
    }
}

fn path(data_dir: &Path) -> PathBuf {
    data_dir.join(PREFS_FILE)
}

pub fn load(data_dir: &Path) -> AppResult<AppPrefs> {
    let p = path(data_dir);
    if !p.exists() {
        return Ok(AppPrefs::default());
    }
    let raw = fs::read_to_string(&p)?;
    let mut prefs: AppPrefs = serde_json::from_str(&raw)
        .map_err(|e| AppError::Other(format!("解析 prefs 失败: {e}")))?;
    prefs.payday = prefs.payday.clamp(1, 28);
    Ok(prefs)
}

pub fn save(data_dir: &Path, prefs: &AppPrefs) -> AppResult<()> {
    fs::create_dir_all(data_dir)?;
    let mut prefs = prefs.clone();
    prefs.payday = prefs.payday.clamp(1, 28);
    let raw = serde_json::to_string_pretty(&prefs)
        .map_err(|e| AppError::Other(format!("序列化 prefs 失败: {e}")))?;
    fs::write(path(data_dir), raw)?;
    Ok(())
}

pub fn set_payday(data_dir: &Path, day: u32) -> AppResult<AppPrefs> {
    let mut prefs = load(data_dir)?;
    prefs.payday = day.clamp(1, 28);
    save(data_dir, &prefs)?;
    Ok(prefs)
}
