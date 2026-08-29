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

const BUNDLE_VERSION: u32 = 1;
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
    pub fn export_to_file(
        vault_svc: &VaultService,
        vault: &VaultFile,
        keys: &DerivedKeys,
        output_path: &Path,
        transfer_password: &str,
    ) -> AppResult<()> {
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
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output_path, serde_json::to_string_pretty(&envelope)?)?;
        Ok(())
    }

    /// Replace remotes with decrypted bundle contents (PATs re-encrypted with local vault key).
    pub fn import_from_file(
        vault_svc: &VaultService,
        keys: &DerivedKeys,
        input_path: &Path,
        transfer_password: &str,
    ) -> AppResult<VaultFile> {
        if transfer_password.trim().is_empty() {
            return Err(AppError::Other("请输入传输密码".into()));
        }
        if !input_path.exists() {
            return Err(AppError::Other("配置文件不存在".into()));
        }
        let raw = fs::read_to_string(input_path)?;
        let envelope: GitConfigEnvelope = serde_json::from_str(&raw)
            .map_err(|e| AppError::Other(format!("配置文件格式无效: {e}")))?;
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
            .map_err(|_| AppError::Other("解密失败：传输密码错误或文件已损坏".into()))?;
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
        let _ = vault.migrate_legacy();
        vault_svc.save(&vault)?;
        Ok(vault)
    }
}

fn derive_transfer_key(password: &str, salt: &[u8; SALT_LEN]) -> AppResult<[u8; KEY_LEN]> {
    derive_keyed(password, salt, b"personal-os/git-config-bundle-v1")
}
