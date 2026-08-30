package core

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"personal-os-server/internal/crypto"
)

// --- mock GitHub Contents API (in-memory) ---

type mockFile struct {
	content []byte
	sha     string
}
type mockStore struct {
	mu    sync.Mutex
	files map[string]mockFile
}

func newMockGitHub() (*httptest.Server, *mockStore) {
	st := &mockStore{files: map[string]mockFile{}}
	const pfx = "/repos/acme/os/contents/"
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/acme/os" {
			w.WriteHeader(200)
			w.Write([]byte(`{"full_name":"acme/os"}`))
			return
		}
		if strings.HasPrefix(r.URL.Path, pfx) {
			key := strings.TrimPrefix(r.URL.Path, pfx)
			switch r.Method {
			case http.MethodGet:
				st.mu.Lock()
				f, ok := st.files[key]
				st.mu.Unlock()
				if !ok {
					w.WriteHeader(404)
					w.Write([]byte(`{"message":"Not Found"}`))
					return
				}
				json.NewEncoder(w).Encode(map[string]any{
					"type": "file", "sha": f.sha, "encoding": "base64",
					"content": base64.StdEncoding.EncodeToString(f.content),
				})
			case http.MethodPut:
				var body struct {
					Content string `json:"content"`
				}
				json.NewDecoder(r.Body).Decode(&body)
				data, _ := base64.StdEncoding.DecodeString(body.Content)
				sha := crypto.ContentHash(data)[:16]
				st.mu.Lock()
				st.files[key] = mockFile{content: data, sha: sha}
				st.mu.Unlock()
				w.WriteHeader(200)
				w.Write([]byte(`{"content":{"sha":"` + sha + `"}}`))
			default:
				w.WriteHeader(405)
			}
			return
		}
		w.WriteHeader(404)
	})
	return httptest.NewServer(h), st
}

func mustDispatch(t *testing.T, a *App, cmd, args string) any {
	t.Helper()
	res, err := a.Dispatch(cmd, json.RawMessage(args))
	if err != nil {
		t.Fatalf("%s: %v", cmd, err)
	}
	return res
}

func TestCrossDeviceSync(t *testing.T) {
	srv, _ := newMockGitHub()
	defer srv.Close()
	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	// Device A: init, add a transaction + a knowledge note, configure remote, push.
	a, err := NewApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.Init("passwordA1"); err != nil {
		t.Fatal(err)
	}
	mustDispatch(t, a, "finance_quick_add", `{"text":"工资 5000"}`)
	mustDispatch(t, a, "knowledge_create", `{"input":{"folder":"work","title":"同步笔记","content":"# 同步\n跨设备内容"}}`)
	if _, err := a.UpsertRemote("", "", "github", "https://github.com/acme/os", "acme", "main", strptr("PAT-A")); err != nil {
		t.Fatal(err)
	}
	push, err := a.SyncPush()
	if err != nil {
		t.Fatal(err)
	}
	if push.Status != "pushed" {
		t.Fatalf("expected pushed, got %q", push.Status)
	}

	// Export A's encrypted git-config bundle (carries the sync key).
	bundle, err := a.ExportGitConfigText("transfer-123")
	if err != nil {
		t.Fatal(err)
	}

	// Device B: DIFFERENT master password; import A's config, then pull.
	b, err := NewApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := b.Init("passwordB2"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.ImportGitConfigText(bundle, "transfer-123"); err != nil {
		t.Fatal(err)
	}
	pull, err := b.SyncPull()
	if err != nil {
		t.Fatal(err)
	}
	if pull.Status != "updated" {
		t.Fatalf("expected updated, got %q", pull.Status)
	}

	// B should now have A's transaction and knowledge note.
	txAny := mustDispatch(t, b, "finance_list", `{}`)
	txs := txAny.([]Transaction)
	if len(txs) == 0 || txs[0].Amount != 5000 || txs[0].TransactionType != "income" {
		t.Fatalf("device B missing synced transaction: %+v", txs)
	}
	kAny := mustDispatch(t, b, "knowledge_read", `{"path":"work/同步笔记.md"}`)
	kf := kAny.(KnowledgeFile)
	if !strings.Contains(kf.Content, "跨设备内容") {
		t.Fatalf("device B missing synced knowledge: %q", kf.Content)
	}

	// A second pull with nothing new is up_to_date.
	pull2, err := b.SyncPull()
	if err != nil {
		t.Fatal(err)
	}
	if pull2.Status != "up_to_date" {
		t.Fatalf("expected up_to_date, got %q", pull2.Status)
	}
}

func TestPackRoundtrip(t *testing.T) {
	a, err := NewApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.Init("password12"); err != nil {
		t.Fatal(err)
	}
	mustDispatch(t, a, "finance_quick_add", `{"text":"午饭 35"}`)
	a.mu.Lock()
	a.db.checkpoint()
	ct, man, err := buildEncryptedPack(a.dataDir, a.keys.Sync, a.vault.DeviceID)
	a.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if man.ContentHash == "" || man.Revision == "" {
		t.Fatal("bad manifest")
	}
	// Wrong key must fail to decrypt.
	var badKey [crypto.KeyLen]byte
	if _, err := crypto.Decrypt(badKey, ct); err == nil {
		t.Fatal("expected decryption failure with wrong key")
	}
}

func TestVaultRemoteCRUDAndPat(t *testing.T) {
	a, err := NewApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.Init("password12"); err != nil {
		t.Fatal(err)
	}
	view, err := a.UpsertRemote("", "主仓", "github", "https://github.com/acme/os", "acme", "", strptr("secret-pat"))
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Remotes) != 1 || !view.Remotes[0].HasPat || !view.Remotes[0].IsDefault {
		t.Fatalf("unexpected remotes view: %+v", view)
	}
	if view.Remotes[0].Branch != "main" {
		t.Fatalf("branch should default to main, got %q", view.Remotes[0].Branch)
	}
	// PAT is recoverable with the vault key and never stored in plaintext.
	a.mu.Lock()
	v, _ := loadVault(a.dataDir)
	tok, ok, err := decryptRemotePat(v.Remotes[0], a.keys.Vault)
	a.mu.Unlock()
	if err != nil || !ok || tok != "secret-pat" {
		t.Fatalf("pat decrypt failed: ok=%v tok=%q err=%v", ok, tok, err)
	}
	if v.Remotes[0].PatCiphertextB64 == nil || strings.Contains(*v.Remotes[0].PatCiphertextB64, "secret-pat") {
		t.Fatal("pat should be encrypted at rest")
	}
	id := view.Remotes[0].ID
	if _, err := a.DeleteRemote(id); err != nil {
		t.Fatal(err)
	}
	after, _ := a.SyncListRemotes()
	if len(after.Remotes) != 0 {
		t.Fatalf("remote not deleted: %+v", after)
	}
}

func TestChangePasswordKeepsPat(t *testing.T) {
	a, err := NewApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.Init("password12"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.UpsertRemote("", "", "github", "https://github.com/acme/os", "acme", "main", strptr("tok-1")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.ChangePassword("password12", "password34"); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	v, _ := loadVault(a.dataDir)
	tok, ok, err := decryptRemotePat(v.Remotes[0], a.keys.Vault)
	a.mu.Unlock()
	if err != nil || !ok || tok != "tok-1" {
		t.Fatalf("pat lost after password change: ok=%v tok=%q err=%v", ok, tok, err)
	}
}
