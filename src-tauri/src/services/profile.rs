//! Multi-profile workspaces: each master password unlocks its own data + remotes.

use crate::error::{AppError, AppResult};
use crate::services::vault::VaultService;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMeta {
    pub id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRegistry {
    pub version: u32,
    #[serde(default)]
    pub profiles: Vec<ProfileMeta>,
}

pub struct ProfileService;

impl ProfileService {
    pub fn registry_path(root: &Path) -> PathBuf {
        root.join("profiles.json")
    }

    pub fn profiles_root(root: &Path) -> PathBuf {
        root.join("profiles")
    }

    pub fn profile_dir(root: &Path, profile_id: &str) -> PathBuf {
        Self::profiles_root(root).join(profile_id)
    }

    pub fn load_registry(root: &Path) -> AppResult<ProfileRegistry> {
        let path = Self::registry_path(root);
        if !path.exists() {
            return Ok(ProfileRegistry {
                version: 1,
                profiles: Vec::new(),
            });
        }
        let raw = fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save_registry(root: &Path, registry: &ProfileRegistry) -> AppResult<()> {
        let path = Self::registry_path(root);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, serde_json::to_string_pretty(registry)?)?;
        Ok(())
    }

    /// Move legacy flat `vault.json` / DB / knowledge into `profiles/{id}/`.
    pub fn migrate_legacy_if_needed(root: &Path) -> AppResult<()> {
        let legacy_vault = root.join("vault.json");
        if !legacy_vault.exists() {
            // Still refresh registry from disk folders if missing entries.
            Self::reconcile_registry(root)?;
            return Ok(());
        }

        let vault_svc = VaultService::new(root);
        let vault = vault_svc.load()?;
        let id = if vault.device_id.trim().is_empty() {
            Uuid::new_v4().to_string()
        } else {
            vault.device_id.clone()
        };
        let dest = Self::profile_dir(root, &id);
        fs::create_dir_all(&dest)?;

        move_if_exists(&legacy_vault, &dest.join("vault.json"))?;
        move_if_exists(&root.join("personal.db.enc"), &dest.join("personal.db.enc"))?;
        move_if_exists(&root.join("personal.db"), &dest.join("personal.db"))?;
        for suffix in ["-wal", "-shm"] {
            let name = format!("personal.db{suffix}");
            move_if_exists(&root.join(&name), &dest.join(&name))?;
        }
        move_dir_if_exists(&root.join("knowledge"), &dest.join("knowledge"))?;
        move_dir_if_exists(&root.join("sync-repo"), &dest.join("sync-repo"))?;

        let mut registry = Self::load_registry(root)?;
        if !registry.profiles.iter().any(|p| p.id == id) {
            registry.profiles.push(ProfileMeta {
                id: id.clone(),
                created_at: chrono::Utc::now().to_rfc3339(),
            });
            registry.version = 1;
            Self::save_registry(root, &registry)?;
        }
        Self::reconcile_registry(root)?;
        Ok(())
    }

    pub fn reconcile_registry(root: &Path) -> AppResult<()> {
        let profiles_root = Self::profiles_root(root);
        if !profiles_root.exists() {
            return Ok(());
        }
        let mut registry = Self::load_registry(root)?;
        let mut changed = false;
        for entry in fs::read_dir(&profiles_root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            if !entry.path().join("vault.json").exists() {
                continue;
            }
            if !registry.profiles.iter().any(|p| p.id == id) {
                registry.profiles.push(ProfileMeta {
                    id,
                    created_at: chrono::Utc::now().to_rfc3339(),
                });
                changed = true;
            }
        }
        registry
            .profiles
            .retain(|p| Self::profile_dir(root, &p.id).join("vault.json").exists());
        if changed || registry.version == 0 {
            registry.version = 1;
            Self::save_registry(root, &registry)?;
        }
        Ok(())
    }

    pub fn has_any_profile(root: &Path) -> AppResult<bool> {
        Self::migrate_legacy_if_needed(root)?;
        let registry = Self::load_registry(root)?;
        Ok(!registry.profiles.is_empty())
    }

    pub fn list_profile_ids(root: &Path) -> AppResult<Vec<String>> {
        Self::migrate_legacy_if_needed(root)?;
        Ok(Self::load_registry(root)?
            .profiles
            .into_iter()
            .map(|p| p.id)
            .collect())
    }

    /// Find workspace whose vault password matches.
    pub fn unlock_with_password(
        root: &Path,
        password: &str,
    ) -> AppResult<(String, PathBuf, crate::services::vault::VaultFile, crate::services::crypto::DerivedKeys)>
    {
        Self::migrate_legacy_if_needed(root)?;
        let ids = Self::list_profile_ids(root)?;
        if ids.is_empty() {
            return Err(AppError::Other("请先初始化主密码".into()));
        }
        for id in ids {
            let dir = Self::profile_dir(root, &id);
            let svc = VaultService::new(&dir);
            if let Ok((vault, keys)) = svc.unlock(password) {
                return Ok((id, dir, vault, keys));
            }
        }
        Err(AppError::Other("主密码错误".into()))
    }

    pub fn create_profile(
        root: &Path,
        password: &str,
    ) -> AppResult<(String, PathBuf, crate::services::vault::VaultFile, crate::services::crypto::DerivedKeys)>
    {
        Self::migrate_legacy_if_needed(root)?;
        // Same password → open existing workspace instead of duplicating.
        if Self::has_any_profile(root)? {
            if let Ok(found) = Self::unlock_with_password(root, password) {
                return Ok(found);
            }
        }
        let id = Uuid::new_v4().to_string();
        let dir = Self::profile_dir(root, &id);
        fs::create_dir_all(&dir)?;
        let svc = VaultService::new(&dir);
        let (vault, keys) = svc.initialize(password)?;
        let mut registry = Self::load_registry(root)?;
        registry.version = 1;
        registry.profiles.push(ProfileMeta {
            id: id.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
        });
        Self::save_registry(root, &registry)?;
        Ok((id, dir, vault, keys))
    }
}

fn move_if_exists(from: &Path, to: &Path) -> AppResult<()> {
    if !from.exists() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    if to.exists() {
        let _ = fs::remove_file(to);
    }
    fs::rename(from, to).or_else(|_| {
        fs::copy(from, to)?;
        fs::remove_file(from)?;
        Ok(())
    })
}

fn move_dir_if_exists(from: &Path, to: &Path) -> AppResult<()> {
    if !from.exists() {
        return Ok(());
    }
    if to.exists() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(from, to).or_else(|_| {
        copy_dir_recursive(from, to)?;
        let _ = fs::remove_dir_all(from);
        Ok(())
    })
}

fn copy_dir_recursive(from: &Path, to: &Path) -> AppResult<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}
