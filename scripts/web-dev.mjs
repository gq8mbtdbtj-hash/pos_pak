#!/usr/bin/env node
/**
 * Pure-web dev launcher: runs the Go backend (:8787) and the Vite dev server
 * (:1420) together. Vite proxies `/api` to the backend, so open the printed
 * LAN URL on your phone (same WiFi) to use the app.
 *
 * Cross-platform (Windows / macOS / Linux); no extra dependencies.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

const children = [];

function run(name, command, args, cwd, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
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
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("go", "go", ["run", "./cmd/server"], join(root, "server"), {
  POS_DATA_DIR: process.env.POS_DATA_DIR || join(root, "server", "data", "personal-os"),
});
run("vite", npmCmd, ["run", "dev:web"], root);

process.stdout.write(
  "\n  Personal OS (pure-web) dev servers starting…\n" +
    "  UI:  http://localhost:1420  (open the LAN URL Vite prints on your phone)\n" +
    "  API: http://localhost:8787/api/health\n\n",
);
