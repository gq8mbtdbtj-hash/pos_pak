#!/usr/bin/env node
/**
 * Build signed desktop bundle (+ optional Android APK) and publish to pos_pak GitHub Releases.
 *
 * Usage:
 *   node scripts/release-pos-pak.mjs --version 0.1.1 --notes "更新说明"
 *   npm run release:pos-pak
 *
 * Env:
 *   GITHUB_TOKEN or POS_PAK_GITHUB_TOKEN — PAT with repo scope on pos_pak
 *   TAURI_SIGNING_PRIVATE_KEY — optional override; script loads src-tauri/keys/updater.key
 *   TAURI_SIGNING_PRIVATE_KEY_PASSWORD — default "."
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPO = "gq8mbtdbtj-hash/pos_pak";
const ANDROID_APK_UPLOAD_NAME = "personal-os.apk";
const VERSION_FILES = [
  join(ROOT, "package.json"),
  join(ROOT, "src-tauri", "Cargo.toml"),
  join(ROOT, "src-tauri", "tauri.conf.json"),
];

const HELP = `
Personal OS → pos_pak 发版脚本

用法:
  node scripts/release-pos-pak.mjs [选项]

选项:
  -v, --version <semver>   版本号（如 0.1.1）
  -n, --notes <text>       更新说明（Release body + latest.json notes）
      --android            同时构建并上传 Android APK
      --skip-build         跳过构建，使用已有产物
      --skip-upload        仅构建/生成 latest.json，不上传 GitHub
      --manifest-only      仅更新 latest.json（须 --skip-build；安装包须已在 Release）
      --force-installer    即使 Release 已有安装包也重新上传
      --no-bump            不修改 package.json / Cargo.toml / tauri.conf.json
      --dry-run            打印计划，不执行构建与上传
  -y, --yes                上传前不再确认
      --repo <owner/repo>  发布仓库（默认 ${DEFAULT_REPO}）
      --token <pat>        GitHub PAT（或设 GITHUB_TOKEN / POS_PAK_GITHUB_TOKEN）
  -h, --help               显示帮助

示例:
  npm run release:pos-pak -- --version 0.1.1 --notes "首次支持自动更新"
  npm run release:pos-pak -- --version 0.1.2 --notes "修复打卡图表" --android -y
`.trim();

function parseArgs(argv) {
  const opts = {
    version: "",
    notes: "",
    android: false,
    skipBuild: false,
    skipUpload: false,
    manifestOnly: false,
    forceInstaller: false,
    noBump: false,
    dryRun: false,
    yes: false,
    repo: DEFAULT_REPO,
    token: "",
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-v":
      case "--version":
        opts.version = argv[++i] ?? "";
        break;
      case "-n":
      case "--notes":
        opts.notes = argv[++i] ?? "";
        break;
      case "--android":
        opts.android = true;
        break;
      case "--skip-build":
        opts.skipBuild = true;
        break;
      case "--manifest-only":
        opts.manifestOnly = true;
        opts.skipBuild = true;
        break;
      case "--force-installer":
        opts.forceInstaller = true;
        break;
      case "--skip-upload":
        opts.skipUpload = true;
        break;
      case "--no-bump":
        opts.noBump = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "-y":
      case "--yes":
        opts.yes = true;
        break;
      case "--repo":
        opts.repo = argv[++i] ?? DEFAULT_REPO;
        break;
      case "--token":
        opts.token = argv[++i] ?? "";
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`未知参数: ${arg}\n\n${HELP}`);
        }
    }
  }
  return opts;
}

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(`\n错误: ${msg}`);
  process.exit(1);
}

async function promptLine(question, defaultValue = "") {
  const rl = readline.createInterface({ input, output });
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  rl.close();
  return answer || defaultValue;
}

function readCurrentVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return String(pkg.version ?? "").trim();
}

function assertSemver(v) {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(v)) {
    fail(`版本号格式无效: ${v}（期望如 0.1.1）`);
  }
}

function bumpVersionFiles(version) {
  for (const file of VERSION_FILES) {
    let text = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    if (file.endsWith("package.json")) {
      const json = JSON.parse(text);
      json.version = version;
      writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
      log(`  ✓ ${rel} → ${version}`);
      continue;
    }
    if (file.endsWith("Cargo.toml")) {
      if (!/^version\s*=\s*".*"/m.test(text)) {
        fail(`${rel} 中未找到 version 字段`);
      }
      text = text.replace(/^version\s*=\s*".*"/m, `version = "${version}"`);
    } else if (file.endsWith("tauri.conf.json")) {
      const json = JSON.parse(text);
      json.version = version;
      writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
      log(`  ✓ ${rel} → ${version}`);
      continue;
    }
    writeFileSync(file, text, "utf8");
    log(`  ✓ ${rel} → ${version}`);
  }
}

function shellQuote(arg) {
  if (!/[\s"&|<>^]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function runCommand(label, command, args, extraEnv = {}) {
  log(`\n▶ ${label}`);
  const env = {
    ...process.env,
    ...extraEnv,
    CI: "true",
  };
  const isWin = process.platform === "win32";
  let result;
  if (isWin) {
    const cmdLine = [command, ...args.map(shellQuote)].join(" ");
    result = spawnSync("cmd.exe", ["/d", "/s", "/c", cmdLine], {
      cwd: ROOT,
      env,
      stdio: "inherit",
      shell: false,
    });
  } else {
    result = spawnSync(command, args, {
      cwd: ROOT,
      env,
      stdio: "inherit",
      shell: false,
    });
  }
  if (result.error || result.status !== 0) {
    const bits = [];
    if (result.status != null) bits.push(`exit ${result.status}`);
    if (result.signal) bits.push(`signal ${result.signal}`);
    if (result.error) bits.push(result.error.message);
    fail(`${label} 失败 (${bits.join("; ") || "unknown"})`);
  }
}

function signingEnv() {
  const keyPath = join(ROOT, "src-tauri", "keys", "updater.key");
  if (!existsSync(keyPath)) {
    fail(`未找到签名私钥: ${keyPath}`);
  }
  // Path form avoids multiline env issues on Windows when spawning npm.
  return {
    TAURI_SIGNING_PRIVATE_KEY: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? ".",
  };
}

function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

function detectPlatformKey(installerPath) {
  const base = basename(installerPath).toLowerCase();
  if (base.includes("aarch64") || base.includes("arm64")) {
    if (process.platform === "darwin") return "darwin-aarch64";
    return "windows-aarch64";
  }
  if (base.includes("x64") || base.includes("x86_64")) {
    if (process.platform === "darwin") return "darwin-x86_64";
    if (process.platform === "linux") return "linux-x86_64";
    return "windows-x86_64";
  }
  if (process.platform === "win32") return "windows-x86_64";
  if (process.platform === "darwin") return "darwin-aarch64";
  return "linux-x86_64";
}

function findWindowsUpdaterArtifacts() {
  const bundleRoot = join(ROOT, "src-tauri", "target", "release", "bundle");
  const files = walkFiles(bundleRoot);
  const installers = files.filter((f) => {
    const n = basename(f).toLowerCase();
    return n.endsWith("-setup.exe") || (n.endsWith(".exe") && n.includes("setup"));
  });

  if (installers.length === 0) {
    fail(
      `未找到 Windows 安装包。请先运行 npm run tauri build，产物应在:\n  ${bundleRoot}`,
    );
  }

  // Prefer NSIS bundle
  installers.sort((a, b) => {
    const score = (p) =>
      (p.toLowerCase().includes("nsis") ? 2 : 0) +
      (p.toLowerCase().includes("x64") ? 1 : 0);
    return score(b) - score(a);
  });

  const installer = installers[0];
  const sigCandidates = [`${installer}.sig`, `${installer}.exe.sig`];
  const sigPath = sigCandidates.find((p) => existsSync(p));
  if (!sigPath) {
    fail(
      `未找到签名文件 (.sig)。请确认 tauri.conf.json 中 createUpdaterArtifacts 为 true，且已设置签名环境变量。\n  安装包: ${installer}`,
    );
  }

  return {
    installer,
    sigPath,
    platform: detectPlatformKey(installer),
    uploadName: basename(installer),
  };
}

function findAndroidApk() {
  const apkRoot = join(
    ROOT,
    "src-tauri",
    "gen",
    "android",
    "app",
    "build",
    "outputs",
    "apk",
  );
  const files = walkFiles(apkRoot).filter((f) => f.toLowerCase().endsWith(".apk"));
  // Never publish debug / androidTest APKs
  const releaseApks = files.filter(
    (f) => /release/i.test(f) && !/androidTest|debug/i.test(f),
  );

  const prefer = (pred) => releaseApks.find(pred);
  const apk =
    prefer((p) => /universal/i.test(p)) ??
    prefer((p) => /arm64/i.test(p)) ??
    prefer((p) => /aarch64/i.test(p)) ??
    releaseApks.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

  if (!apk) {
    fail(
      `未找到 release APK（不要用 debug）。请先运行:\n  npm run android:build\n产物目录:\n  ${apkRoot}`,
    );
  }
  return apk;
}

function buildLatestJson({ version, notes, platform, signature, downloadUrl }) {
  return {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      [platform]: {
        signature: signature.trim(),
        url: downloadUrl,
      },
    },
  };
}

function writeLatestJson(outPath, payload) {
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveToken(explicit) {
  return (
    explicit ||
    process.env.POS_PAK_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    ""
  );
}

function formatGithubError(json, fallback) {
  if (typeof json !== "object" || !json) return fallback;
  const parts = [json.message ?? fallback];
  if (Array.isArray(json.errors)) {
    for (const e of json.errors) {
      const bit = [e.resource, e.field, e.code, e.message].filter(Boolean).join(" · ");
      if (bit) parts.push(`  - ${bit}`);
    }
  }
  return parts.join("\n");
}

async function githubRequest(token, path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...headers,
    },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const detail =
      typeof json === "object"
        ? formatGithubError(json, res.statusText)
        : typeof json === "string"
          ? json
          : res.statusText;
    throw new Error(`GitHub API ${method} ${path} → ${res.status}:\n${detail}`);
  }
  return json;
}

async function getRepoInfo(token, repo) {
  const [owner, name] = repo.split("/");
  return githubRequest(token, `/repos/${owner}/${name}`);
}

/** GitHub Releases require at least one commit to attach a tag. */
async function ensureRepoHasInitialCommit(token, repo) {
  const [owner, name] = repo.split("/");
  const info = await getRepoInfo(token, repo);
  if (info.size > 0) return info;

  log("  发布仓为空，创建初始 README commit（Release 需要至少一个 commit）…");
  const readme = `# Personal OS Releases

安装包发布仓（无应用源码）。请从 [Releases](https://github.com/${owner}/${name}/releases) 下载。

- \`latest.json\` — 桌面端自动更新清单
- \`personal-os.apk\` — Android APK
`;
  await githubRequest(token, `/repos/${owner}/${name}/contents/README.md`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: initialize release repository",
      content: Buffer.from(readme, "utf8").toString("base64"),
    }),
  });
  log("  ✓ 已初始化仓库");
  return getRepoInfo(token, repo);
}

