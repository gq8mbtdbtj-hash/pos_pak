package core

import (
	"encoding/json"
	"strings"

	"personal-os-server/internal/crypto"
)

const (
	gitBundleVersion = 2
	gitBundleMagic   = "personal-os-git-config-v1"
)

var gitBundleInfo = []byte("personal-os/git-config-bundle-v1")

type gitRemotePlain struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Provider string `json:"provider"`
	RepoURL  string `json:"repoUrl"`
	Username string `json:"username"`
	Branch   string `json:"branch"`
	Pat      string `json:"pat"`
}

type gitConfigPayload struct {
	Version         uint32           `json:"version"`
	ExportedAt      string           `json:"exportedAt"`
	DefaultRemoteID *string          `json:"defaultRemoteId"`
	Remotes         []gitRemotePlain `json:"remotes"`
	SyncSaltB64     *string          `json:"syncSaltB64,omitempty"`
	SyncKeyB64      *string          `json:"syncKeyB64,omitempty"`
}

type gitConfigEnvelope struct {
	Magic         string `json:"magic"`
	Version       uint32 `json:"version"`
	SaltB64       string `json:"saltB64"`
	CiphertextB64 string `json:"ciphertextB64"`
}

func transferKey(password string, salt []byte) [crypto.KeyLen]byte {
	return crypto.DeriveKeyed(password, salt, gitBundleInfo)
}

func exportGitConfigText(v *VaultFile, keys crypto.DerivedKeys, transferPassword string) (string, error) {
	if strings.TrimSpace(transferPassword) == "" {
		return "", errf("请设置传输密码")
	}
	var remotes []gitRemotePlain
	for _, r := range v.Remotes {
		if strings.TrimSpace(r.RepoURL) == "" {
			continue
		}
		pat := ""
		if p, ok, _ := decryptRemotePat(r, keys.Vault); ok {
			pat = p
		}
		remotes = append(remotes, gitRemotePlain{
			ID: r.ID, Label: r.Label, Provider: r.Provider, RepoURL: r.RepoURL,
			Username: r.Username, Branch: r.Branch, Pat: pat,
		})
	}
	if len(remotes) == 0 {
		return "", errf("没有可导出的 Git 远程配置")
	}
	syncSalt := v.effectiveSyncSalt()
	syncKeyB64 := encodeB64(keys.Sync[:])
	payload := gitConfigPayload{
		Version:         gitBundleVersion,
		ExportedAt:      rfc3339(nowUTC()),
		DefaultRemoteID: v.DefaultRemoteID,
		Remotes:         remotes,
		SyncSaltB64:     &syncSalt,
		SyncKeyB64:      &syncKeyB64,
	}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	salt := crypto.GenerateSalt()
	key := transferKey(transferPassword, salt)
	blob, err := crypto.Encrypt(key, jsonBytes)
	if err != nil {
		return "", err
	}
	env := gitConfigEnvelope{
		Magic: gitBundleMagic, Version: gitBundleVersion,
		SaltB64: encodeB64(salt), CiphertextB64: encodeB64(blob),
	}
	out, err := json.Marshal(env)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func importGitConfigText(v *VaultFile, keys crypto.DerivedKeys, raw, transferPassword string) (*VaultFile, *[crypto.KeyLen]byte, error) {
	if strings.TrimSpace(transferPassword) == "" {
		return nil, nil, errf("请输入传输密码")
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil, errf("配置内容为空")
	}
	var env gitConfigEnvelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		return nil, nil, errf("配置格式无效: %v", err)
	}
	if env.Magic != gitBundleMagic {
		return nil, nil, errf("不是有效的 Git 配置包")
	}
	salt, err := decodeB64(env.SaltB64)
	if err != nil || len(salt) != crypto.SaltLen {
		return nil, nil, errf("配置包 salt 无效")
	}
	key := transferKey(transferPassword, salt)
	blob, err := decodeB64(env.CiphertextB64)
	if err != nil {
		return nil, nil, errf("ciphertext decode: %v", err)
	}
	plain, err := crypto.Decrypt(key, blob)
	if err != nil {
		return nil, nil, errf("解密失败：传输密码错误或内容已损坏")
	}
	var payload gitConfigPayload
	if err := json.Unmarshal(plain, &payload); err != nil {
		return nil, nil, errf("解密失败：传输密码错误或内容已损坏")
	}
	if len(payload.Remotes) == 0 {
		return nil, nil, errf("配置包中没有远程仓库")
	}
	nv := *v
	nv.Remotes = nil
	var firstID string
	for _, r := range payload.Remotes {
		id := r.ID
		if strings.TrimSpace(id) == "" {
			id = newID()
		}
		if firstID == "" {
			firstID = id
		}
		provider := r.Provider
		if strings.TrimSpace(provider) == "" {
			provider = "github"
		}
		branch := r.Branch
		if strings.TrimSpace(branch) == "" {
			branch = "main"
		}
		remote := SyncRemoteConfig{ID: id, Label: r.Label, Provider: provider, RepoURL: r.RepoURL, Username: r.Username, Branch: branch}
		if strings.TrimSpace(r.Pat) != "" {
			if err := encryptPatIntoRemote(&remote, keys.Vault, strings.TrimSpace(r.Pat)); err != nil {
				return nil, nil, err
			}
		}
		nv.Remotes = append(nv.Remotes, remote)
	}
	// default remote
	if payload.DefaultRemoteID != nil && remoteByID(&nv, *payload.DefaultRemoteID) != nil {
		nv.DefaultRemoteID = payload.DefaultRemoteID
	} else if firstID != "" {
		nv.DefaultRemoteID = &firstID
	}

	var importedSyncKey *[crypto.KeyLen]byte
	if payload.SyncKeyB64 != nil && strings.TrimSpace(*payload.SyncKeyB64) != "" {
		rawKey, err := decodeB64(strings.TrimSpace(*payload.SyncKeyB64))
		if err != nil || len(rawKey) != crypto.KeyLen {
			return nil, nil, errf("sync key 无效")
		}
		var arr [crypto.KeyLen]byte
		copy(arr[:], rawKey)
		wrapped, err := crypto.Encrypt(keys.Vault, arr[:])
		if err != nil {
			return nil, nil, err
		}
		w := encodeB64(wrapped)
		nv.SyncKeyWrappedB64 = &w
		importedSyncKey = &arr
	}
	if payload.SyncSaltB64 != nil && strings.TrimSpace(*payload.SyncSaltB64) != "" {
		s := strings.TrimSpace(*payload.SyncSaltB64)
		if rawSalt, err := decodeB64(s); err != nil || len(rawSalt) != crypto.SaltLen {
			return nil, nil, errf("sync salt 无效")
		}
		nv.SyncSaltB64 = &s
	}
	if importedSyncKey == nil && nv.SyncSaltB64 == nil {
		return nil, nil, errf("配置包过旧，缺少同步密钥。请用最新版重新「复制加密配置」后再导入")
	}
	migrateLegacyRemotes(&nv)
	return &nv, importedSyncKey, nil
}
