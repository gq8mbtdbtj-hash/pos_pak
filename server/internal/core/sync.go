package core

import (
	"strings"

	"personal-os-server/internal/crypto"
)

// SyncPullResult mirrors services/git_sync.rs SyncPullResult.
type SyncPullResult struct {
	Status      string  `json:"status"` // up_to_date | updated | empty | pushed | conflict
	Revision    *string `json:"revision,omitempty"`
	ContentHash *string `json:"contentHash,omitempty"`
	Conflict    *any    `json:"conflict,omitempty"`
}

// GitConfigImportResult mirrors commands/mod.rs GitConfigImportResult.
type GitConfigImportResult struct {
	Imported bool           `json:"imported"`
	Sync     *SyncPullResult `json:"sync,omitempty"`
	SyncNote *string        `json:"syncNote,omitempty"`
}

func strptr(s string) *string { return &s }

// ---- remote CRUD ----

func (a *App) SyncListRemotes() (syncRemotesViewT, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return syncRemotesViewT{}, ErrLocked
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return syncRemotesViewT{}, err
	}
	return syncRemotesView(v), nil
}

func (a *App) SyncGetConfig() (syncConfigViewT, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return syncConfigViewT{}, ErrLocked
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return syncConfigViewT{}, err
	}
	return syncGetConfigView(v), nil
}

func (a *App) saveVaultRefreshLocked(v *VaultFile) error {
	if err := saveVault(a.dataDir, v); err != nil {
		return err
	}
	a.vault = v
	return nil
}

func (a *App) UpsertRemote(id, label, provider, repoURL, username, branch string, pat *string) (syncRemotesViewT, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return syncRemotesViewT{}, ErrLocked
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return syncRemotesViewT{}, err
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		branch = "main"
	}
	if id != "" {
		r := remoteByID(v, id)
		if r == nil {
			return syncRemotesViewT{}, errf("远端不存在")
		}
		r.Label = strings.TrimSpace(label)
		r.Provider = provider
		r.RepoURL = strings.TrimSpace(repoURL)
		r.Username = strings.TrimSpace(username)
		r.Branch = branch
		if pat != nil {
			if err := applyPatUpdate(r, a.keys.Vault, *pat); err != nil {
				return syncRemotesViewT{}, err
			}
		}
	} else {
		r := SyncRemoteConfig{
			ID: newID(), Label: strings.TrimSpace(label), Provider: provider,
			RepoURL: strings.TrimSpace(repoURL), Username: strings.TrimSpace(username), Branch: branch,
		}
		if pat != nil {
			if err := applyPatUpdate(&r, a.keys.Vault, *pat); err != nil {
				return syncRemotesViewT{}, err
			}
		}
		v.Remotes = append(v.Remotes, r)
	}
	if len(v.Remotes) == 1 {
		id := v.Remotes[0].ID
		v.DefaultRemoteID = &id
	}
	migrateLegacyRemotes(v)
	if err := a.saveVaultRefreshLocked(v); err != nil {
		return syncRemotesViewT{}, err
	}
	return syncRemotesView(v), nil
}

func (a *App) DeleteRemote(id string) (syncRemotesViewT, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return syncRemotesViewT{}, ErrLocked
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return syncRemotesViewT{}, err
	}
	before := len(v.Remotes)
	kept := v.Remotes[:0]
	for _, r := range v.Remotes {
		if r.ID != id {
			kept = append(kept, r)
		}
	}
	v.Remotes = kept
	if len(v.Remotes) == before {
		return syncRemotesViewT{}, errf("远端不存在")
	}
	if v.DefaultRemoteID != nil && *v.DefaultRemoteID == id {
		v.DefaultRemoteID = nil
	}
	migrateLegacyRemotes(v)
	if err := a.saveVaultRefreshLocked(v); err != nil {
		return syncRemotesViewT{}, err
	}
	return syncRemotesView(v), nil
}

func (a *App) SetDefaultRemote(id string) (syncRemotesViewT, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return syncRemotesViewT{}, ErrLocked
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return syncRemotesViewT{}, err
	}
	if remoteByID(v, id) == nil {
		return syncRemotesViewT{}, errf("远端不存在")
	}
	v.DefaultRemoteID = &id
	if err := a.saveVaultRefreshLocked(v); err != nil {
		return syncRemotesViewT{}, err
	}
	return syncRemotesView(v), nil
}

func (a *App) SetSyncConfig(provider, repoURL, username, branch string, pat *string) (VaultStatus, error) {
	v, err := func() (*VaultFile, error) {
		a.mu.Lock()
		defer a.mu.Unlock()
		if !a.unlocked {
			return nil, ErrLocked
		}
		return loadVault(a.dataDir)
	}()
	if err != nil {
		return VaultStatus{}, err
	}
	id := ""
	if len(v.Remotes) == 1 {
		id = v.Remotes[0].ID
	} else if len(v.Remotes) > 1 {
		if r, err := activeRemote(v); err == nil {
			id = r.ID
		}
	}
	if _, err := a.UpsertRemote(id, "", provider, repoURL, username, branch, pat); err != nil {
		return VaultStatus{}, err
	}
	return a.Status()
}

