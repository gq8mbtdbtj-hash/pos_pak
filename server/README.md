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

## Desktop parity

Ported to the web build:

- **Encrypted Git sync** (`internal/core/{pack,transport,sync}.go`): GitHub/Gitee
  Contents API push/pull of AES-256-GCM encrypted packs (SQLite + knowledge),
  same crypto parameters as the desktop app so packs interoperate.
- **Cross-device Git-config transfer** (`gitconfig.go`): export/import an encrypted
  text bundle (transfer password) that carries remotes + the sync key.
- **Backup**: `GET /api/backup/export` (download zip) / `POST /api/backup/import`
  (upload zip). Replaces the desktop path-based flow.

Multi-profile: each master password is its own encrypted space under
`<root>/<id>/`; unlock matches by password, and "create a new space" makes
another independent vault.

Not ported (by design): the desktop auto-updater (a web app just refreshes) and
"remember password" auto-unlock. The AtomGit sync provider was removed
(GitHub/Gitee remain).
