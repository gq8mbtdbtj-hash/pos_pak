//! Portable encrypted Git sync config bundle for cross-device setup.

use crate::error::{AppError, AppResult};
use crate::services::crypto::{
    decrypt, derive_keyed, encrypt, generate_salt, DerivedKeys, KEY_LEN, SALT_LEN,
};
use crate::services::vault::{SyncRemoteConfig, VaultFile, VaultService};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const BUNDLE_VERSION: u32 = 2;
const MAGIC: &str = "personal-os-git-config-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemotePlain {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub provider: String,
    pub repo_url: String,
    pub username: String,
    pub branch: String,
    pub pat: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConfigPayload {
    pub version: u32,
    pub exported_at: String,
    pub default_remote_id: Option<String>,
    pub remotes: Vec<GitRemotePlain>,
    /// Vault sync salt (base64) — legacy fallback when sync_key_b64 absent.
    #[serde(default)]
    pub sync_salt_b64: Option<String>,
    /// Raw 32-byte sync key (base64). Preferred: same pack key as exporting device.
    #[serde(default)]
    pub sync_key_b64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitConfigEnvelope {
    magic: String,
    version: u32,
    salt_b64: String,
    ciphertext_b64: String,
}

pub struct GitConfigBundle;

impl GitConfigBundle {
    pub fn export_text(
        vault_svc: &VaultService,
        vault: &VaultFile,
        keys: &DerivedKeys,
        transfer_password: &str,
    ) -> AppResult<String> {
        if transfer_password.trim().is_empty() {
            return Err(AppError::Other("请设置传输密码".into()));
        }
        let mut remotes = Vec::new();
        for remote in &vault.remotes {
            let pat = vault_svc
                .decrypt_remote_pat(remote, keys)?
                .unwrap_or_default();
            if remote.repo_url.trim().is_empty() {
                continue;
            }
            remotes.push(GitRemotePlain {
                id: remote.id.clone(),
                label: remote.label.clone(),
                provider: remote.provider.clone(),
                repo_url: remote.repo_url.clone(),
                username: remote.username.clone(),
                branch: remote.branch.clone(),
                pat,
            });
        }
        if remotes.is_empty() {
            return Err(AppError::Other("没有可导出的 Git 远程配置".into()));
        }

        let payload = GitConfigPayload {
            version: BUNDLE_VERSION,
            exported_at: chrono::Utc::now().to_rfc3339(),
            default_remote_id: vault.default_remote_id.clone(),
            remotes,
            sync_salt_b64: Some(vault.effective_sync_salt_b64().to_string()),
            sync_key_b64: Some(B64.encode(keys.sync_key)),
        };
        let json = serde_json::to_vec(&payload)?;
        let salt = generate_salt();
        let key = derive_transfer_key(transfer_password, &salt)?;
        let blob = encrypt(&key, &json)?;
        let envelope = GitConfigEnvelope {
            magic: MAGIC.into(),
            version: BUNDLE_VERSION,
            salt_b64: B64.encode(salt),
            ciphertext_b64: B64.encode(blob),
        };
        Ok(serde_json::to_string(&envelope)?)
    }

    pub fn export_to_file(
        vault_svc: &VaultService,
        vault: &VaultFile,
        keys: &DerivedKeys,
        output_path: &Path,
        transfer_password: &str,
    ) -> AppResult<()> {
        let text = Self::export_text(vault_svc, vault, keys, transfer_password)?;
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output_path, text)?;
        Ok(())
    }

    /// Replace remotes with decrypted bundle contents (PATs re-encrypted with local vault key).
    /// Returns updated vault and optional imported raw sync key for the live session.
    pub fn import_from_text(
        vault_svc: &VaultService,
        keys: &DerivedKeys,
        raw: &str,
        transfer_password: &str,
    ) -> AppResult<(VaultFile, Option<[u8; KEY_LEN]>)> {
        if transfer_password.trim().is_empty() {
            return Err(AppError::Other("请输入传输密码".into()));
        }
        let raw = raw.trim();
        if raw.is_empty() {
            return Err(AppError::Other("配置内容为空".into()));
        }
        let envelope: GitConfigEnvelope = serde_json::from_str(raw)
            .map_err(|e| AppError::Other(format!("配置格式无效: {e}")))?;
        if envelope.magic != MAGIC {
            return Err(AppError::Other("不是有效的 Git 配置包".into()));
        }
        let salt = B64
            .decode(envelope.salt_b64.as_bytes())
            .map_err(|e| AppError::Other(format!("salt decode: {e}")))?;
        if salt.len() != SALT_LEN {
            return Err(AppError::Other("配置包 salt 无效".into()));
        }
        let mut salt_arr = [0u8; SALT_LEN];
        salt_arr.copy_from_slice(&salt);
        let key = derive_transfer_key(transfer_password, &salt_arr)?;
        let blob = B64
            .decode(envelope.ciphertext_b64.as_bytes())
            .map_err(|e| AppError::Other(format!("ciphertext decode: {e}")))?;
        let plain = decrypt(&key, &blob)?;
        let payload: GitConfigPayload = serde_json::from_slice(&plain)
            .map_err(|_| AppError::Other("解密失败：传输密码错误或内容已损坏".into()))?;
        if payload.remotes.is_empty() {
            return Err(AppError::Other("配置包中没有远程仓库".into()));
        }

        let mut vault = vault_svc.load()?;
        vault.remotes.clear();
        let mut first_id = None;
        for r in payload.remotes {
            let id = if r.id.trim().is_empty() {
                SyncRemoteConfig::new_id()
            } else {
                r.id
            };
            if first_id.is_none() {
                first_id = Some(id.clone());
            }
            let mut remote = SyncRemoteConfig {
                id: id.clone(),
                label: r.label,
                provider: if r.provider.trim().is_empty() {
                    "github".into()
                } else {
                    r.provider
                },
                repo_url: r.repo_url,
                username: r.username,
                branch: if r.branch.trim().is_empty() {
                    "main".into()
                } else {
                    r.branch
                },
                pat_ciphertext_b64: None,
                has_pat: false,
            };
            if !r.pat.trim().is_empty() {
                VaultService::encrypt_pat_into_remote(&mut remote, keys, r.pat.trim())?;
            }
            vault.remotes.push(remote);
        }

        vault.default_remote_id = payload
            .default_remote_id
            .filter(|id| vault.remotes.iter().any(|r| &r.id == id))
            .or(first_id);

        let mut imported_sync_key: Option<[u8; KEY_LEN]> = None;
        if let Some(sync_key_b64) = payload.sync_key_b64 {
            let trimmed = sync_key_b64.trim().to_string();
            if !trimmed.is_empty() {
                let raw_key = B64
                    .decode(trimmed.as_bytes())
                    .map_err(|e| AppError::Other(format!("sync key 无效: {e}")))?;
                if raw_key.len() != KEY_LEN {
                    return Err(AppError::Other("sync key 长度无效".into()));
                }
                let mut arr = [0u8; KEY_LEN];
                arr.copy_from_slice(&raw_key);
                let wrapped = encrypt(&keys.vault_key, &arr)?;
                vault.sync_key_wrapped_b64 = Some(B64.encode(wrapped));
                imported_sync_key = Some(arr);
            }
        }

        if let Some(sync_salt) = payload.sync_salt_b64 {
            let trimmed = sync_salt.trim().to_string();
            if !trimmed.is_empty() {
                let raw = B64
                    .decode(trimmed.as_bytes())
                    .map_err(|e| AppError::Other(format!("sync salt 无效: {e}")))?;
                if raw.len() != SALT_LEN {
                    return Err(AppError::Other("sync salt 长度无效".into()));
                }
                vault.sync_salt_b64 = Some(trimmed);
            }
        }

        if imported_sync_key.is_none() && vault.sync_salt_b64.is_none() {
            return Err(AppError::Other(
                "配置包过旧，缺少同步密钥。请用最新版电脑端重新「复制加密配置」后再导入".into(),
            ));
        }

        let _ = vault.migrate_legacy();
        vault_svc.save(&vault)?;
        Ok((vault, imported_sync_key))
    }

    pub fn import_from_file(
        vault_svc: &VaultService,
        keys: &DerivedKeys,
        input_path: &Path,
        transfer_password: &str,
    ) -> AppResult<(VaultFile, Option<[u8; KEY_LEN]>)> {
        if !input_path.exists() {
            return Err(AppError::Other("配置文件不存在".into()));
        }
        let raw = fs::read_to_string(input_path)?;
        Self::import_from_text(vault_svc, keys, &raw, transfer_password)
    }
}

fn derive_transfer_key(password: &str, salt: &[u8; SALT_LEN]) -> AppResult<[u8; KEY_LEN]> {
    derive_keyed(password, salt, b"personal-os/git-config-bundle-v1")
}
