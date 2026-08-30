package core

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"personal-os-server/internal/crypto"
)

// SyncRemoteConfig mirrors the desktop vault remote entry (sync stubbed in web build).
type SyncRemoteConfig struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Provider        string `json:"provider"`
	RepoURL         string `json:"repoUrl"`
	Username        string `json:"username"`
	Branch          string `json:"branch"`
	PatCiphertextB64 *string `json:"patCiphertextB64,omitempty"`
	HasPat          bool   `json:"hasPat"`
}

// VaultFile is the on-disk vault.json (camelCase, aligned with desktop).
type VaultFile struct {
	Version          uint32             `json:"version"`
	DeviceID         string             `json:"deviceId"`
	SaltB64          string             `json:"saltB64"`
	SyncSaltB64      *string            `json:"syncSaltB64,omitempty"`
	SyncKeyWrappedB64 *string           `json:"syncKeyWrappedB64,omitempty"`
	PasswordHash     string             `json:"passwordHash"`
	Remotes          []SyncRemoteConfig `json:"remotes"`
	DefaultRemoteID  *string            `json:"defaultRemoteId,omitempty"`
	LastSyncAt       *string            `json:"lastSyncAt,omitempty"`
	LastRevision     *string            `json:"lastRevision,omitempty"`
	LastContentHash  *string            `json:"lastContentHash,omitempty"`
}

func (v *VaultFile) effectiveSyncSalt() string {
	if v.SyncSaltB64 != nil && *v.SyncSaltB64 != "" {
		return *v.SyncSaltB64
	}
	return v.SaltB64
}

// VaultStatus is the RPC response for vault_* commands (matches api.ts VaultStatus).
type VaultStatus struct {
	Initialized       bool     `json:"initialized"`
	Unlocked          bool     `json:"unlocked"`
	DeviceID          *string  `json:"deviceId,omitempty"`
	SyncConfigured    bool     `json:"syncConfigured"`
	Provider          *string  `json:"provider,omitempty"`
	RepoURL           *string  `json:"repoUrl,omitempty"`
	Username          *string  `json:"username,omitempty"`
	Branch            *string  `json:"branch,omitempty"`
	HasPat            bool     `json:"hasPat"`
	RemoteCount       int      `json:"remoteCount"`
	DefaultRemoteID   *string  `json:"defaultRemoteId,omitempty"`
	NeedsDefaultRemote bool    `json:"needsDefaultRemote"`
	LastSyncAt        *string  `json:"lastSyncAt,omitempty"`
	LastRevision      *string  `json:"lastRevision,omitempty"`
	LastContentHash   *string  `json:"lastContentHash,omitempty"`
	CanAutoUnlock     bool     `json:"canAutoUnlock"`
	ProfileID         *string  `json:"profileId,omitempty"`
	PasswordMask      *string  `json:"passwordMask,omitempty"`
}

func vaultPath(dataDir string) string { return filepath.Join(dataDir, "vault.json") }

func vaultExists(dataDir string) bool {
	_, err := os.Stat(vaultPath(dataDir))
	return err == nil
}

func loadVault(dataDir string) (*VaultFile, error) {
	raw, err := os.ReadFile(vaultPath(dataDir))
	if err != nil {
		return nil, err
	}
	var v VaultFile
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

func saveVault(dataDir string, v *VaultFile) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(vaultPath(dataDir), raw, 0o600)
}

// initializeVault creates a fresh vault.json and returns derived keys.
func initializeVault(dataDir, password string) (*VaultFile, crypto.DerivedKeys, error) {
	var zero crypto.DerivedKeys
	if len(password) < 8 {
		return nil, zero, errors.New("主密码至少 8 位")
	}
	if vaultExists(dataDir) {
		return nil, zero, errors.New("保险库已初始化")
	}
	salt := crypto.GenerateSalt()
	syncSalt := crypto.GenerateSalt()
	keys := crypto.DeriveKeysSplit(password, salt, syncSalt)
	wrapped, err := crypto.Encrypt(keys.Vault, keys.Sync[:])
	if err != nil {
		return nil, zero, err
	}
	b64 := base64.StdEncoding
	syncSaltB64 := b64.EncodeToString(syncSalt)
	wrappedB64 := b64.EncodeToString(wrapped)
	v := &VaultFile{
		Version:           2,
		DeviceID:          newID(),
		SaltB64:           b64.EncodeToString(salt),
		SyncSaltB64:       &syncSaltB64,
		SyncKeyWrappedB64: &wrappedB64,
		PasswordHash:      crypto.HashPassword(password, salt),
		Remotes:           []SyncRemoteConfig{},
	}
	if err := saveVault(dataDir, v); err != nil {
		return nil, zero, err
	}
	return v, keys, nil
}

// unlockVault verifies the password and derives keys.
func unlockVault(dataDir, password string) (*VaultFile, crypto.DerivedKeys, error) {
	var zero crypto.DerivedKeys
	v, err := loadVault(dataDir)
	if err != nil {
		return nil, zero, err
	}
	if !crypto.VerifyPassword(password, v.PasswordHash) {
		return nil, zero, errors.New("主密码错误")
	}
	salt, err := base64.StdEncoding.DecodeString(v.SaltB64)
	if err != nil {
		return nil, zero, err
	}
	syncSalt, err := base64.StdEncoding.DecodeString(v.effectiveSyncSalt())
	if err != nil {
		return nil, zero, err
	}
	keys := crypto.DeriveKeysSplit(password, salt, syncSalt)
	return v, keys, nil
}

func statusFromVault(v *VaultFile, unlocked bool, profileID string) VaultStatus {
	st := VaultStatus{
		Initialized:  true,
		Unlocked:     unlocked,
		DeviceID:     &v.DeviceID,
		RemoteCount:  len(v.Remotes),
		CanAutoUnlock: false,
	}
	if profileID != "" {
		st.ProfileID = &profileID
	}
	needsDefault := len(v.Remotes) > 1 && v.DefaultRemoteID == nil
	st.NeedsDefaultRemote = needsDefault
	var active *SyncRemoteConfig
	if !needsDefault {
		if len(v.Remotes) == 1 {
			active = &v.Remotes[0]
		} else if v.DefaultRemoteID != nil {
			for i := range v.Remotes {
				if v.Remotes[i].ID == *v.DefaultRemoteID {
					active = &v.Remotes[i]
					break
				}
			}
		}
	}
	if active != nil {
		st.Provider = &active.Provider
		st.RepoURL = &active.RepoURL
		st.Username = &active.Username
		st.Branch = &active.Branch
		st.HasPat = active.HasPat
		st.SyncConfigured = active.RepoURL != "" && active.HasPat
	}
	st.DefaultRemoteID = v.DefaultRemoteID
	st.LastSyncAt = v.LastSyncAt
	st.LastRevision = v.LastRevision
	st.LastContentHash = v.LastContentHash
	return st
}
