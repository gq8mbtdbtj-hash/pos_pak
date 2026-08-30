package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"personal-os-server/internal/core"
)

const sessionCookie = "pos_session"

func init() {
	// Serve the PWA manifest with the correct type (Go doesn't know it by default).
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

// Options tune public-exposure behavior.
type Options struct {
	// SecureCookie marks the session cookie Secure (set when serving HTTPS).
	SecureCookie bool
	// AllowedOrigins is an explicit CORS allowlist. The app is same-origin in
	// both dev (Vite proxy) and prod (Go serves the SPA), so this stays empty by
	// default — cross-origin browsers are simply blocked, which is safest for a
	// publicly-exposed instance.
	AllowedOrigins []string
}

// Server wires the App to HTTP: /api/health, /api/rpc/{command}, and static dist/.
type Server struct {
	app          *core.App
	distDir      string
	secureCookie bool
	allowed      map[string]bool
	auth         authLimiter
}

func New(app *core.App, distDir string, opts Options) *Server {
	allowed := map[string]bool{}
	for _, o := range opts.AllowedOrigins {
		if o = strings.TrimSpace(o); o != "" {
			allowed[o] = true
		}
	}
	return &Server{app: app, distDir: distDir, secureCookie: opts.SecureCookie, allowed: allowed}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/rpc/", s.handleRPC)
	mux.HandleFunc("/api/backup/export", s.handleBackupExport)
	mux.HandleFunc("/api/backup/import", s.handleBackupImport)
	mux.HandleFunc("/", s.handleStatic)
	return withSecurityHeaders(s.cors(mux))
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// authLimiter throttles unlock/init/change-password to blunt brute force.
// Single-user self-host: a global failed-attempt counter with exponential
// backoff is sufficient and avoids per-IP spoofing games.
type authLimiter struct {
	mu           sync.Mutex
	fails        int
	blockedUntil time.Time
}

const authFailThreshold = 5

func (l *authLimiter) retryAfter() time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	if d := time.Until(l.blockedUntil); d > 0 {
		return d
	}
	return 0
}

func (l *authLimiter) record(success bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if success {
		l.fails = 0
		l.blockedUntil = time.Time{}
		return
	}
	l.fails++
	if l.fails >= authFailThreshold {
		shift := uint(l.fails - authFailThreshold)
		if shift > 6 {
			shift = 6
		}
		d := (15 * time.Second) << shift // 15s,30s,1m,2m,4m,8m,16m→cap
		if d > 15*time.Minute {
			d = 15 * time.Minute
		}
		l.blockedUntil = time.Now().Add(d)
	}
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && s.allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "personal-os-server"})
}

func (s *Server) handleRPC(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}
	command := strings.TrimPrefix(r.URL.Path, "/api/rpc/")
	body, _ := io.ReadAll(io.LimitReader(r.Body, 32<<20))
	raw := json.RawMessage(body)

	// Brute-force protection on password-bearing commands.
	isAuthCmd := command == "vault_init" || command == "vault_unlock" || command == "vault_change_password"
	if isAuthCmd {
		if d := s.auth.retryAfter(); d > 0 {
			secs := int(d.Seconds()) + 1
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			writeErr(w, http.StatusTooManyRequests, fmt.Errorf("尝试过于频繁，请 %d 秒后再试", secs))
			return
		}
	}

	switch command {
	case "vault_status":
		st, err := s.app.Status()
		s.reply(w, st, err)
	case "vault_try_auto_unlock":
		st, err := s.app.TryAutoUnlock()
		s.reply(w, st, err)
	case "vault_init":
		var a struct {
			Password string `json:"password"`
		}
		_ = json.Unmarshal(body, &a)
		st, tok, err := s.app.Init(a.Password)
		s.auth.record(err == nil)
		if err == nil {
			s.setCookie(w, tok)
		}
		s.reply(w, st, err)
	case "vault_unlock":
		var a struct {
			Password string `json:"password"`
		}
		_ = json.Unmarshal(body, &a)
		st, tok, err := s.app.Unlock(a.Password)
		s.auth.record(err == nil)
		if err == nil {
			s.setCookie(w, tok)
		}
		s.reply(w, st, err)
	case "vault_lock":
		st, err := s.app.Lock()
		s.clearCookie(w)
		s.reply(w, st, err)
	case "vault_logout":
		st, err := s.app.Logout()
		s.clearCookie(w)
		s.reply(w, st, err)
	case "vault_change_password":
		var a struct {
			OldPassword string `json:"oldPassword"`
			NewPassword string `json:"newPassword"`
		}
		_ = json.Unmarshal(body, &a)
		st, tok, err := s.app.ChangePassword(a.OldPassword, a.NewPassword)
		s.auth.record(err == nil)
		if err == nil {
			s.setCookie(w, tok)
		}
		s.reply(w, st, err)
	default:
		if !s.authorized(r) {
			writeErr(w, http.StatusUnauthorized, errors.New("vault locked"))
			return
		}
		result, err := s.app.Dispatch(command, raw)
		s.reply(w, result, err)
	}
}

func (s *Server) authorized(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	return s.app.ValidToken(c.Value)
}

func (s *Server) reply(w http.ResponseWriter, result any, err error) {
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, core.ErrLocked) {
			status = http.StatusUnauthorized
		}
		writeErr(w, status, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) setCookie(w http.ResponseWriter, tok string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int((12 * time.Hour).Seconds()),
	})
}

func (s *Server) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
}

// handleBackupExport streams an unencrypted zip of the working data (auth required).
func (s *Server) handleBackupExport(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeErr(w, http.StatusUnauthorized, errors.New("vault locked"))
		return
	}
	data, err := s.app.ExportBackupZip()
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="personal-os-backup.zip"`)
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// handleBackupImport restores from an uploaded zip (raw body; auth required).
func (s *Server) handleBackupImport(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeErr(w, http.StatusUnauthorized, errors.New("vault locked"))
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 512<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.app.ImportBackupZip(body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleStatic serves the built SPA with index.html fallback (production mode).
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if s.distDir == "" {
		http.NotFound(w, r)
		return
	}
	clean := filepath.Clean(r.URL.Path)
	if strings.Contains(clean, "..") {
		http.NotFound(w, r)
		return
	}
	full := filepath.Join(s.distDir, clean)
	if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
		http.ServeFile(w, r, full)
		return
	}
	index := filepath.Join(s.distDir, "index.html")
	if _, err := os.Stat(index); err == nil {
		http.ServeFile(w, r, index)
		return
	}
	http.NotFound(w, r)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		w.Write([]byte("null"))
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("encode error: %v", err)
	}
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
