# Personal OS · Pure Web

Local-first 个人操作系统 — **纯 Web 版**（`feat/pure-web`）。

浏览器前端（React + Vite）+ 单二进制 Go 后端（HTTP + SQLite/FTS5 + 主密码加密存盘）。
主要场景：**同一 WiFi 下用手机浏览器访问电脑上运行的服务**。不依赖 Tauri / 桌面运行时。

## 功能

任务 / 习惯养成 / 目标打卡 · 记账（发薪周期结余）· 外债与还款计划 · Markdown 知识库 · 全文搜索 · Dashboard。数据以主密码加密，静止时存为 `personal.db.enc`。

## 技术栈

- **前端**：React + TypeScript + Vite（`src/`）
- **后端**：Go（`server/`，纯 Go SQLite `modernc.org/sqlite`，无需 cgo）
- **加密**：Argon2id + AES-256-GCM（与旧桌面版参数对齐）
- **存储**：SQLite + FTS5；知识库为 Markdown 文件

## 目录结构

```text
.
├── index.html            # 前端入口
├── src/                  # React 前端
│   ├── services/api.ts   #   HTTP RPC 客户端（POST /api/rpc/{command}）
│   ├── pages/ …          #   各页面
│   └── components/ …
├── server/               # Go 后端（单二进制）
│   ├── cmd/server/       #   入口 main.go
│   └── internal/
│       ├── crypto/       #     Argon2id / AES-GCM
│       ├── core/         #     vault、DB、各业务域、RPC 分发
│       └── httpapi/      #     HTTP 路由 / 会话 / 静态资源
├── docs/                 # 产品 Spec 等文档
├── vite.config.ts        # dev 绑定 0.0.0.0 + 代理 /api → 后端
└── package.json          # 前端脚本 + 全栈 dev 启动器
```

## 前置要求

