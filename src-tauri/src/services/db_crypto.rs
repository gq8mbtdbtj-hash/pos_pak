//! Password-protected SQLite at rest.
//! Working copy is standard SQLite; durable form is AES-GCM encrypted `personal.db.enc`.

use crate::error::{AppError, AppResult};
use crate::services::crypto::{decrypt, encrypt, KEY_LEN};
use std::fs;
use std::path::{Path, PathBuf};

pub fn db_plain_path(data_dir: &Path) -> PathBuf {
    data_dir.join("personal.db")
}

pub fn db_enc_path(data_dir: &Path) -> PathBuf {
    data_dir.join("personal.db.enc")
}

/// Ensure a usable plaintext DB exists after unlock.
pub fn unlock_database_file(data_dir: &Path, db_key: &[u8; KEY_LEN]) -> AppResult<PathBuf> {
    let plain = db_plain_path(data_dir);
    let enc = db_enc_path(data_dir);

    // Crash recovery: keep working copy if it already exists.
    if plain.exists() {
        seal_database_file(data_dir, db_key)?;
        return Ok(plain);
    }

    if enc.exists() {
        let blob = fs::read(&enc)?;
        let data = decrypt(db_key, &blob)?;
        fs::write(&plain, data)?;
        return Ok(plain);
    }

    // Fresh install — empty file created by rusqlite open.
    Ok(plain)
}

/// Encrypt working DB to durable ciphertext and remove plaintext if possible.
pub fn seal_database_file(data_dir: &Path, db_key: &[u8; KEY_LEN]) -> AppResult<()> {
    let plain = db_plain_path(data_dir);
    let enc = db_enc_path(data_dir);
    if !plain.exists() {
        return Ok(());
    }
    // Checkpoint WAL into main file before reading bytes.
    let _ = crate::database::Database::checkpoint_file(&plain);
    let data = fs::read(&plain)?;
    let blob = encrypt(db_key, &data)?;
    fs::write(&enc, blob)?;
    Ok(())
}

pub fn replace_plain_db_from_bytes(
    data_dir: &Path,
    db_key: &[u8; KEY_LEN],
    sqlite_bytes: &[u8],
) -> AppResult<PathBuf> {
    let plain = db_plain_path(data_dir);
    if let Some(parent) = plain.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&plain, sqlite_bytes)?;
    seal_database_file(data_dir, db_key)?;
    Ok(plain)
}

pub fn read_plain_db_bytes(data_dir: &Path) -> AppResult<Vec<u8>> {
    let plain = db_plain_path(data_dir);
    if !plain.exists() {
        return Err(AppError::Other("数据库尚未创建".into()));
    }
    let _ = crate::database::Database::checkpoint_file(&plain);
    Ok(fs::read(&plain)?)
}
