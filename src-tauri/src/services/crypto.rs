use crate::error::{AppError, AppResult};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2, Params, Version,
};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

pub const NONCE_LEN: usize = 12;
pub const KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 16;

#[derive(Clone)]
pub struct DerivedKeys {
    /// Opens/wraps local DB encryption
    pub db_key: [u8; KEY_LEN],
    /// Encrypts sync packs
    pub sync_key: [u8; KEY_LEN],
    /// Wraps secrets in vault (PAT)
    pub vault_key: [u8; KEY_LEN],
}

impl Drop for DerivedKeys {
    fn drop(&mut self) {
        self.db_key.zeroize();
        self.sync_key.zeroize();
        self.vault_key.zeroize();
    }
}

fn argon2() -> Argon2<'static> {
    // Balanced for desktop unlock latency
    let params = Params::new(19_456, 2, 1, Some(KEY_LEN)).unwrap_or_default();
    Argon2::new(argon2::Algorithm::Argon2id, Version::V0x13, params)
}

pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn hash_password(password: &str, salt: &[u8]) -> AppResult<String> {
    let salt = SaltString::encode_b64(salt)
        .map_err(|e| AppError::Other(format!("salt encode: {e}")))?;
    let hash = argon2()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Other(format!("argon2 hash: {e}")))?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, password_hash: &str) -> AppResult<bool> {
    let parsed = PasswordHash::new(password_hash)
        .map_err(|e| AppError::Other(format!("bad password hash: {e}")))?;
    Ok(argon2()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

fn derive_raw(password: &str, salt: &[u8], info: &[u8]) -> AppResult<[u8; KEY_LEN]> {
    let mut okm = [0u8; KEY_LEN];
    // Domain-separated: argon2(password, salt || info)
    let mut material = salt.to_vec();
    material.extend_from_slice(info);
    argon2()
        .hash_password_into(password.as_bytes(), &material, &mut okm)
        .map_err(|e| AppError::Other(format!("argon2 derive: {e}")))?;
    Ok(okm)
}

/// Public domain-separated key derivation for portable bundles.
pub fn derive_keyed(password: &str, salt: &[u8], info: &[u8]) -> AppResult<[u8; KEY_LEN]> {
    derive_raw(password, salt, info)
}

pub fn derive_keys_split(
    password: &str,
    vault_salt: &[u8],
    sync_salt: &[u8],
) -> AppResult<DerivedKeys> {
    Ok(DerivedKeys {
        db_key: derive_raw(password, vault_salt, b"personal-os/db-v1")?,
        sync_key: derive_raw(password, sync_salt, b"personal-os/sync-v1")?,
        vault_key: derive_raw(password, vault_salt, b"personal-os/vault-v1")?,
    })
}

pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> AppResult<Vec<u8>> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let mut ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Other(format!("encrypt failed: {e}")))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.append(&mut ciphertext);
    Ok(out)
}

pub fn decrypt(key: &[u8; KEY_LEN], blob: &[u8]) -> AppResult<Vec<u8>> {
    if blob.len() < NONCE_LEN + 16 {
        return Err(AppError::Other("ciphertext too short".into()));
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AppError::Other("解密失败：密码错误或数据已损坏".into()))
}

pub fn content_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key_to_hex(key: &[u8; KEY_LEN]) -> String {
        hex::encode(key)
    }

    fn hex_to_key(s: &str) -> AppResult<[u8; KEY_LEN]> {
        let bytes = hex::decode(s).map_err(|e| AppError::Other(e.to_string()))?;
        if bytes.len() != KEY_LEN {
            return Err(AppError::Other("invalid key length".into()));
        }
        let mut key = [0u8; KEY_LEN];
        key.copy_from_slice(&bytes);
        Ok(key)
    }

    #[test]
    fn roundtrip_and_verify() {
        let salt = generate_salt();
        let hash = hash_password("correct horse", &salt).unwrap();
        assert!(verify_password("correct horse", &hash).unwrap());
        assert!(!verify_password("wrong", &hash).unwrap());
        let keys = derive_keys_split("correct horse", &salt, &salt).unwrap();
        let enc = encrypt(&keys.sync_key, b"hello sync").unwrap();
        let dec = decrypt(&keys.sync_key, &enc).unwrap();
        assert_eq!(dec, b"hello sync");

        let hex = key_to_hex(&keys.vault_key);
        let restored = hex_to_key(&hex).unwrap();
        assert_eq!(restored, keys.vault_key);
    }
}
