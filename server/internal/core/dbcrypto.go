package core

import (
	"os"
	"path/filepath"

	"personal-os-server/internal/crypto"
)

func dbPlainPath(dataDir string) string { return filepath.Join(dataDir, "personal.db") }
func dbEncPath(dataDir string) string   { return filepath.Join(dataDir, "personal.db.enc") }

// unsealDatabaseFile ensures a usable plaintext personal.db exists after unlock.
// Mirrors db_crypto.rs unlock_database_file (crash recovery keeps existing plaintext).
func unsealDatabaseFile(dataDir string, dbKey [crypto.KeyLen]byte) error {
	plain := dbPlainPath(dataDir)
	enc := dbEncPath(dataDir)
	if _, err := os.Stat(plain); err == nil {
		return nil // crash recovery: reuse working copy
	}
	if data, err := os.ReadFile(enc); err == nil {
		pt, err := crypto.Decrypt(dbKey, data)
		if err != nil {
			return err
		}
		return os.WriteFile(plain, pt, 0o600)
	}
	return nil // fresh install; sqlite will create the file
}

// sealPlainFile encrypts the plaintext db bytes into personal.db.enc.
func sealPlainFile(dataDir string, dbKey [crypto.KeyLen]byte) error {
	plain := dbPlainPath(dataDir)
	data, err := os.ReadFile(plain)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	blob, err := crypto.Encrypt(dbKey, data)
	if err != nil {
		return err
	}
	return os.WriteFile(dbEncPath(dataDir), blob, 0o600)
}

// removePlainArtifacts deletes the plaintext DB and its WAL/SHM sidecars.
func removePlainArtifacts(dataDir string) {
	plain := dbPlainPath(dataDir)
	for _, p := range []string{plain, plain + "-wal", plain + "-shm"} {
		_ = os.Remove(p)
	}
}
