# personal-os-server

Pure-web Go backend for Personal OS (`feat/pure-web`). Reimplements the desktop
Tauri command surface as an HTTP RPC API so the React frontend can run in any
browser (primary use: same-WiFi phone access), with the same master-password
vault + at-rest encryption as the desktop app.

## Endpoints

- `GET  /api/health` — liveness probe.
- `POST /api/rpc/{command}` — JSON body is the original `invoke(name, args)` args
  object; response is the original return value. Vault-gated commands return
  `401` until `vault_unlock` / `vault_init` establishes a session cookie
  (`pos_session`, HttpOnly).

## Storage

Data dir (default `./data/personal-os/default/`):

- `vault.json` — Argon2id password hash + split-key salts (aligned with the
  desktop `crypto.rs` parameters: Argon2id m=19456,t=2,p=1; AES-256-GCM).
- `personal.db` — working SQLite copy while unlocked; `personal.db.enc` is the
  AES-256-GCM sealed form written on lock / logout / shutdown.
- `knowledge/` — Markdown knowledge base.
- `app_prefs.json` — payday, etc.

## Run

```bash
go run ./cmd/server            # listens on 0.0.0.0:8787
# env: POS_ADDR, POS_DATA_DIR, POS_DIST_DIR
```

In production the server also serves the built Vite `dist/` (SPA fallback). In
development, Vite serves the UI and proxies `/api` to this server.

## Not yet ported to web

Git pack sync, Git-config transfer bundles, path-based backup import/export, and
the desktop auto-updater return an explicit "not available in web build" error.
These are network/desktop-specific and tracked as follow-ups.