// ---- test connection ----

type TestConnDraft struct {
	Provider *string
	RepoURL  *string
	Username *string
	Branch   *string
	Pat      *string
	RemoteID *string
}

func (a *App) TestConnection(d TestConnDraft) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return "", ErrLocked
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return "", err
	}
	var base SyncRemoteConfig
	if d.RemoteID != nil && strings.TrimSpace(*d.RemoteID) != "" {
		r := remoteByID(v, *d.RemoteID)
		if r == nil {
			return "", errf("远端不存在")
		}
		base = *r
	} else if len(v.Remotes) == 1 {
		base = v.Remotes[0]
	} else if r, err := activeRemote(v); err == nil {
		base = *r
	} else {
		base = SyncRemoteConfig{Provider: "github", Branch: "main"}
	}
	pick := func(p *string, fallback string) string {
		if p != nil && strings.TrimSpace(*p) != "" {
			return strings.TrimSpace(*p)
		}
		return fallback
	}
	remote := SyncRemoteConfig{
		ID:               base.ID,
		Label:            base.Label,
		Provider:         pick(d.Provider, base.Provider),
		RepoURL:          pick(d.RepoURL, base.RepoURL),
		Username:         pick(d.Username, base.Username),
		Branch:           pick(d.Branch, base.Branch),
		PatCiphertextB64: base.PatCiphertextB64,
		HasPat:           base.HasPat,
	}
	if strings.TrimSpace(remote.Branch) == "" {
		remote.Branch = "main"
	}
	if strings.TrimSpace(remote.RepoURL) == "" {
		return "", errf("请先填写仓库 HTTPS URL")
	}
	token := ""
	if d.Pat != nil && strings.TrimSpace(*d.Pat) != "" {
		token = strings.TrimSpace(*d.Pat)
	} else if t, ok, _ := decryptRemotePat(remote, a.keys.Vault); ok {
		token = t
	} else if r, err := activeRemote(v); err == nil {
		if t, ok, _ := decryptRemotePat(*r, a.keys.Vault); ok {
			token = t
		}
	}
	if token == "" {
		return "", errf("请填写 PAT（或先保存过令牌）")
	}
	msg, err := transportTestConnection(remote, token)
	if err != nil {
		return "", err
	}
	return msg + "。确认无误后可点击「保存配置」", nil
}

// ---- pull / push ----

func (a *App) SyncPull() (SyncPullResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.syncPullLocked()
}

func (a *App) SyncPush() (SyncPullResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.syncPushLocked()
}

func (a *App) syncPullLocked() (SyncPullResult, error) {
	if !a.unlocked {
		return SyncPullResult{}, ErrLocked
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return SyncPullResult{}, err
	}
	remote, err := activeRemote(v)
	if err != nil {
		return SyncPullResult{}, err
	}
	pat, ok, err := decryptRemotePat(*remote, a.keys.Vault)
	if err != nil {
		return SyncPullResult{}, err
	}
	if !ok {
		return SyncPullResult{}, errf("未配置 PAT")
	}
	pulled, err := transportPullPack(*remote, pat)
	if err != nil {
		return SyncPullResult{}, err
	}
	if pulled == nil {
		return SyncPullResult{Status: "empty"}, nil
	}
	rev := pulled.manifest.Revision
	ch := pulled.manifest.ContentHash
	localHash := ""
	if v.LastContentHash != nil {
		localHash = *v.LastContentHash
	}
	if localHash == ch {
		return SyncPullResult{Status: "up_to_date", Revision: &rev, ContentHash: &ch}, nil
	}
	if err := a.applyRemotePackLocked(pulled); err != nil {
		return SyncPullResult{}, err
	}
	return SyncPullResult{Status: "updated", Revision: &rev, ContentHash: &ch}, nil
}

func (a *App) applyRemotePackLocked(pulled *pulledPack) error {
	if a.db != nil {
		_ = a.db.checkpoint()
		_ = a.db.Close()
		a.db = nil
	}
	applyErr := applyEncryptedPack(a.dataDir, a.keys.Sync, a.keys.DB, pulled.ciphertext, pulled.manifest.ContentHash)
	// Always reopen the DB so the session never ends up without one.
	db, openErr := openDB(dbPlainPath(a.dataDir))
	if openErr != nil {
		return openErr
	}
	a.db = db
	if applyErr != nil {
		if strings.Contains(applyErr.Error(), "解密") || strings.Contains(applyErr.Error(), "密码") || strings.Contains(applyErr.Error(), "损坏") {
			return errf("同步包无法解密：请在电脑端重新「复制加密配置」并导入（传输密码须一致）")
		}
		return applyErr
	}
	return a.updateSyncMetaLocked(pulled.manifest.Revision, pulled.manifest.ContentHash)
}