async function listReleases(token, repo) {
  const [owner, name] = repo.split("/");
  return githubRequest(
    token,
    `/repos/${owner}/${name}/releases?per_page=100`,
  );
}

async function findReleaseByTag(token, repo, tag) {
  const [owner, name] = repo.split("/");
  try {
    return await githubRequest(
      token,
      `/repos/${owner}/${name}/releases/tags/${encodeURIComponent(tag)}`,
    );
  } catch (err) {
    if (String(err.message).includes("404")) return null;
    throw err;
  }
}

async function createRelease(token, repo, tag, version, notes, targetCommitish) {
  const [owner, name] = repo.split("/");
  return githubRequest(token, `/repos/${owner}/${name}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: targetCommitish,
      name: `v${version}`,
      body: notes,
      draft: false,
      prerelease: false,
    }),
  });
}

async function getOrCreateRelease(token, repo, tag, version, notes) {
  const existing = await findReleaseByTag(token, repo, tag);
  if (existing) return existing;

  const repoInfo = await ensureRepoHasInitialCommit(token, repo);
  const target = repoInfo.default_branch || "main";

  try {
    return await createRelease(token, repo, tag, version, notes, target);
  } catch (err) {
    const retry = await findReleaseByTag(token, repo, tag);
    if (retry) return retry;

    const all = await listReleases(token, repo);
    const byTag = all.find((r) => r.tag_name === tag);
    if (byTag) return byTag;

    throw err;
  }
}

async function deleteReleaseAsset(token, repo, assetId) {
  const [owner, name] = repo.split("/");
  await githubRequest(token, `/repos/${owner}/${name}/releases/assets/${assetId}`, {
    method: "DELETE",
  });
}

async function refreshRelease(token, repo, releaseId) {
  const [owner, name] = repo.split("/");
  return githubRequest(token, `/repos/${owner}/${name}/releases/${releaseId}`);
}

/** GitHub Release asset names often replace spaces with dots. */
function githubAssetKey(name) {
  return name.replace(/ /g, ".").toLowerCase();
}

function assetNamesConflict(localName, remoteName) {
  if (localName === remoteName) return true;
  return githubAssetKey(localName) === githubAssetKey(remoteName);
}

function githubUploadName(localName) {
  return localName.replace(/ /g, ".");
}

function findInstallerAsset(release, uploadName, version) {
  return (release.assets ?? []).find(
    (a) =>
      assetNamesConflict(uploadName, a.name) ||
      (/-setup\.exe$/i.test(a.name) && a.name.includes(version)),
  );
}

async function uploadReleaseAsset(token, repo, release, localPath, uploadName) {
  const [owner, name] = repo.split("/");
  const remoteName = githubUploadName(uploadName);
  const conflicts = (release.assets ?? []).filter((a) =>
    assetNamesConflict(uploadName, a.name),
  );
  for (const existing of conflicts) {
    log(`    删除已有资产 ${existing.name} (id ${existing.id})…`);
    await deleteReleaseAsset(token, repo, existing.id);
    release.assets = (release.assets ?? []).filter((a) => a.id !== existing.id);
  }

  const stat = statSync(localPath);
  const url = `https://uploads.github.com/repos/${owner}/${name}/releases/${release.id}/assets?name=${encodeURIComponent(remoteName)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "X-GitHub-Api-Version": "2022-11-28",
    },
    duplex: "half",
    body: createReadStream(localPath),
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const json = JSON.parse(text);
      detail = formatGithubError(json, text);
    } catch {
      /* keep text */
    }
    throw new Error(`上传 ${remoteName} 失败 → ${res.status}:\n${detail}`);
  }
  return JSON.parse(text);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const current = readCurrentVersion();
  let version = opts.version || (await promptLine("版本号", current));
  assertSemver(version);

  let notes =
    opts.notes ||
    (await promptLine("更新说明（Release 正文 + latest.json notes）"));
  if (!notes.trim()) {
    fail("更新说明不能为空");
  }

  const tag = version.startsWith("v") ? version : `v${version}`;
  version = version.replace(/^v/i, "");

  log("\n=== Personal OS 发版 ===");
  log(`版本: ${version}`);
  log(`Tag:  ${tag}`);
  log(`仓库: ${opts.repo}`);
  log(`Android: ${opts.android ? "是" : "否"}`);
  log(`跳过构建: ${opts.skipBuild ? "是" : "否"}`);
  log(`跳过上传: ${opts.skipUpload ? "是" : "否"}`);
  if (opts.manifestOnly) log(`仅更新 manifest: 是`);

  if (opts.dryRun) {
    log("\n[dry-run] 将执行版本写入、构建、生成 latest.json、创建 Release 并上传资产");
    return;
  }

  if (!opts.noBump && version !== current) {
    log("\n写入版本号…");
    bumpVersionFiles(version);
  } else if (!opts.noBump) {
    log(`\n版本已是 ${version}，跳过写入`);
  }

  // --skip-build only skips desktop; --android still builds APK when needed
  if (!opts.skipBuild) {
    runCommand("构建桌面安装包", "npm", ["run", "tauri", "build"], signingEnv());
  }
  if (opts.android && !opts.manifestOnly) {
    let needAndroidBuild = !opts.skipBuild;
    if (opts.skipBuild) {
      try {
        findAndroidApk();
        needAndroidBuild = false;
        log("\n已有 release APK，跳过 Android 构建");
      } catch {
        needAndroidBuild = true;
        log("\n未找到 release APK，将构建 Android…");
      }
    }
    if (needAndroidBuild) {
      runCommand("构建 Android APK", "npm", ["run", "android:build"]);
    }
  }

  const win = findWindowsUpdaterArtifacts();
  const signature = readFileSync(win.sigPath, "utf8");

  const outDir = join(ROOT, "scripts", ".release-out");
  mkdirSync(outDir, { recursive: true });
  const latestPath = join(outDir, "latest.json");

  const otherAssets = [];
  let apkStaging = null;
  if (opts.android && !opts.manifestOnly) {
    const apk = findAndroidApk();
    apkStaging = join(outDir, ANDROID_APK_UPLOAD_NAME);
    copyFileSync(apk, apkStaging);
    otherAssets.push({ path: apkStaging, name: ANDROID_APK_UPLOAD_NAME });
    log(`Android APK: ${relative(ROOT, apk)} → ${ANDROID_APK_UPLOAD_NAME}`);
  }

  log("\n待上传资产:");
  log(`  - ${win.uploadName} (${(statSync(win.installer).size / (1024 * 1024)).toFixed(2)} MB)`);
  log("  - latest.json（安装包上传后按 GitHub 实际 URL 生成）");
  for (const a of otherAssets) {
    const sizeMb = (statSync(a.path).size / (1024 * 1024)).toFixed(2);
    log(`  - ${a.name} (${sizeMb} MB)`);
  }
  log(`\nlatest.json 平台: ${win.platform}`);

  if (opts.skipUpload) {
    const previewUrl = `(上传后由 GitHub 返回，文件名中空格可能变为 ".")`;
    writeLatestJson(
      latestPath,
      buildLatestJson({
        version,
        notes,
        platform: win.platform,
        signature,
        downloadUrl: previewUrl,
      }),
    );
    log(`\n已生成 ${relative(ROOT, latestPath)}（预览 URL 占位）`);
    log("\n--skip-upload：已完成本地构建，未上传 GitHub。");
    return;
  }

  const token = resolveToken(opts.token);
  if (!token) {
    fail(
      "缺少 GitHub Token。请设置环境变量 GITHUB_TOKEN 或 POS_PAK_GITHUB_TOKEN，或使用 --token",
    );
  }

  if (!opts.yes) {
    const confirm = await promptLine("确认上传到 GitHub Release?", "y/N");
    if (!/^y(es)?$/i.test(confirm)) {
      log("已取消上传。");
      return;
    }
  }

  log("\n▶ 创建 / 获取 GitHub Release…");
  let release = await getOrCreateRelease(
    token,
    opts.repo,
    tag,
    version,
    notes,
  );
  release = await refreshRelease(token, opts.repo, release.id);
  log(`  使用 Release #${release.id} (${tag})`);

  const skipInstallerUpload =
    opts.manifestOnly ||
    (opts.skipBuild &&
      !opts.forceInstaller &&
      Boolean(findInstallerAsset(release, win.uploadName, version)));

  let installerAsset;
  if (skipInstallerUpload) {
    installerAsset = findInstallerAsset(release, win.uploadName, version);
    if (!installerAsset) {
      fail(
        "Release 上未找到安装包，无法仅更新 latest.json。去掉 --manifest-only 或不要 --skip-build。",
      );
    }
    log(`  安装包已存在，跳过上传: ${installerAsset.name}`);
    log(`    ✓ ${installerAsset.browser_download_url}`);
  } else {
    log(`  上传 ${githubUploadName(win.uploadName)}…`);
    installerAsset = await uploadReleaseAsset(
      token,
      opts.repo,
      release,
      win.installer,
      win.uploadName,
    );
    log(`    ✓ ${installerAsset.browser_download_url}`);
  }

  const latest = buildLatestJson({
    version,
    notes,
    platform: win.platform,
    signature,
    downloadUrl: installerAsset.browser_download_url,
  });
  writeLatestJson(latestPath, latest);
  log(`\n已生成 ${relative(ROOT, latestPath)}`);
  log(`下载 URL: ${installerAsset.browser_download_url}`);

  log("  上传 latest.json…");
  const latestAsset = await uploadReleaseAsset(
    token,
    opts.repo,
    release,
    latestPath,
    "latest.json",
  );
  log(`    ✓ ${latestAsset.browser_download_url}`);

  for (const asset of otherAssets) {
    log(`  上传 ${asset.name}…`);
    const uploaded = await uploadReleaseAsset(
      token,
      opts.repo,
      release,
      asset.path,
      asset.name,
    );
    log(`    ✓ ${uploaded.browser_download_url}`);
  }

  log("\n✅ 发版完成");
  log(`Release: https://github.com/${opts.repo}/releases/tag/${tag}`);
  log(`Updater: https://github.com/${opts.repo}/releases/latest/download/latest.json`);
  if (opts.android) {
    log(`APK:     https://github.com/${opts.repo}/releases/latest/download/${ANDROID_APK_UPLOAD_NAME}`);
  }
}

main().catch((err) => fail(err.message ?? String(err)));
