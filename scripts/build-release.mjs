#!/usr/bin/env node
/**
 * Build a deployable release: the Vite frontend (`dist/`) plus statically-linked
 * Go server binaries for common targets (Raspberry Pi arm64 / armv7, and amd64).
 *
 * The Go backend is pure-Go (CGO_ENABLED=0), so cross-compiling needs no C
 * toolchain — you can build Pi binaries from any OS.
 *
 * Usage: npm run release
 * Output: release/dist/ (shared) + release/personal-os-server-<target>[.exe]
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, cpSync, rmSync, existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const releaseDir = join(root, "release");

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...opts, shell: isWindows });
  if (r.status !== 0) {
    console.error(`\n❌ 命令失败: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

// 1) Frontend
console.log("• 构建前端 (vite build → dist/) …");
sh(isWindows ? "npm.cmd" : "npm", ["run", "build"]);

// 2) Reset release dir + copy dist
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
if (!existsSync(join(root, "dist", "index.html"))) {
  console.error("❌ dist/ 未生成，前端构建可能失败。");
  process.exit(1);
}
cpSync(join(root, "dist"), join(releaseDir, "dist"), { recursive: true });

// 3) Cross-compile the Go server
const targets = [
  { name: "linux-arm64", GOOS: "linux", GOARCH: "arm64" }, // Raspberry Pi 3/4/5 64-bit OS
  { name: "linux-armv7", GOOS: "linux", GOARCH: "arm", GOARM: "7" }, // 32-bit Pi OS
  { name: "linux-amd64", GOOS: "linux", GOARCH: "amd64" }, // generic x86-64 server
];

for (const t of targets) {
  const out = join(releaseDir, `personal-os-server-${t.name}`);
  console.log(`• 交叉编译后端 → ${t.name} …`);
  sh(isWindows ? "go.exe" : "go",
    ["build", "-trimpath", "-ldflags", "-s -w", "-o", out, "./cmd/server"],
    {
      cwd: join(root, "server"),
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: t.GOOS,
        GOARCH: t.GOARCH,
        // 国内 Go 模块代理（免费）；已设置 GOPROXY 时尊重用户配置。
        GOPROXY: process.env.GOPROXY || "https://goproxy.cn,direct",
        ...(t.GOARM ? { GOARM: t.GOARM } : {}),
      },
    },
  );
}

console.log(
  "\n✅ 发布产物已生成到 release/：\n" +
    "   - dist/                              前端静态资源（所有目标共用）\n" +
    "   - personal-os-server-linux-arm64     树莓派 64 位系统\n" +
    "   - personal-os-server-linux-armv7     树莓派 32 位系统\n" +
    "   - personal-os-server-linux-amd64     通用 x86-64 服务器\n\n" +
    "把「匹配架构的二进制」+「dist/」拷到目标机同一目录，设置 POS_DIST_DIR 指向 dist 后运行。\n" +
    "详见 docs/deploy-raspberry-pi.md 与 docs/deploy-public-internet.md。\n",
);
