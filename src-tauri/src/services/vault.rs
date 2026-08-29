use crate::error::{AppError, AppResult};
use crate::services::crypto::{
    decrypt, derive_keys, encrypt, generate_salt, hash_password, verify_password, DerivedKeys,
    SALT_LEN,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncRemoteConfig {
    #[serde(default)]
    pub id: String,
    /// Optional display label; empty falls back to provider + host.
    #[serde(default)]
    pub label: String,
    pub provider: String, // github | gitee | atomgit
    pub repo_url: String,
    pub username: String,
    pub branch: String,
    /// AES-GCM blob (nonce||ct), base64 — never plaintext PAT
    pub pat_ciphertext_b64: Option<String>,
    pub has_pat: bool,
}

impl SyncRemoteConfig {
    pub fn new_id() -> String {
        Uuid::new_v4().to_string()
    }

    pub fn display_label(&self) -> String {
        let label = self.label.trim();
        if !label.is_empty() {
            return label.to_string();
        }
        let host = self
            .repo_url
            .trim()
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("")
            .trim();
        if host.is_empty() {
            self.provider.clone()
        } else {
            format!("{} · {}", self.provider, host)
        }
    }

    pub fn is_configured(&self) -> bool {
        !self.repo_url.trim().is_empty() && self.has_pat
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFile {
    pub version: u32,
    pub device_id: String,
    pub salt_b64: String,
    pub password_hash: String,
    #[serde(default)]
    pub remotes: Vec<SyncRemoteConfig>,
    #[serde(default)]
    pub default_remote_id: Option<String>,
    /// Legacy single-remote field; migrated into `remotes` on load.
    #[serde(default, skip_serializing)]
    pub sync: Option<SyncRemoteConfig>,
    pub last_sync_at: Option<String>,
    pub last_revision: Option<String>,
    pub last_content_hash: Option<String>,
}

impl VaultFile {
    /// Move legacy `sync` into `remotes` and normalize default selection.
    pub fn migrate_legacy(&mut self) -> bool {
        let mut changed = false;

        if self.remotes.is_empty() {
            if let Some(mut legacy) = self.sync.take() {
                if legacy.id.trim().is_empty() {
                    legacy.id = SyncRemoteConfig::new_id();
                }
                if !legacy.repo_url.trim().is_empty()
                    || legacy.has_pat
                    || !legacy.username.trim().is_empty()
                {
                    self.default_remote_id = Some(legacy.id.clone());
                    self.remotes.push(legacy);
                    changed = true;
                }
            }
        } else {
            self.sync = None;
        }

        for remote in &mut self.remotes {
            if remote.id.trim().is_empty() {
                remote.id = SyncRemoteConfig::new_id();
                changed = true;
            }
        }

        // Single remote → always treat it as default.
        if self.remotes.len() == 1 {
            let id = self.remotes[0].id.clone();
            if self.default_remote_id.as_deref() != Some(id.as_str()) {
                self.default_remote_id = Some(id);
                changed = true;
            }
        } else if let Some(id) = self.default_remote_id.clone() {
            if !self.remotes.iter().any(|r| r.id == id) {
                self.default_remote_id = None;
                changed = true;
            }
        }

        changed
    }

    pub fn active_remote(&self) -> AppResult<&SyncRemoteConfig> {
        if self.remotes.is_empty() {
            return Err(AppError::Other("尚未配置 Git 远端".into()));
        }
        if self.remotes.len() == 1 {
            return Ok(&self.remotes[0]);
        }
        let Some(id) = self.default_remote_id.as_deref() else {
            return Err(AppError::Other(
                "已配置多个 Git 远端，请在设置中手动选择默认远端后再同步".into(),
            ));
        };
        self.remotes
            .iter()
            .find(|r| r.id == id)
            .ok_or_else(|| AppError::Other("默认远端不存在，请重新选择".into()))
    }

    pub fn remote_by_id_mut(&mut self, id: &str) -> AppResult<&mut SyncRemoteConfig> {
        self.remotes
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| AppError::Other("远端不存在".into()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
    pub device_id: Option<String>,
    pub sync_configured: bool,
    pub provider: Option<String>,
    pub repo_url: Option<String>,
    pub username: Option<String>,
    pub branch: Option<String>,
    pub has_pat: bool,
    pub remote_count: u32,
    pub default_remote_id: Option<String>,
    pub needs_default_remote: bool,
    pub last_sync_at: Option<String>,
    pub last_revision: Option<String>,
    pub last_content_hash: Option<String>,
    /// Temp remember file present — startup can skip password prompt
    #[serde(default)]
    pub can_auto_unlock: bool,
    #[serde(default)]
    pub profile_id: Option<String>,
    /// Desensitized password hint from remember file
    #[serde(default)]
    pub password_mask: Option<String>,
}

pub struct VaultService {
    path: PathBuf,
}

impl VaultService {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("vault.json"),
        }
    }

    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    pub fn load(&self) -> AppResult<VaultFile> {
        let raw = fs::read_to_string(&self.path)?;
        let mut vault: VaultFile = serde_json::from_str(&raw)?;
        if vault.migrate_legacy() {
            self.save(&vault)?;
        }
        Ok(vault)
    }

    pub fn save(&self, vault: &VaultFile) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(vault)?;
        fs::write(&self.path, raw)?;
        Ok(())
    }

    pub fn status_with_meta(
        &self,
        unlocked: bool,
        profile_id: Option<String>,
        can_auto_unlock: bool,
        password_mask: Option<String>,
    ) -> AppResult<VaultStatus> {
        if !self.exists() {
            return Ok(VaultStatus {
                initialized: false,
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
                can_auto_unlock,
                profile_id,
                password_mask,
            });
        }
        let v = self.load()?;
        let needs_default_remote = v.remotes.len() > 1 && v.default_remote_id.is_none();
        let active = if needs_default_remote {
            None
        } else {
            v.active_remote().ok().cloned()
        };
        let sync_configured = active.as_ref().map(|r| r.is_configured()).unwrap_or(false);
        Ok(VaultStatus {
            initialized: true,
            unlocked,
            device_id: Some(v.device_id),
            sync_configured,
            provider: active.as_ref().map(|r| r.provider.clone()),
            repo_url: active.as_ref().map(|r| r.repo_url.clone()),
            username: active.as_ref().map(|r| r.username.clone()),
            branch: active.as_ref().map(|r| r.branch.clone()),
            has_pat: active.as_ref().map(|r| r.has_pat).unwrap_or(false),
            remote_count: v.remotes.len() as u32,
            default_remote_id: v.default_remote_id,
            needs_default_remote,
            last_sync_at: v.last_sync_at,
            last_revision: v.last_revision,
            last_content_hash: v.last_content_hash,
            can_auto_unlock,
            profile_id,
            password_mask,
        })
    }

    pub fn initialize(&self, password: &str) -> AppResult<(VaultFile, DerivedKeys)> {
        if password.len() < 8 {
            return Err(AppError::Other("主密码至少 8 位".into()));
        }
        if self.exists() {
            return Err(AppError::Other("保险库已初始化".into()));
        }
        let salt = generate_salt();
        let password_hash = hash_password(password, &salt)?;
        let keys = derive_keys(password, &salt)?;
        let vault = VaultFile {
            version: 2,
            device_id: Uuid::new_v4().to_string(),
            salt_b64: B64.encode(salt),
            password_hash,
            remotes: Vec::new(),
            default_remote_id: None,
            sync: None,
            last_sync_at: None,
            last_revision: None,
            last_content_hash: None,
        };
        self.save(&vault)?;
        Ok((vault, keys))
    }

    pub fn unlock(&self, password: &str) -> AppResult<(VaultFile, DerivedKeys)> {
        let vault = self.load()?;
        if !verify_password(password, &vault.password_hash)? {
            return Err(AppError::Other("主密码错误".into()));
        }
        let salt = decode_salt(&vault.salt_b64)?;
        let keys = derive_keys(password, &salt)?;
        Ok((vault, keys))
    }

    pub fn change_password(&self, old_password: &str, new_password: &str) -> AppResult<DerivedKeys> {
        if new_password.len() < 8 {
            return Err(AppError::Other("新主密码至少 8 位".into()));
        }
        let (mut vault, old_keys) = self.unlock(old_password)?;
        let mut pats: Vec<(String, String)> = Vec::new();
        for remote in &vault.remotes {
            if let Some(token) = self.decrypt_remote_pat(remote, &old_keys)? {
                pats.push((remote.id.clone(), token));
            }
        }
        let salt = generate_salt();
        vault.salt_b64 = B64.encode(salt);
        vault.password_hash = hash_password(new_password, &salt)?;
        let new_keys = derive_keys(new_password, &salt)?;
        for (id, token) in pats {
            let remote = vault.remote_by_id_mut(&id)?;
            Self::encrypt_pat_into_remote(remote, &new_keys, &token)?;
        }
        self.save(&vault)?;
        Ok(new_keys)
    }

    pub fn list_remotes(&self) -> AppResult<(Vec<SyncRemoteConfig>, Option<String>)> {
        let v = self.load()?;
        Ok((v.remotes, v.default_remote_id))
    }

    pub fn upsert_remote(
        &self,
        keys: &DerivedKeys,
        id: Option<String>,
        label: String,
        provider: String,
        repo_url: String,
        username: String,
        branch: String,
        pat: Option<String>,
    ) -> AppResult<VaultFile> {
        let mut vault = self.load()?;
        let branch = if branch.trim().is_empty() {
            "main".into()
        } else {
            branch.trim().to_string()
        };

        let remote_id = if let Some(existing_id) = id.filter(|s| !s.trim().is_empty()) {
            let remote = vault.remote_by_id_mut(&existing_id)?;
            remote.label = label.trim().to_string();
            remote.provider = provider;
            remote.repo_url = repo_url.trim().to_string();
            remote.username = username.trim().to_string();
            remote.branch = branch;
            if let Some(token) = pat {
                apply_pat_update(remote, keys, token)?;
            }
            existing_id
        } else {
            let mut remote = SyncRemoteConfig {
                id: SyncRemoteConfig::new_id(),
                label: label.trim().to_string(),
                provider,
                repo_url: repo_url.trim().to_string(),
                username: username.trim().to_string(),
                branch,
                pat_ciphertext_b64: None,
                has_pat: false,
            };
            if let Some(token) = pat {
                apply_pat_update(&mut remote, keys, token)?;
            }
            let id = remote.id.clone();
            vault.remotes.push(remote);
            id
        };

        if vault.remotes.len() == 1 {
            vault.default_remote_id = Some(remote_id);
        }
        vault.migrate_legacy();
        self.save(&vault)?;
        Ok(vault)
    }

    pub fn delete_remote(&self, id: &str) -> AppResult<VaultFile> {
        let mut vault = self.load()?;
        let before = vault.remotes.len();
        vault.remotes.retain(|r| r.id != id);
        if vault.remotes.len() == before {
            return Err(AppError::Other("远端不存在".into()));
        }
        if vault.default_remote_id.as_deref() == Some(id) {
            vault.default_remote_id = None;
        }
        vault.migrate_legacy();
        self.save(&vault)?;
        Ok(vault)
    }

    pub fn set_default_remote(&self, id: &str) -> AppResult<VaultFile> {
        let mut vault = self.load()?;
        if !vault.remotes.iter().any(|r| r.id == id) {
            return Err(AppError::Other("远端不存在".into()));
        }
        vault.default_remote_id = Some(id.to_string());
        self.save(&vault)?;
        Ok(vault)
    }

    /// Backward-compatible: update/create the active (or sole) remote.
    pub fn set_sync_config(
        &self,
        keys: &DerivedKeys,
        provider: String,
        repo_url: String,
        username: String,
        branch: String,
        pat: Option<String>,
    ) -> AppResult<VaultFile> {
        let vault = self.load()?;
        let id = if vault.remotes.len() <= 1 {
            vault.remotes.first().map(|r| r.id.clone())
        } else {
            Some(vault.active_remote()?.id.clone())
        };
        self.upsert_remote(
            keys,
            id,
            String::new(),
            provider,
            repo_url,
            username,
            branch,
            pat,
        )
    }

    pub fn decrypt_pat(&self, vault: &VaultFile, keys: &DerivedKeys) -> AppResult<Option<String>> {
        let remote = vault.active_remote()?;
        self.decrypt_remote_pat(remote, keys)
    }

    pub fn decrypt_remote_pat(
        &self,
        remote: &SyncRemoteConfig,
        keys: &DerivedKeys,
    ) -> AppResult<Option<String>> {
        let Some(b64) = remote.pat_ciphertext_b64.as_ref() else {
            return Ok(None);
        };
        let blob = B64
            .decode(b64)
            .map_err(|e| AppError::Other(format!("pat decode: {e}")))?;
        let plain = decrypt(&keys.vault_key, &blob)?;
        Ok(Some(
            String::from_utf8(plain).map_err(|e| AppError::Other(e.to_string()))?,
        ))
    }

    pub(crate) fn encrypt_pat_into_remote(
        remote: &mut SyncRemoteConfig,
        keys: &DerivedKeys,
        pat: &str,
    ) -> AppResult<()> {
        let blob = encrypt(&keys.vault_key, pat.as_bytes())?;
        remote.pat_ciphertext_b64 = Some(B64.encode(blob));
        remote.has_pat = true;
        Ok(())
    }

    pub fn update_sync_meta(
        &self,
        last_sync_at: Option<String>,
        last_revision: Option<String>,
        last_content_hash: Option<String>,
    ) -> AppResult<()> {
        let mut vault = self.load()?;
        if last_sync_at.is_some() {
            vault.last_sync_at = last_sync_at;
        }
        if last_revision.is_some() {
            vault.last_revision = last_revision;
        }
        if last_content_hash.is_some() {
            vault.last_content_hash = last_content_hash;
        }
        self.save(&vault)
    }
}

fn apply_pat_update(
    remote: &mut SyncRemoteConfig,
    keys: &DerivedKeys,
    token: String,
) -> AppResult<()> {
    let token = token.trim().to_string();
    if token.is_empty() {
        remote.pat_ciphertext_b64 = None;
        remote.has_pat = false;
        Ok(())
    } else {
        VaultService::encrypt_pat_into_remote(remote, keys, &token)
    }
}

fn decode_salt(b64: &str) -> AppResult<Vec<u8>> {
    let salt = B64
        .decode(b64)
        .map_err(|e| AppError::Other(format!("salt decode: {e}")))?;
    if salt.len() != SALT_LEN {
        return Err(AppError::Other("invalid salt length".into()));
    }
    Ok(salt)
}
