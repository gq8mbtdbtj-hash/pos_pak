use crate::error::{AppError, AppResult};
use crate::services::crypto::{content_hash, decrypt, encrypt, KEY_LEN};
use crate::services::db_crypto;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncManifest {
    pub version: u32,
    pub device_id: String,
    pub revision: String,
    pub content_hash: String,
    pub created_at: String,
    pub app_version: String,
}

pub struct SyncPackService {
    data_dir: PathBuf,
}

impl SyncPackService {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    /// Build compressed snapshot of sqlite + knowledge, then encrypt.
    pub fn build_encrypted_pack(
        &self,
        sync_key: &[u8; KEY_LEN],
        device_id: &str,
    ) -> AppResult<(Vec<u8>, SyncManifest)> {
        let zip_bytes = self.build_zip_bytes()?;
        let hash = content_hash(&zip_bytes);
        let ciphertext = encrypt(sync_key, &zip_bytes)?;
        let revision = format!(
            "{}-{}",
            chrono::Utc::now().format("%Y%m%d%H%M%S"),
            &hash[..12]
        );
        let manifest = SyncManifest {
            version: 1,
            device_id: device_id.to_string(),
            revision,
            content_hash: hash,
            created_at: chrono::Utc::now().to_rfc3339(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        };
        Ok((ciphertext, manifest))
    }

    pub fn apply_encrypted_pack(
        &self,
        sync_key: &[u8; KEY_LEN],
        db_key: &[u8; KEY_LEN],
        ciphertext: &[u8],
        expected_hash: Option<&str>,
    ) -> AppResult<()> {
        let zip_bytes = decrypt(sync_key, ciphertext)?;
        let hash = content_hash(&zip_bytes);
        if let Some(expected) = expected_hash {
            if hash != expected {
                return Err(AppError::Other("同步包校验失败：contentHash 不匹配".into()));
            }
        }
        self.apply_zip_bytes(db_key, &zip_bytes)
    }

    fn build_zip_bytes(&self) -> AppResult<Vec<u8>> {
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

            let db_bytes = db_crypto::read_plain_db_bytes(&self.data_dir)?;
            zip.start_file("data/personal.db", options)
                .map_err(|e| AppError::Zip(e.to_string()))?;
            zip.write_all(&db_bytes)?;

            let knowledge_dir = self.data_dir.join("knowledge");
            if knowledge_dir.exists() {
                for entry in WalkDir::new(&knowledge_dir).into_iter().filter_map(|e| e.ok()) {
                    let path = entry.path();
                    if path.is_file() {
                        let rel = path
                            .strip_prefix(&self.data_dir)
                            .unwrap()
                            .to_string_lossy()
                            .replace('\\', "/");
                        zip.start_file(&rel, options)
                            .map_err(|e| AppError::Zip(e.to_string()))?;
                        let mut f = File::open(path)?;
                        let mut buf = Vec::new();
                        f.read_to_end(&mut buf)?;
                        zip.write_all(&buf)?;
                    }
                }
            }
            zip.finish().map_err(|e| AppError::Zip(e.to_string()))?;
        }
        Ok(cursor.into_inner())
    }

    pub(crate) fn apply_zip_bytes(&self, db_key: &[u8; KEY_LEN], zip_bytes: &[u8]) -> AppResult<()> {
        let reader = std::io::Cursor::new(zip_bytes);
        let mut archive = ZipArchive::new(reader).map_err(|e| AppError::Zip(e.to_string()))?;

        let knowledge_dir = self.data_dir.join("knowledge");
        if knowledge_dir.exists() {
            // Replace knowledge tree from pack
            let _ = fs::remove_dir_all(&knowledge_dir);
        }
        fs::create_dir_all(&knowledge_dir)?;

        let mut db_bytes: Option<Vec<u8>> = None;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::Zip(e.to_string()))?;
            let name = file.name().replace('\\', "/").to_string();
            if name.ends_with('/') {
                continue;
            }
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)?;
            if name == "data/personal.db" || name.ends_with("/personal.db") {
                db_bytes = Some(buf);
                continue;
            }
            if let Some(rel) = name.strip_prefix("knowledge/") {
                let dest = knowledge_dir.join(rel);
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(dest, buf)?;
            }
        }

        let Some(db) = db_bytes else {
            return Err(AppError::Other("同步包缺少数据库".into()));
        };
        db_crypto::replace_plain_db_from_bytes(&self.data_dir, db_key, &db)?;
        Ok(())
    }

    pub fn write_pack_files(
        &self,
        repo_dir: &Path,
        ciphertext: &[u8],
        manifest: &SyncManifest,
    ) -> AppResult<()> {
        let sync_dir = repo_dir.join("sync");
        fs::create_dir_all(&sync_dir)?;
        fs::write(sync_dir.join("latest.posenc"), ciphertext)?;
        fs::write(
            sync_dir.join("manifest.json"),
            serde_json::to_string_pretty(manifest)?,
        )?;
        // Keep a short history for conflict UI
        let hist = sync_dir.join("history");
        fs::create_dir_all(&hist)?;
        fs::write(
            hist.join(format!("{}.posenc", &manifest.revision)),
            ciphertext,
        )?;
        fs::write(
            hist.join(format!("{}.json", &manifest.revision)),
            serde_json::to_string_pretty(manifest)?,
        )?;
        Ok(())
    }

    pub fn read_pack_files(repo_dir: &Path) -> AppResult<Option<(Vec<u8>, SyncManifest)>> {
        let enc = repo_dir.join("sync/latest.posenc");
        let man = repo_dir.join("sync/manifest.json");
        if !enc.exists() || !man.exists() {
            return Ok(None);
        }
        let ciphertext = fs::read(enc)?;
        let manifest: SyncManifest = serde_json::from_str(&fs::read_to_string(man)?)?;
        Ok(Some((ciphertext, manifest)))
    }
}