- [Node.js](https://nodejs.org/) LTS（含 npm）
- [Go](https://go.dev/dl/) 1.22+

## 本地启动

### 1. 安装前端依赖（首次）

```bash
npm install
```

Go 依赖首次运行会自动下载，无需手动安装。

### 2. 开发模式（一条命令同时起前后端）

```bash
npm run dev
```

- 启动 Go 后端 `:8787` 与 Vite 前端 `:1420`（Vite 把 `/api` 代理到后端）。
- 浏览器打开 <http://localhost:1420>。
- **手机访问**：确保手机与电脑同一 WiFi，打开 Vite 打印的局域网地址 `http://<电脑IP>:1420`。
- 首次进入会要求**设置主密码**（≥8 位）；之后用该密码解锁。

> 单独起某一端：`npm run server`（仅后端）、`npm run dev:web`（仅前端）。
>
> **首次运行会编译 Go 后端**（拉取并编译依赖），可能需要几十秒；就绪后终端会打印
> `✅ 后端就绪`，此前浏览器出现的 `ECONNREFUSED 127.0.0.1:8787` / vite proxy error 属正常，
> 等后端就绪即消失。若一直连不上，见下方「常见问题」。

### 中国网络环境

- **依赖下载慢/失败**：设镜像后再跑 `npm run dev`：
  `go env -w GOPROXY=https://goproxy.cn,direct` 和
  `npm config set registry https://registry.npmmirror.com`。
- **多设备同步用 Gitee**（GitHub 国内不稳）：设置页「配置新建」平台选 Gitee；注意空仓默认分支常为 `master`。
- **公网访问**：优先花生壳 HTTPS / frp+国内VPS / Tailscale；涉及大陆服务器+域名需 ICP 备案。详见 [`docs/deploy-public-internet.md`](./docs/deploy-public-internet.md) 的「中国网络环境专用建议」。
- **时区**：发薪周期/打卡按运行机本地时区，请设 `Asia/Shanghai`（systemd 单元已内置 `TZ`）。
- **字体**：已随包自带，无需 Google Fonts，国内/离线均正常。

### 常见问题

- **`[vite] http proxy error … ECONNREFUSED 127.0.0.1:8787`**：后端（Go）还没起来。
  - 首次编译较慢，等终端出现 `✅ 后端就绪` 再刷新页面。
  - 若只跑了 `npm run dev:web`（仅前端），请改用 `npm run dev`（同时起前后端），或另开一个终端 `npm run server`。
  - 终端 `[go]` 前缀的日志会显示后端启动报错，据此排查。
- **未安装 Go**：`npm run dev` 会直接提示安装 Go 1.22+（<https://go.dev/dl/>）。项目已固定
  纯 Go 的 `modernc.org/sqlite`，**无需 cgo / C 编译器**，Go 1.22 即可（不会触发 Go 工具链下载）。
- **端口占用**：默认后端 `:8787`、前端 `:1420`。后端可用 `POS_ADDR` 改；被占用时先关掉旧进程。

### 3. 生产模式（单进程：Go 同时托管前端与 API）

```bash
npm run start          # = 构建 dist 再由 Go 托管
# 手动等价：
#   npm run build
#   cd server && go run ./cmd/server
```

打开 <http://localhost:8787>（前端与 `/api` 同源）；手机访问 `http://<电脑IP>:8787`。

## 数据位置

默认 `server/data/personal-os/default/`：

- `vault.json` — 主密码校验与分密钥盐
- `personal.db` — 解锁期间的明文工作副本；`personal.db.enc` — 锁定/退出时的加密存盘
- `knowledge/` — Markdown 知识库
- `app_prefs.json` — 发薪日等偏好

用环境变量可改：`POS_DATA_DIR`（数据目录）、`POS_ADDR`（监听地址，默认 `0.0.0.0:8787`）、
`POS_DIST_DIR`（生产托管的前端产物目录）、`POS_API_TARGET`（dev 下 Vite 代理目标）。

## 后端 API 约定

`POST /api/rpc/{command}`，请求体即原 `invoke(name, args)` 的参数对象，响应即原返回值；
未解锁时返回 `401`。解锁/初始化成功后颁发 HttpOnly 会话 Cookie（`pos_session`）。
`GET /api/health` 为健康检查；备份走 `GET /api/backup/export`（下载 ZIP）与
`POST /api/backup/import`（上传 ZIP）。详见 [`server/README.md`](./server/README.md)。

## 桌面能力对齐（已移植）

- **加密同步**：GitHub / Gitee 私有仓（Contents API）加密包 `拉 / 推`；加密参数（Argon2id、
  AES-256-GCM、分密钥）与旧桌面版一致，同步包可与桌面互通。设置页「配置新建」填仓库
  HTTPS 地址 + PAT + 分支即可，左下角浮标手动同步。
- **跨设备配置迁移**：在一台设备「配置同步」里设传输密码并「复制加密配置」，到另一台
  粘贴该文本 + 同一传输密码导入（含同步密钥；主密码可不同）。
- **备份**：设置页「备份」下载 ZIP / 上传 ZIP 恢复（覆盖当前档案）。

## 部署（树莓派 / 公网）

- 📱 **免费让 iPhone/手机用起来（不用买服务器）**：见 [`docs/deploy-free-iphone.md`](./docs/deploy-free-iphone.md)
  （用你已有的电脑一条 `docker compose up -d` + 免费花生壳，或免费云 Fly.io；iPhone「添加到主屏」当 App）。
- 🐳 **一条命令跑起来**（免装 Go/Node）：`docker compose up -d` → 打开 `http://localhost:8787`。
- 🇨🇳 **中国用户三步上手**（免费、好维护）：见 [`docs/quickstart-cn.md`](./docs/quickstart-cn.md)。
- 📱 **公网可用、手机浏览器直接打开**：见 [`docs/deploy-oray-public.md`](./docs/deploy-oray-public.md)（花生壳 HTTPS）。
- 一键构建部署产物（前端 `dist/` + 交叉编译的服务端二进制，含树莓派 arm64/armv7）：
  ```bash
  npm run release      # 产物在 release/
  ```
- **树莓派部署**：见 [`docs/deploy-raspberry-pi.md`](./docs/deploy-raspberry-pi.md)（含 systemd 自启、备份、升级）。
- **公网加密访问**：见 [`docs/deploy-public-internet.md`](./docs/deploy-public-internet.md)
  （Cloudflare Tunnel / Caddy 自动 HTTPS / 花生壳 / frp+VPS / Tailscale，含安全清单）。
- 现成示例配置在 [`deploy/`](./deploy/)：systemd 单元、Caddyfile、cloudflared、frpc。

### 公网安全要点（已内置）

- 全部业务接口解锁前 `401`；**登录爆破退避**（连错 5 次指数级锁定，返回 429）。
- 静止加密（Argon2id + AES-256-GCM）+ 安全响应头 + 会话 Cookie（HTTPS 下 `Secure`）。
- **公网必须走 HTTPS**：可用内置 TLS（`POS_TLS_CERT`/`POS_TLS_KEY`）或前置反代/隧道终止 TLS 并设 `POS_SECURE_COOKIE=1`。

### 环境变量

| 变量 | 说明 |
|------|------|
| `POS_ADDR` | 监听地址，默认 `0.0.0.0:8787`（走反代/隧道时改 `127.0.0.1:8787`）。 |
| `POS_DATA_DIR` | 数据目录（默认 `./data/personal-os`）。 |
| `POS_DIST_DIR` | 生产托管的前端 `dist/` 目录。 |
| `POS_TLS_CERT` / `POS_TLS_KEY` | 设置后直接以 HTTPS 监听（内置 TLS）。 |
| `POS_SECURE_COOKIE` | `=1` 给会话 Cookie 加 `Secure`（反代终止 TLS 时用）。 |
| `POS_ALLOWED_ORIGIN` | 跨域来源白名单（逗号分隔）。默认空 = 仅同源。 |
| `POS_API_TARGET` | dev 下 Vite 代理目标（默认 `http://127.0.0.1:8787`）。 |

## 与桌面端的对齐现状与路线图

命令层面 83/83 已对齐；核心域全部落地。**多档案（每个密码一个独立空间）、PWA（可添加到主屏）已支持，AtomGit 已移除**。仍存在若干**有意差异**（更新器移除、备份改下载/上传、Git 配置改文本、通知改 Web Notifications）与**有意取舍**（Web 不记住主密码），以及**已知差距**（同步冲突合并）。
完整如实评估与后续计划见 [`docs/parity-and-roadmap.md`](./docs/parity-and-roadmap.md)。

## 规范

产品行为以 [`docs/product/payday-plan-checkin-spec.md`](./docs/product/payday-plan-checkin-spec.md) 为准。
