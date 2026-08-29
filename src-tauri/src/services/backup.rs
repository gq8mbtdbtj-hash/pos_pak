use crate::error::{AppError, AppResult};
use crate::services::crypto::KEY_LEN;
use crate::services::sync_pack::SyncPackService;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

pub struct BackupService {
    data_dir: PathBuf,
}

impl BackupService {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    pub fn export(&self, output_path: &Path) -> AppResult<()> {
        let file = File::create(output_path)?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        let db_path = self.data_dir.join("personal.db");
        if db_path.exists() {
            add_file_to_zip(&mut zip, &db_path, "data/personal.db", options)?;
        }

        let knowledge_dir = self.data_dir.join("knowledge");
        if knowledge_dir.exists() {
            for entry in WalkDir::new(&knowledge_dir).into_iter().filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_file() {
                    let rel = path.strip_prefix(&self.data_dir).unwrap();
                    let name = format!("{}", rel.to_string_lossy().replace('\\', "/"));
                    add_file_to_zip(&mut zip, path, &name, options)?;
                }
            }
        }

        zip.finish().map_err(|e| AppError::Zip(e.to_string()))?;
        Ok(())
    }

    /// Restore from a ZIP previously created by [`Self::export`].
    /// Replaces the working database and knowledge tree. Caller must close DB handles first.
    pub fn import(&self, zip_path: &Path, db_key: &[u8; KEY_LEN]) -> AppResult<()> {
        if !zip_path.exists() {
            return Err(AppError::Other("备份文件不存在".into()));
        }
        let bytes = std::fs::read(zip_path)?;
        SyncPackService::new(self.data_dir.clone()).apply_zip_bytes(db_key, &bytes)
    }
}

fn add_file_to_zip(
    zip: &mut ZipWriter<File>,
    path: &Path,
    name: &str,
    options: SimpleFileOptions,
) -> AppResult<()> {
    zip.start_file(name, options)
        .map_err(|e| AppError::Zip(e.to_string()))?;
    let mut file = File::open(path)?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;
    zip.write_all(&buffer)?;
    Ok(())
}

pub fn get_data_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("personal-os")
}
