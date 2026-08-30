use crate::database::Database;
use crate::error::{AppError, AppResult};
use crate::services::crypto::DerivedKeys;
use crate::services::db_crypto;
use crate::services::git_sync::GitSyncService;
use crate::services::profile::ProfileService;
use crate::services::remember;
use crate::services::sync_pack::{SyncManifest, SyncPackService};
use crate::services::vault::{VaultFile, VaultService};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct Session {
    pub profile_id: String,
    pub data_dir: PathBuf,
    pub db: Arc<Database>,
    pub knowledge_dir: PathBuf,
    pub keys: DerivedKeys,
    pub vault: VaultFile,
}

pub struct AppState {
    /// App root: `…/personal-os` (holds `profiles/` + registry)
    pub root_dir: PathBuf,
    pub session: Mutex<Option<Session>>,
}

impl AppState {
    pub fn is_unlocked(&self) -> bool {
        self.session.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    pub fn with_session<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&Session) -> AppResult<T>,
    {
        let guard = self
            .session
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let session = guard
            .as_ref()
            .ok_or_else(|| AppError::Other("请先解锁主密码".into()))?;
        f(session)
    }

    fn open_db_session(
        &self,
        profile_id: String,
        data_dir: PathBuf,
        vault: VaultFile,
        keys: DerivedKeys,
    ) -> AppResult<()> {
        let db_path = db_crypto::unlock_database_file(&data_dir, &keys.db_key)?;
        let db = Arc::new(Database::new(&db_path)?);
        let knowledge_dir = data_dir.join("knowledge");
        std::fs::create_dir_all(&knowledge_dir)?;
        // Knowledge create/update/delete already maintain search indexes.
        // Full reindex on every unlock was a major startup cost — skip here.
        let _ = db.checkpoint();

        let mut guard = self
            .session
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        *guard = Some(Session {
            profile_id,
            data_dir,
            db,
            knowledge_dir,
            keys,
            vault,
        });
        Ok(())
    }

    pub fn open_session(&self, password: &str) -> AppResult<()> {
        let (profile_id, data_dir, vault, keys) =
            ProfileService::unlock_with_password(&self.root_dir, password)?;
        self.open_db_session(profile_id.clone(), data_dir, vault, keys)?;
        // Best-effort: never fail unlock because session cookie cannot be written.
        let _ = remember::save(&self.root_dir, &profile_id, password);
        Ok(())
    }

    pub fn init_and_open(&self, password: &str) -> AppResult<()> {
        let (profile_id, data_dir, vault, keys) =
            ProfileService::create_profile(&self.root_dir, password)?;
        self.open_db_session(profile_id.clone(), data_dir, vault, keys)?;
        let _ = remember::save(&self.root_dir, &profile_id, password);
        Ok(())
    }

    /// Unlock using local remember file when present; `Ok(true)` if unlocked.
    pub fn try_auto_unlock(&self) -> AppResult<bool> {
        let _ = ProfileService::migrate_legacy_if_needed(&self.root_dir);
        let Some(saved) = remember::load(&self.root_dir)? else {
            return Ok(false);
        };
        match ProfileService::unlock_with_password(&self.root_dir, &saved.password) {
            Ok((profile_id, data_dir, vault, keys)) => {
                self.open_db_session(profile_id.clone(), data_dir, vault, keys)?;
                let _ = remember::save(&self.root_dir, &profile_id, &saved.password);
                Ok(true)
            }
            Err(_) => {
                remember::clear(&self.root_dir);
                Ok(false)
            }
        }
    }

    pub fn lock(&self) -> AppResult<()> {
        let mut guard = self
            .session
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        if let Some(session) = guard.take() {
            let _ = session.db.checkpoint();
            let _ = db_crypto::seal_database_file(&session.data_dir, &session.keys.db_key);
            remove_plain_db_files(&session.data_dir);
            drop(session);
        }
        Ok(())
    }

    /// Logout: clear remember file so next launch requires password.
    pub fn logout(&self) -> AppResult<()> {
        remember::clear(&self.root_dir);
        self.lock()
    }

