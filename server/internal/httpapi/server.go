package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"personal-os-server/internal/core"
)

const sessionCookie = "pos_session"

// Server wires the App to HTTP: /api/health, /api/rpc/{command}, and static dist/.
type Server struct {
	app     *core.App
	distDir string
}

func New(app *core.App, distDir string) *Server {
	return &Server{app: app, distDir: distDir}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/rpc/", s.handleRPC)
	mux.HandleFunc("/api/backup/export", s.handleBackupExport)
	mux.HandleFunc("/api/backup/import", s.handleBackupImport)
	mux.HandleFunc("/", s.handleStatic)
	return withCORS(mux)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
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
