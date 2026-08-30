import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { isDesktop, isMobile } from "./platform";
import { ANDROID_APK_DOWNLOAD_URL } from "./updateConfig";

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  notes?: string;
  /** Desktop: can run plugin downloadAndInstall. Mobile: open apkUrl. */
  desktopInstallable: boolean;
  apkUrl: string;
};

export type UpdateCheckResult =
  | { status: "available"; info: UpdateInfo }
  | { status: "upToDate"; currentVersion: string; latestVersion: string }
  | { status: "unavailable"; currentVersion: string; reason: string };

type LatestJson = {
  version?: string | null;
  notes?: string | null;
};

function normalizeVer(v: string) {
  return v.trim().replace(/^v/i, "");
}

/** SemVer-ish compare: 1 if a>b, -1 if a<b, 0 if equal/unparseable equal-ish. */
export function compareSemver(a: string, b: string): number {
  const pa = normalizeVer(a)
    .split(/[.+-]/)
    .map((x) => Number.parseInt(x, 10));
  const pb = normalizeVer(b)
    .split(/[.+-]/)
    .map((x) => Number.parseInt(x, 10));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i]! : 0;
    const y = Number.isFinite(pb[i]) ? pb[i]! : 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export async function currentAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}

/** Native HTTP — avoids WebView CORS blocking GitHub Release assets. */
async function fetchLatestManifest(): Promise<LatestJson> {
  const remote = await invoke<LatestJson | null>("fetch_update_manifest");
  if (!remote?.version) {
    throw new Error("未获取到远端版本信息（Release / latest.json）");
  }
  return remote;
}

/**
 * Full update check with explicit up-to-date vs fetch-failed.
 * Prefer this over checkForAppUpdate for Settings UI.
 */
export async function checkAppUpdateStatus(): Promise<UpdateCheckResult> {
  const currentVersion = normalizeVer(await currentAppVersion());
  let remote: LatestJson;
  try {
    remote = await fetchLatestManifest();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { status: "unavailable", currentVersion, reason };
  }
  const latestVersion = normalizeVer(remote.version ?? "");
  if (!latestVersion) {
    return {
      status: "unavailable",
      currentVersion,
      reason: "latest.json 缺少 version 字段",
    };
  }
  if (compareSemver(latestVersion, currentVersion) <= 0) {
    return { status: "upToDate", currentVersion, latestVersion };
  }
  return {
    status: "available",
    info: {
      currentVersion,
      latestVersion,
      notes: remote.notes ?? undefined,
      desktopInstallable: isDesktop(),
      apkUrl: ANDROID_APK_DOWNLOAD_URL,
    },
  };
}

/**
 * Returns update info when remote version is newer; otherwise null.
 * Throws when the remote manifest cannot be fetched (do not treat as up-to-date).
 */
export async function checkForAppUpdate(): Promise<UpdateInfo | null> {
  const result = await checkAppUpdateStatus();
  if (result.status === "unavailable") {
    throw new Error(result.reason);
  }
  if (result.status === "upToDate") return null;
  return result.info;
}

/** Desktop: download & install via updater plugin, then relaunch. */
export async function installDesktopUpdate(): Promise<void> {
  if (!isDesktop()) {
    throw new Error("仅桌面端支持自动安装更新");
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const update = await check();
  if (!update) {
    throw new Error("未找到可安装的更新包（请确认 Release 已上传签名产物）");
  }
  await update.downloadAndInstall();
  await relaunch();
}

export async function openAndroidApkDownload(url = ANDROID_APK_DOWNLOAD_URL) {
  try {
    await open(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/scoped shell|not allowed|scope/i.test(msg)) {
      throw new Error(
        "无法打开下载链接（shell 权限）。请更新到最新版应用后重试。",
      );
    }
    throw e;
  }
}

export function updatePlatformHint() {
  if (isMobile()) return "将打开浏览器下载 APK，请手动安装";
  return "将下载并安装更新，完成后自动重启";
}
