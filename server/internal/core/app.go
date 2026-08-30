package core

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"personal-os-server/internal/crypto"
)

// App owns one or more independent profiles ("spaces"), each its own encrypted
// vault under <root>/<profileId>/. One profile is active (unlocked) at a time;
// entering a password unlocks the space whose master password matches, and
// "create a new space" makes another independent vault. A process-wide single
// writer session is fine for personal self-hosting.
type App struct {
	rootDir string

	mu       sync.Mutex
	unlocked bool
	activeID string
	dataDir  string // active profile dir
	knowledgeDir string
	db       *DB
	keys     crypto.DerivedKeys
	vault    *VaultFile
	tokens   map[string]bool
}

// NewApp ensures the root dir exists. Profiles live in subdirectories that
// contain a vault.json (created on first init / "new space").
func NewApp(rootDir string) (*App, error) {
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		return nil, err
	}
	return &App{rootDir: rootDir, tokens: map[string]bool{}}, nil
}

func (a *App) profileDir(id string) string { return filepath.Join(a.rootDir, id) }

// listProfilesLocked returns the ids of existing profiles (dirs with vault.json).
func (a *App) listProfilesLocked() []string {
	entries, err := os.ReadDir(a.rootDir)
	if err != nil {
		return nil
	}
	var ids []string
	for _, e := range entries {
		if e.IsDir() && vaultExists(a.profileDir(e.Name())) {
			ids = append(ids, e.Name())
		}
	}
	sort.Strings(ids)
	return ids
}

func newToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ValidToken reports whether a session token is currently active.
func (a *App) ValidToken(tok string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.unlocked && tok != "" && a.tokens[tok]
}

// IsUnlocked reports the current lock state.
func (a *App) IsUnlocked() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.unlocked
}

// withSession runs fn with the live DB if unlocked, else returns an auth error.
func (a *App) withSession(fn func(s *session) error) error {
	a.mu.Lock()
	if !a.unlocked || a.db == nil {
		a.mu.Unlock()
		return ErrLocked
	}
	s := &session{db: a.db, keys: a.keys, vault: a.vault, dataDir: a.dataDir, knowledgeDir: a.knowledgeDir}
	a.mu.Unlock()
	return fn(s)
}

// session is a lightweight handle passed to domain services.
type session struct {
	db           *DB
	keys         crypto.DerivedKeys
	vault        *VaultFile
	dataDir      string
	knowledgeDir string
}

// ErrLocked signals the vault must be unlocked first (maps to HTTP 401).
var ErrLocked = errors.New("vault locked")

// Status returns the current vault status (safe when locked).
func (a *App) Status() (VaultStatus, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.unlocked && a.vault != nil {
		return statusFromVault(a.vault, true, a.activeID), nil
	}
	initialized := len(a.listProfilesLocked()) > 0
	return VaultStatus{Initialized: initialized, Unlocked: false, CanAutoUnlock: false}, nil
}

// TryAutoUnlock is a no-op for the web build (no remembered password at rest).
func (a *App) TryAutoUnlock() (VaultStatus, error) {
	return a.Status()
}

// Init creates a NEW independent space with this password, then unlocks it.
func (a *App) Init(password string) (VaultStatus, string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	// Refuse a password already used by an existing space (would be ambiguous on unlock).
	for _, id := range a.listProfilesLocked() {
		if v, err := loadVault(a.profileDir(id)); err == nil && crypto.VerifyPassword(password, v.PasswordHash) {
			return VaultStatus{}, "", errf("该主密码已被使用；请直接用它解锁，或改用新密码创建新空间")
		}
	}
	id := newID()
	dir := a.profileDir(id)
	v, keys, err := initializeVault(dir, password)
	if err != nil {
		return VaultStatus{}, "", err
	}
	if err := a.openProfileLocked(id, dir, v, keys); err != nil {
		return VaultStatus{}, "", err
	}
	tok := a.startSessionLocked()
	return statusFromVault(v, true, id), tok, nil
}

// Unlock finds the space whose master password matches and unlocks it.
func (a *App) Unlock(password string) (VaultStatus, string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, id := range a.listProfilesLocked() {
		dir := a.profileDir(id)
		v, keys, err := unlockVault(dir, password)
		if err != nil {
			continue // wrong password for this space (or unreadable) — try next
		}
		if err := a.openProfileLocked(id, dir, v, keys); err != nil {
			return VaultStatus{}, "", err
		}
		tok := a.startSessionLocked()
		return statusFromVault(v, true, id), tok, nil
	}
	return VaultStatus{}, "", errf("主密码错误")
}

