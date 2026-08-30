package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"personal-os-server/internal/core"
)

func TestAuthLockout(t *testing.T) {
	app, err := core.NewApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := New(app, "", Options{}).Handler()
	do := func(cmd, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/rpc/"+cmd, strings.NewReader(body))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}

	if w := do("vault_init", `{"password":"correcthorse"}`); w.Code != 200 {
		t.Fatalf("init: %d %s", w.Code, w.Body.String())
	}
	if w := do("vault_lock", `{}`); w.Code != 200 {
		t.Fatalf("lock: %d", w.Code)
	}
	// Five wrong unlocks are rejected as bad password (400)...
	for i := 0; i < 5; i++ {
		if w := do("vault_unlock", `{"password":"wrongpass"}`); w.Code != 400 {
			t.Fatalf("attempt %d: expected 400, got %d", i, w.Code)
		}
	}
	// ...the next is rate-limited (429 + Retry-After).
	w := do("vault_unlock", `{"password":"wrongpass"}`)
	if w.Code != 429 {
		t.Fatalf("expected 429 after threshold, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After header on 429")
	}

	// Security headers present on all responses.
	if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("missing security header, got %q", got)
	}
}