    /// Close DB, restore from local ZIP backup, reopen session.
    pub fn import_local_backup(&self, zip_path: &std::path::Path) -> AppResult<()> {
        let mut guard = self
            .session
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let Some(session) = guard.take() else {
            return Err(AppError::Other("请先解锁主密码".into()));
        };
        let _ = session.db.checkpoint();
        let Session {
            profile_id,
            data_dir,
            db,
            keys,
            ..
        } = session;
        drop(db);
        drop(guard);

        crate::services::backup::BackupService::new(data_dir.clone())
            .import(zip_path, &keys.db_key)?;

        let vault = VaultService::new(&data_dir).load()?;
        self.open_db_session(profile_id, data_dir, vault, keys)
    }

    /// Apply an encrypted pack already fetched into memory (HTTPS transport).
    pub fn apply_remote_pack_bytes(
        &self,
        ciphertext: &[u8],
        manifest: &SyncManifest,
    ) -> AppResult<()> {
        let mut guard = self
            .session
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let Some(session) = guard.take() else {
            return Err(AppError::Other("请先解锁主密码".into()));
        };
        let _ = session.db.checkpoint();
        let Session {
            profile_id,
            data_dir,
            db,
            knowledge_dir: _,
            keys,
            vault,
        } = session;
        drop(db);
        drop(guard);

        let apply_result = (|| -> AppResult<()> {
            let pack = SyncPackService::new(data_dir.clone());
            pack.apply_encrypted_pack(
                &keys.sync_key,
                &keys.db_key,
                ciphertext,
                Some(&manifest.content_hash),
            )
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("解密") || msg.contains("密码") || msg.contains("损坏") {
                    AppError::Other(
                        "同步包无法解密：请在电脑端用最新版重新「复制加密配置」并导入手机（配置包须含同步密钥；主密码可不相同，但传输密码须一致）".into(),
                    )
                } else {
                    e
                }
            })?;
            VaultService::new(&data_dir).update_sync_meta(
                Some(chrono::Utc::now().to_rfc3339()),
                Some(manifest.revision.clone()),
                Some(manifest.content_hash.clone()),
            )?;
            Ok(())
        })();

        match apply_result {
            Ok(()) => {
                let vault = VaultService::new(&data_dir).load()?;
                self.open_db_session(profile_id, data_dir, vault, keys)
            }
            Err(e) => {
                // Always restore session — never leave UI "unlocked" with empty session.
                let vault = VaultService::new(&data_dir).load().unwrap_or(vault);
                let _ = self.open_db_session(profile_id, data_dir, vault, keys);
                Err(e)
            }
        }
    }

    /// Close DB handles, apply remote encrypted pack if newer, reopen DB.
    pub fn apply_remote_pack_if_present(&self) -> AppResult<()> {
        let mut guard = self
            .session
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let Some(session) = guard.take() else {
            return Err(AppError::Other("请先解锁主密码".into()));
        };
        let _ = session.db.checkpoint();
        let Session {
            profile_id,
            data_dir,
            db,
            knowledge_dir,
            keys,
            vault,
        } = session;
        drop(db);

        let git = GitSyncService::new(&data_dir);
        if let Some((ciphertext, manifest)) = SyncPackService::read_pack_files(git.repo_dir())? {
            let skip = vault
                .last_content_hash
                .as_deref()
                .is_some_and(|h| h == manifest.content_hash);
            if !skip {
                drop(guard);
                return self.apply_remote_pack_bytes(&ciphertext, &manifest);
            }
        }

        let db_path = db_crypto::unlock_database_file(&data_dir, &keys.db_key)?;
        let db = Arc::new(Database::new(&db_path)?);
        *guard = Some(Session {
            profile_id,
            data_dir,
            db,
            knowledge_dir,
            keys,
            vault,
        });
        Ok(())
    }
}

fn remove_plain_db_files(data_dir: &std::path::Path) {
    let plain = db_crypto::db_plain_path(data_dir);
    let _ = std::fs::remove_file(&plain);
    let plain_s = plain.to_string_lossy();
    let _ = std::fs::remove_file(format!("{plain_s}-wal"));
    let _ = std::fs::remove_file(format!("{plain_s}-shm"));
}
