//! Remember last unlock under app data (not OS temp — Android `/tmp` is not writable).

use crate::error::{AppError, AppResult};
use crate::services::crypto::{decrypt, encrypt, KEY_LEN};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const REMEMBER_FILE: &str = "personal-os-session.v1.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RememberFile {
    version: u32,
    profile_id: String,
    /// AES-GCM(device_key, password_utf8), base64 — desensitized local cache
    wrapped_password_b64: String,
    /// Display-only mask, e.g. `ab****12`
    password_mask: String,
}

#[derive(Debug, Clone)]
pub struct RememberedSession {
    #[allow(dead_code)]
    pub profile_id: String,
    pub password: String,
    pub password_mask: String,
}

pub fn remember_path(root_dir: &Path) -> PathBuf {
    root_dir.join(REMEMBER_FILE)
}

/// Legacy location used before app-data storage (desktop only; Android cannot write here).
fn legacy_temp_path() -> PathBuf {
    std::env::temp_dir().join(REMEMBER_FILE)
}

pub fn exists(root_dir: &Path) -> bool {
    remember_path(root_dir).exists() || legacy_temp_path().exists()
}

pub fn clear(root_dir: &Path) {
    let _ = fs::remove_file(remember_path(root_dir));
    let _ = fs::remove_file(legacy_temp_path());
}

pub fn mask_password(password: &str) -> String {
    let chars: Vec<char> = password.chars().collect();
    let n = chars.len();
    if n == 0 {
        return String::new();
    }
    if n <= 4 {
        return "*".repeat(n);
    }
    let head: String = chars.iter().take(2).collect();
    let tail: String = chars.iter().skip(n - 2).collect();
    format!("{head}{}{tail}", "*".repeat(n.saturating_sub(4)))
}

fn device_key(root_dir: &Path) -> [u8; KEY_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(b"personal-os/remember-session-v1");
    for key in ["USERNAME", "USER", "COMPUTERNAME", "HOSTNAME"] {
        if let Ok(v) = std::env::var(key) {
            hasher.update(v.as_bytes());
        }
    }
    // Bind to app root so mobile (no USERNAME) still gets a stable key.
    hasher.update(root_dir.to_string_lossy().as_bytes());
    let dig = hasher.finalize();
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&dig);
    key
}

pub fn save(root_dir: &Path, profile_id: &str, password: &str) -> AppResult<()> {
    let key = device_key(root_dir);
    let wrapped = encrypt(&key, password.as_bytes())?;
    let file = RememberFile {
        version: 1,
        profile_id: profile_id.to_string(),
        wrapped_password_b64: B64.encode(wrapped),
        password_mask: mask_password(password),
    };
    let path = remember_path(root_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, serde_json::to_string_pretty(&file)?)?;
    // Drop legacy temp copy if present.
    let _ = fs::remove_file(legacy_temp_path());
    Ok(())
}

fn load_from(path: &Path, root_dir: &Path) -> AppResult<Option<RememberedSession>> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    let file: RememberFile = match serde_json::from_str(&raw) {
        Ok(f) => f,
        Err(_) => return Ok(None),
    };
    let blob = match B64.decode(file.wrapped_password_b64.as_bytes()) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    let key = device_key(root_dir);
    let plain = match decrypt(&key, &blob) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let password = String::from_utf8(plain).map_err(|_| {
        AppError::Other("本地会话已失效".into())
    })?;
    Ok(Some(RememberedSession {
        profile_id: file.profile_id,
        password,
        password_mask: file.password_mask,
    }))
}

pub fn load(root_dir: &Path) -> AppResult<Option<RememberedSession>> {
    if let Some(s) = load_from(&remember_path(root_dir), root_dir)? {
        return Ok(Some(s));
    }
    // Migrate legacy temp session (desktop) into app data when possible.
    let legacy = legacy_temp_path();
    // Legacy files were keyed with temp_dir in the hash — try old key shape once.
    if let Some(s) = load_legacy_temp(root_dir)? {
        let _ = save(root_dir, &s.profile_id, &s.password);
        let _ = fs::remove_file(&legacy);
        return Ok(Some(s));
    }
    Ok(None)
}

fn load_legacy_temp(root_dir: &Path) -> AppResult<Option<RememberedSession>> {
    let path = legacy_temp_path();
    if !path.exists() {
        return Ok(None);
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    let file: RememberFile = match serde_json::from_str(&raw) {
        Ok(f) => f,
        Err(_) => return Ok(None),
    };
    let blob = match B64.decode(file.wrapped_password_b64.as_bytes()) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    // Old device_key used temp_dir instead of root_dir.
    let mut hasher = Sha256::new();
    hasher.update(b"personal-os/remember-session-v1");
    for key in ["USERNAME", "USER", "COMPUTERNAME", "HOSTNAME"] {
        if let Ok(v) = std::env::var(key) {
            hasher.update(v.as_bytes());
        }
    }
    hasher.update(std::env::temp_dir().to_string_lossy().as_bytes());
    let dig = hasher.finalize();
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&dig);
    let plain = match decrypt(&key, &blob) {
        Ok(p) => p,
        Err(_) => {
            // Fallback: maybe already keyed with root (partial migrate).
            return load_from(&path, root_dir);
        }
    };
    let password = match String::from_utf8(plain) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    Ok(Some(RememberedSession {
        profile_id: file.profile_id,
        password,
        password_mask: file.password_mask,
    }))
}
