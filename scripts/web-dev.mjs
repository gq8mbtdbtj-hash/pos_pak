#!/usr/bin/env node
/**
 * Pure-web dev launcher: runs the Go backend (:8787) and the Vite dev server
 * (:1420) together. Vite proxies `/api` to the backend, so open the printed
 * LAN URL on your phone (same WiFi) to use the app.
 *
 * Cross-platform (Windows / macOS / Linux); no extra dependencies.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import http from "node:http";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const goCmd = isWindows ? "go.exe" : "go";

const HEALTH_URL = "http://127.0.0.1:8787/api/health";

// Fail fast with an actionable message if Go isn't installed.
const goCheck = spawnSync(goCmd, ["version"], { encoding: "utf8" });
if (goCheck.error || goCheck.status !== 0) {
  console.error(
    "\n❌ 未找到 Go 工具链。请先安装 Go 1.22+（https://go.dev/dl/）并确保 `go` 在 PATH 中。\n" +
      "   仅想跑前端（需要另开后端）可用：npm run dev:web\n",
  );
  process.exit(1);
}
console.log(`• 使用 ${goCheck.stdout.trim()}`);

const children = [];

function run(name, command, args, cwd, extraEnv = {}, needsShell = false) {
  let spawnCmd = command;
  let spawnArgs = args;
  let useShell = false;
  if (isWindows && needsShell) {
    // On Windows, .cmd shims need a shell; pass a single string (not an args
    // array) to avoid the DEP0190 shell-args deprecation warning.
    spawnCmd = [command, ...args].join(" ");
    spawnArgs = [];
    useShell = true;
  }
  const child = spawn(spawnCmd, spawnArgs, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    shell: useShell,
  });
  const prefix = `[${name}] `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    if (name === "go" && !backendReady) {
      console.error(
        "\n❌ 后端进程已退出且未就绪。请确认已安装 Go 1.22+，并查看上方 [go] 日志。\n",
      );
    }
    shutdown();
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      if (isWindows && c.pid) {
        // Kill the whole process tree on Windows (SIGTERM doesn't cascade).
        spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"]);
      } else {
        c.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Poll the backend health endpoint and announce readiness (first build is slow).
let backendReady = false;
let waited = 0;
function pollHealth() {
  if (shuttingDown || backendReady) return;
  const req = http.get(HEALTH_URL, (res) => {
    res.resume();
    if (res.statusCode === 200) {
      backendReady = true;
      console.log(
        "\n✅ 后端就绪：http://localhost:8787" +
          "\n   浏览器打开 http://localhost:1420 ；手机同 WiFi 用 Vite 打印的局域网地址。\n",
      );
      return;
    }
    setTimeout(pollHealth, 500);
  });
  req.on("error", () => {
    waited += 500;
    if (waited === 5000) {
      console.log("⏳ 正在编译并启动 Go 后端（首次较慢，请稍候）…");
    }
    setTimeout(pollHealth, 500);
  });
}

run(
  "go",
  goCmd,
  ["run", "./cmd/server"],
  join(root, "server"),
  {
    POS_DATA_DIR: process.env.POS_DATA_DIR || join(root, "server", "data", "personal-os"),
    GOTOOLCHAIN: process.env.GOTOOLCHAIN || "auto",
  },
  false, // go(.exe) is a real binary; no shell needed
);
run("vite", npmCmd, ["run", "dev:web"], root, {}, true); // npm(.cmd) needs a shell on Windows

console.log(
  "\n  Personal OS (pure-web) 开发服务器启动中…\n" +
    "  首次运行会编译 Go 后端，可能需要一会儿；就绪后会在下方提示。\n" +
    "  API 健康检查： http://localhost:8787/api/health\n",
);
setTimeout(pollHealth, 800);