// openProfileLocked seals/closes any currently-open profile, then unseals and
// opens the requested one. Caller holds a.mu.
func (a *App) openProfileLocked(id, dir string, v *VaultFile, keys crypto.DerivedKeys) error {
	prevID := a.activeID
	a.sealCurrentLocked()
	if prevID != id {
		a.tokens = map[string]bool{} // switching spaces invalidates the old space's sessions
	}
	if err := unsealDatabaseFile(dir, keys.DB); err != nil {
		return err
	}
	db, err := openDB(dbPlainPath(dir))
	if err != nil {
		return err
	}
	kdir := filepath.Join(dir, "knowledge")
	if err := os.MkdirAll(kdir, 0o755); err != nil {
		db.Close()
		return err
	}
	a.db = db
	a.keys = keys
	a.vault = v
	a.activeID = id
	a.dataDir = dir
	a.knowledgeDir = kdir
	a.unlocked = true
	return nil
}

// sealCurrentLocked seals + closes the currently-open profile DB (if any).
func (a *App) sealCurrentLocked() {
	if a.db != nil {
		_ = a.db.checkpoint()
		_ = sealPlainFile(a.dataDir, a.keys.DB)
		removePlainArtifacts(a.dataDir)
		_ = a.db.Close()
		a.db = nil
	}
	a.unlocked = false
	a.vault = nil
}

func (a *App) startSessionLocked() string {
	tok := newToken()
	a.tokens[tok] = true
	return tok
}

// Lock seals the active DB to ciphertext, drops plaintext, and invalidates tokens.
func (a *App) Lock() (VaultStatus, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.sealCurrentLocked()
	a.tokens = map[string]bool{}
	a.activeID = ""
	initialized := len(a.listProfilesLocked()) > 0
	return VaultStatus{Initialized: initialized, Unlocked: false}, nil
}

// Logout behaves like Lock for the web build (no remembered credentials).
func (a *App) Logout() (VaultStatus, error) { return a.Lock() }

// PrepareExit seals the active DB on shutdown.
func (a *App) PrepareExit() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return nil
	}
	a.sealCurrentLocked()
	return nil
}

// ChangePassword re-derives keys and reseals the active profile with the new db key.
func (a *App) ChangePassword(oldPassword, newPassword string) (VaultStatus, string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return VaultStatus{}, "", ErrLocked
	}
	if len(newPassword) < 8 {
		return VaultStatus{}, "", errors.New("新主密码至少 8 位")
	}
	v, oldKeys, err := unlockVault(a.dataDir, oldPassword)
	if err != nil {
		return VaultStatus{}, "", err
	}
	_ = a.db.checkpoint()
	oldSync := a.keys.Sync
	salt := crypto.GenerateSalt()
	syncSalt, err := decodeB64(v.effectiveSyncSalt())
	if err != nil {
		return VaultStatus{}, "", err
	}
	newKeys := crypto.DeriveKeysSplit(newPassword, salt, syncSalt)
	newKeys.Sync = oldSync
	for i := range v.Remotes {
		if token, ok, derr := decryptRemotePat(v.Remotes[i], oldKeys.Vault); derr == nil && ok {
			if err := encryptPatIntoRemote(&v.Remotes[i], newKeys.Vault, token); err != nil {
				return VaultStatus{}, "", err
			}
		}
	}
	wrapped, err := crypto.Encrypt(newKeys.Vault, oldSync[:])
	if err != nil {
		return VaultStatus{}, "", err
	}
	v.SaltB64 = encodeB64(salt)
	v.PasswordHash = crypto.HashPassword(newPassword, salt)
	wb := encodeB64(wrapped)
	v.SyncKeyWrappedB64 = &wb
	if err := saveVault(a.dataDir, v); err != nil {
		return VaultStatus{}, "", err
	}
	if err := sealPlainFile(a.dataDir, newKeys.DB); err != nil {
		return VaultStatus{}, "", err
	}
	a.keys = newKeys
	a.vault = v
	a.tokens = map[string]bool{}
	tok := a.startSessionLocked()
	return statusFromVault(v, true, a.activeID), tok, nil
}