func (a *App) updateSyncMetaLocked(revision, contentHash string) error {
	v, err := loadVault(a.dataDir)
	if err != nil {
		return err
	}
	now := rfc3339(nowUTC())
	v.LastSyncAt = &now
	v.LastRevision = &revision
	v.LastContentHash = &contentHash
	return a.saveVaultRefreshLocked(v)
}

func (a *App) syncPushLocked() (SyncPullResult, error) {
	if !a.unlocked {
		return SyncPullResult{}, ErrLocked
	}
	// Pull-then-push (mirrors desktop): applies remote if it differs, then uploads.
	pull, err := a.syncPullLocked()
	if err != nil {
		return SyncPullResult{}, err
	}
	if pull.Status == "conflict" {
		return pull, nil
	}
	if a.db != nil {
		_ = a.db.checkpoint()
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return SyncPullResult{}, err
	}
	remote, err := activeRemote(v)
	if err != nil {
		return SyncPullResult{}, err
	}
	pat, ok, err := decryptRemotePat(*remote, a.keys.Vault)
	if err != nil {
		return SyncPullResult{}, err
	}
	if !ok {
		return SyncPullResult{}, errf("未配置 PAT")
	}
	ciphertext, manifest, err := buildEncryptedPack(a.dataDir, a.keys.Sync, v.DeviceID)
	if err != nil {
		return SyncPullResult{}, err
	}
	remoteHash, err := transportRemoteContentHash(*remote, pat)
	if err != nil {
		return SyncPullResult{}, err
	}
	if remoteHash == manifest.ContentHash {
		if err := a.updateSyncMetaLocked(manifest.Revision, manifest.ContentHash); err != nil {
			return SyncPullResult{}, err
		}
		return SyncPullResult{Status: "up_to_date", Revision: &manifest.Revision, ContentHash: &manifest.ContentHash}, nil
	}
	rev, err := transportPushPack(*remote, pat, ciphertext, manifest)
	if err != nil {
		return SyncPullResult{}, err
	}
	verified, err := transportRemoteContentHash(*remote, pat)
	if err != nil {
		return SyncPullResult{}, err
	}
	if verified != manifest.ContentHash {
		return SyncPullResult{}, errf("推送未生效：远端未见 sync/manifest.json（请确认分支为「%s」，Gitee 空仓常见默认分支是 master）", remote.Branch)
	}
	if err := a.updateSyncMetaLocked(rev, manifest.ContentHash); err != nil {
		return SyncPullResult{}, err
	}
	return SyncPullResult{Status: "pushed", Revision: &rev, ContentHash: &manifest.ContentHash}, nil
}

// ---- git config transfer ----

func (a *App) ExportGitConfigText(transferPassword string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return "", ErrLocked
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return "", err
	}
	return exportGitConfigText(v, a.keys, transferPassword)
}

func (a *App) ImportGitConfigText(bundle, transferPassword string) (GitConfigImportResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return GitConfigImportResult{}, ErrLocked
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return GitConfigImportResult{}, err
	}
	newVault, importedSyncKey, err := importGitConfigText(v, a.keys, bundle, transferPassword)
	if err != nil {
		return GitConfigImportResult{}, err
	}
	if err := saveVault(a.dataDir, newVault); err != nil {
		return GitConfigImportResult{}, err
	}
	a.vault = newVault
	if importedSyncKey != nil {
		a.keys.Sync = *importedSyncKey
	}
	note := "配置已导入。启动不会自动同步，请用左下角「拉 / 推」手动同步。"
	return GitConfigImportResult{Imported: true, SyncNote: &note}, nil
}

// ---- backup (HTTP download/upload) ----

func (a *App) ExportBackupZip() ([]byte, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return nil, ErrLocked
	}
	if a.db != nil {
		_ = a.db.checkpoint()
	}
	if err := sealPlainFile(a.dataDir, a.keys.DB); err != nil {
		return nil, err
	}
	return buildBackupZip(a.dataDir)
}

func (a *App) ImportBackupZip(zipBytes []byte) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return ErrLocked
	}
	if a.db != nil {
		_ = a.db.checkpoint()
		_ = a.db.Close()
		a.db = nil
	}
	applyErr := applyPackZipToDisk(a.dataDir, a.keys.DB, zipBytes)
	db, openErr := openDB(dbPlainPath(a.dataDir))
	if openErr != nil {
		return openErr
	}
	a.db = db
	if applyErr != nil {
		return applyErr
	}
	if v, err := loadVault(a.dataDir); err == nil {
		a.vault = v
	}
	return nil
}

var _ = crypto.KeyLen
