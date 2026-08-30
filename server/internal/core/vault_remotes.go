package core

import (
	"strings"

	"personal-os-server/internal/crypto"
)

func remoteDisplayLabel(r SyncRemoteConfig) string {
	if l := strings.TrimSpace(r.Label); l != "" {
		return l
	}
	host := strings.TrimSpace(r.RepoURL)
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	if i := strings.IndexByte(host, '/'); i >= 0 {
		host = host[:i]
	}
	host = strings.TrimSpace(host)
	if host == "" {
		return r.Provider
	}
	return r.Provider + " · " + host
}

func remoteIsConfigured(r SyncRemoteConfig) bool {
	return strings.TrimSpace(r.RepoURL) != "" && r.HasPat
}

// migrateLegacyRemotes normalizes default-remote selection (single remote → default).
func migrateLegacyRemotes(v *VaultFile) {
	for i := range v.Remotes {
		if strings.TrimSpace(v.Remotes[i].ID) == "" {
			v.Remotes[i].ID = newID()
		}
	}
	if len(v.Remotes) == 1 {
		id := v.Remotes[0].ID
		if v.DefaultRemoteID == nil || *v.DefaultRemoteID != id {
			v.DefaultRemoteID = &id
		}
	} else if v.DefaultRemoteID != nil {
		found := false
		for _, r := range v.Remotes {
			if r.ID == *v.DefaultRemoteID {
				found = true
				break
			}
		}
		if !found {
			v.DefaultRemoteID = nil
		}
	}
}

func activeRemote(v *VaultFile) (*SyncRemoteConfig, error) {
	if len(v.Remotes) == 0 {
		return nil, errf("尚未配置 Git 远端")
	}
	if len(v.Remotes) == 1 {
		return &v.Remotes[0], nil
	}
	if v.DefaultRemoteID == nil {
		return nil, errf("已配置多个 Git 远端，请在设置中手动选择默认远端后再同步")
	}
	for i := range v.Remotes {
		if v.Remotes[i].ID == *v.DefaultRemoteID {
			return &v.Remotes[i], nil
		}
	}
	return nil, errf("默认远端不存在，请重新选择")
}

func remoteByID(v *VaultFile, id string) *SyncRemoteConfig {
	for i := range v.Remotes {
		if v.Remotes[i].ID == id {
			return &v.Remotes[i]
		}
	}
	return nil
}

func encryptPatIntoRemote(r *SyncRemoteConfig, vaultKey [crypto.KeyLen]byte, pat string) error {
	blob, err := crypto.Encrypt(vaultKey, []byte(pat))
	if err != nil {
		return err
	}
	enc := encodeB64(blob)
	r.PatCiphertextB64 = &enc
	r.HasPat = true
	return nil
}

func decryptRemotePat(r SyncRemoteConfig, vaultKey [crypto.KeyLen]byte) (string, bool, error) {
	if r.PatCiphertextB64 == nil {
		return "", false, nil
	}
	blob, err := decodeB64(*r.PatCiphertextB64)
	if err != nil {
		return "", false, errf("pat decode: %v", err)
	}
	plain, err := crypto.Decrypt(vaultKey, blob)
	if err != nil {
		return "", false, err
	}
	return string(plain), true, nil
}

func applyPatUpdate(r *SyncRemoteConfig, vaultKey [crypto.KeyLen]byte, pat string) error {
	pat = strings.TrimSpace(pat)
	if pat == "" {
		r.PatCiphertextB64 = nil
		r.HasPat = false
		return nil
	}
	return encryptPatIntoRemote(r, vaultKey, pat)
}
