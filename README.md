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
`GET /api/health` 为健康检查。详见 [`server/README.md`](./server/README.md)。

## 暂未接入（后续）

Git 加密包同步、Git 配置迁移、路径式本地备份导入导出、公网暴露加固（花生壳 / TLS 反代）。
相关命令当前返回明确的「Web 版暂不支持」提示。

## 规范

产品行为以 [`docs/product/payday-plan-checkin-spec.md`](./docs/product/payday-plan-checkin-spec.md) 为准。
