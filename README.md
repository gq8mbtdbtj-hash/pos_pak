# Personal OS

Local-first 个人操作系统 — V0.1 MVP

## 功能

- 快速记录 (Quick Capture)
- 任务 / Todo
- 习惯打卡
- 记账
- Markdown 知识库
- FTS5 全文搜索
- Dashboard
- 数据备份导出

## 技术栈

- **Frontend**: React + TypeScript + Vite
- **Desktop**: Tauri 2
- **Database**: SQLite + FTS5
- **Knowledge**: Markdown 文件

## 开发

### 前置要求

- [Node.js](https://nodejs.org/) LTS
- [Rust](https://rustup.rs/)

### 启动

在项目目录的普通终端中执行：

```bash
npm install
npm run tauri dev
```

Windows 上若从部分受限环境启动，未签名的开发版 exe 可能被 Smart App Control 拦截。请在 Cursor 外的 PowerShell / cmd 中运行上述命令。

### 构建

```bash
npm run tauri build
```

### 运行测试 (Rust)

```bash
cd src-tauri && cargo test
```

## 数据位置

应用数据保存在系统 App Data 目录：

- `personal-os/personal.db` — SQLite 数据库
- `personal-os/knowledge/` — Markdown 知识库

## 规范

详见 [Agent.md](./Agent.md)
