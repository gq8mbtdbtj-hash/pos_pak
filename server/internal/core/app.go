package core

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"personal-os-server/internal/crypto"
)

// App owns the single self-hosted profile: data dir, unlock session, and DB.
// A process-wide single writer session is fine for personal self-hosting;
// multiple browser tabs share the same session token set.
type App struct {
	rootDir      string
	dataDir      string
	knowledgeDir string

	mu       sync.Mutex
	unlocked bool
	db       *DB
	keys     crypto.DerivedKeys
	vault    *VaultFile
	tokens   map[string]bool
}

const profileID = "default"

// NewApp prepares the data directory layout: <root>/default/{vault.json,personal.db[.enc],knowledge/}.
func NewApp(rootDir string) (*App, error) {
	dataDir := filepath.Join(rootDir, profileID)
	knowledgeDir := filepath.Join(dataDir, "knowledge")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	return &App{
		rootDir:      rootDir,
		dataDir:      dataDir,
		knowledgeDir: knowledgeDir,
		tokens:       map[string]bool{},
	}, nil
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
	if !vaultExists(a.dataDir) {
		return VaultStatus{Initialized: false, Unlocked: false, CanAutoUnlock: false}, nil
	}
	if a.unlocked && a.vault != nil {
		return statusFromVault(a.vault, true, profileID), nil
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return VaultStatus{}, err
	}
	st := statusFromVault(v, false, "")
	st.DeviceID = nil // locked peek keeps device id private, like desktop
	return st, nil
}

// TryAutoUnlock is a no-op for the web build (no remembered password at rest).
func (a *App) TryAutoUnlock() (VaultStatus, error) {
	return a.Status()
}

// Init creates a new vault, opens the DB, and starts a session. Returns a token.
func (a *App) Init(password string) (VaultStatus, string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	v, keys, err := initializeVault(a.dataDir, password)
	if err != nil {
		return VaultStatus{}, "", err
	}
	if err := a.openLocked(v, keys); err != nil {
		return VaultStatus{}, "", err
	}
	tok := a.startSessionLocked(v, keys)
	return statusFromVault(v, true, profileID), tok, nil
}

// Unlock verifies the password, unseals the DB, and starts a session.
func (a *App) Unlock(password string) (VaultStatus, string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	v, keys, err := unlockVault(a.dataDir, password)
	if err != nil {
		return VaultStatus{}, "", err
	}
	if err := a.openLocked(v, keys); err != nil {
		return VaultStatus{}, "", err
	}
	tok := a.startSessionLocked(v, keys)
	return statusFromVault(v, true, profileID), tok, nil
}

// openLocked unseals and opens the working DB. Caller holds a.mu.
func (a *App) openLocked(v *VaultFile, keys crypto.DerivedKeys) error {
	if err := unsealDatabaseFile(a.dataDir, keys.DB); err != nil {
		return err
	}
	db, err := openDB(dbPlainPath(a.dataDir))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(a.knowledgeDir, 0o755); err != nil {
		db.Close()
		return err
	}
	a.db = db
	a.keys = keys
	a.vault = v
	a.unlocked = true
	return nil
}

func (a *App) startSessionLocked(v *VaultFile, keys crypto.DerivedKeys) string {
	tok := newToken()
	a.tokens[tok] = true
	return tok
}

// Lock seals the DB to ciphertext, drops the plaintext, and invalidates tokens.
func (a *App) Lock() (VaultStatus, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.sealAndCloseLocked(); err != nil {
		return VaultStatus{}, err
	}
	return a.lockedStatusLocked()
}

// Logout behaves like Lock for the web build (no remembered credentials).
func (a *App) Logout() (VaultStatus, error) {
	return a.Lock()
}

// PrepareExit seals the DB on shutdown without changing lock semantics further.
func (a *App) PrepareExit() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.unlocked {
		return nil
	}
	return a.sealAndCloseLocked()
}

func (a *App) sealAndCloseLocked() error {
	if a.db != nil {
		_ = a.db.checkpoint()
		_ = a.db.Close()
		a.db = nil
	}
	if a.unlocked {
		if err := sealPlainFile(a.dataDir, a.keys.DB); err != nil {
			return err
		}
		removePlainArtifacts(a.dataDir)
	}
	a.unlocked = false
	a.tokens = map[string]bool{}
	a.vault = nil
	return nil
}

func (a *App) lockedStatusLocked() (VaultStatus, error) {
	if !vaultExists(a.dataDir) {
		return VaultStatus{Initialized: false}, nil
	}
	v, err := loadVault(a.dataDir)
	if err != nil {
		return VaultStatus{}, err
	}
	st := statusFromVault(v, false, "")
	st.DeviceID = nil
	return st, nil
}

// ChangePassword re-derives keys and reseals the DB with the new db key.
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
	// Flush current working copy so we reseal complete data.
	_ = a.db.checkpoint()
	// Keep the same sync key so any existing remote packs stay readable.
	oldSync := a.keys.Sync
	salt := crypto.GenerateSalt()
	syncSalt, err := decodeB64(v.effectiveSyncSalt())
	if err != nil {
		return VaultStatus{}, "", err
	}
	newKeys := crypto.DeriveKeysSplit(newPassword, salt, syncSalt)
	newKeys.Sync = oldSync
	// Re-encrypt stored remote PATs (wrapped with the old vault key) under the new one.
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
	// Reseal with the new db key and keep the live session using new keys.
	if err := sealPlainFile(a.dataDir, newKeys.DB); err != nil {
		return VaultStatus{}, "", err
	}
	a.keys = newKeys
	a.vault = v
	a.tokens = map[string]bool{}
	tok := a.startSessionLocked(v, newKeys)
	return statusFromVault(v, true, profileID), tok, nil
}
