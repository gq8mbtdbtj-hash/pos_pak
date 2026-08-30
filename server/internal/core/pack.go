package core

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"personal-os-server/internal/crypto"
)

const appVersion = "0.1.2"

// SyncManifest mirrors services/sync_pack.rs (camelCase JSON on the remote).
type SyncManifest struct {
	Version     uint32 `json:"version"`
	DeviceID    string `json:"deviceId"`
	Revision    string `json:"revision"`
	ContentHash string `json:"contentHash"`
	CreatedAt   string `json:"createdAt"`
	AppVersion  string `json:"appVersion"`
}

// buildPackZip zips data/personal.db + data/app_prefs.json + knowledge/* — the
// same layout the desktop app uses, so packs interoperate.
func buildPackZip(dataDir string) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	dbBytes, err := os.ReadFile(dbPlainPath(dataDir))
	if err != nil {
		return nil, errf("数据库尚未创建")
	}
	if err := zipAdd(zw, "data/personal.db", dbBytes); err != nil {
		return nil, err
	}
	if prefs, err := os.ReadFile(prefsPath(dataDir)); err == nil {
		if err := zipAdd(zw, "data/app_prefs.json", prefs); err != nil {
			return nil, err
		}
	}
	knowledgeDir := filepath.Join(dataDir, "knowledge")
	if _, err := os.Stat(knowledgeDir); err == nil {
		err = filepath.Walk(knowledgeDir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return err
			}
			rel, err := filepath.Rel(dataDir, path)
			if err != nil {
				return err
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			return zipAdd(zw, filepath.ToSlash(rel), data)
		})
		if err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func zipAdd(zw *zip.Writer, name string, data []byte) error {
	w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

// buildEncryptedPack returns (ciphertext, manifest). Caller must have checkpointed the DB.
func buildEncryptedPack(dataDir string, syncKey [crypto.KeyLen]byte, deviceID string) ([]byte, SyncManifest, error) {
	zipBytes, err := buildPackZip(dataDir)
	if err != nil {
		return nil, SyncManifest{}, err
	}
	hash := crypto.ContentHash(zipBytes)
	ciphertext, err := crypto.Encrypt(syncKey, zipBytes)
	if err != nil {
		return nil, SyncManifest{}, err
	}
	revision := time.Now().UTC().Format("20060102150405") + "-" + hash[:12]
	m := SyncManifest{
		Version:     1,
		DeviceID:    deviceID,
		Revision:    revision,
		ContentHash: hash,
		CreatedAt:   rfc3339(nowUTC()),
		AppVersion:  appVersion,
	}
	return ciphertext, m, nil
}

// applyPackZipToDisk replaces personal.db(.enc), app_prefs.json and the knowledge
// tree from a decrypted pack/backup zip. The DB must be closed by the caller.
func applyPackZipToDisk(dataDir string, dbKey [crypto.KeyLen]byte, zipBytes []byte) error {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return errf("同步包解析失败: %v", err)
	}
	knowledgeDir := filepath.Join(dataDir, "knowledge")
	_ = os.RemoveAll(knowledgeDir)
	if err := os.MkdirAll(knowledgeDir, 0o755); err != nil {
		return err
	}
	var dbBytes, prefsBytes []byte
	for _, f := range zr.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		if strings.HasSuffix(name, "/") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return err
		}
		switch {
		case name == "data/personal.db" || strings.HasSuffix(name, "/personal.db"):
			dbBytes = data
		case name == "data/app_prefs.json" || strings.HasSuffix(name, "/app_prefs.json"):
			prefsBytes = data
		case strings.HasPrefix(name, "knowledge/"):
			dest := filepath.Join(dataDir, filepath.FromSlash(name))
			if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(dest, data, 0o644); err != nil {
				return err
			}
		}
	}
	if dbBytes == nil {
		return errf("同步包缺少数据库")
	}
	if err := replacePlainDBFromBytes(dataDir, dbKey, dbBytes); err != nil {
		return err
	}
	if prefsBytes != nil {
		if err := os.WriteFile(prefsPath(dataDir), prefsBytes, 0o600); err != nil {
			return err
		}
	}
	return nil
}

// applyEncryptedPack decrypts, verifies contentHash, then applies the zip.
func applyEncryptedPack(dataDir string, syncKey, dbKey [crypto.KeyLen]byte, ciphertext []byte, expectedHash string) error {
	zipBytes, err := crypto.Decrypt(syncKey, ciphertext)
	if err != nil {
		return err
	}
	if expectedHash != "" && crypto.ContentHash(zipBytes) != expectedHash {
		return errf("同步包校验失败：contentHash 不匹配")
	}
	return applyPackZipToDisk(dataDir, dbKey, zipBytes)
}

// replacePlainDBFromBytes writes the working DB and seals it to personal.db.enc.
func replacePlainDBFromBytes(dataDir string, dbKey [crypto.KeyLen]byte, sqliteBytes []byte) error {
	plain := dbPlainPath(dataDir)
	if err := os.MkdirAll(filepath.Dir(plain), 0o755); err != nil {
		return err
	}
	removePlainArtifacts(dataDir) // drop stale WAL/SHM before overwriting
	if err := os.WriteFile(plain, sqliteBytes, 0o600); err != nil {
		return err
	}
	return sealPlainFile(dataDir, dbKey)
}

// backup zip (unencrypted) uses the same layout as the pack, minus encryption.
func buildBackupZip(dataDir string) ([]byte, error) { return buildPackZip(dataDir) }

var _ = json.Marshal
