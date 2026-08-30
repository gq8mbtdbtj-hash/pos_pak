import { isMobile } from "./platform";
import { ANDROID_APK_DOWNLOAD_URL } from "./updateConfig";

// Pure-web build: the server always serves the latest UI, so there is no in-app
// updater. These helpers keep the same exported surface as the desktop version
// (used by UpdatePopup / Settings / App) but degrade gracefully in the browser.

const WEB_VERSION = "0.1.2";

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  notes?: string;
  desktopInstallable: boolean;
  apkUrl: string;
};

export type UpdateCheckResult =
  | { status: "available"; info: UpdateInfo }
  | { status: "upToDate"; currentVersion: string; latestVersion: string }
  | { status: "unavailable"; currentVersion: string; reason: string };

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
  return WEB_VERSION;
}

export async function checkAppUpdateStatus(): Promise<UpdateCheckResult> {
  return {
    status: "unavailable",
    currentVersion: WEB_VERSION,
    reason: "Web 版由服务器直接提供最新界面，无需应用内更新。",
  };
}

/** Web build never surfaces an in-app update popup. */
export async function checkForAppUpdate(): Promise<UpdateInfo | null> {
  return null;
}

export async function installDesktopUpdate(): Promise<void> {
  throw new Error("Web 版无需安装更新：刷新页面即可获取最新界面。");
}

export async function openAndroidApkDownload(url = ANDROID_APK_DOWNLOAD_URL) {
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener");
  }
}

export function updatePlatformHint() {
  if (isMobile()) return "刷新页面即可获取最新界面";
  return "刷新页面即可获取最新界面";
}
