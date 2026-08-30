/** Release channel for Personal OS (releases-only repo; no app source). */
export const UPDATE_REPO = "gq8mbtdbtj-hash/pos_pak";

/** Tauri updater manifest on GitHub Releases. */
export const UPDATE_LATEST_JSON_URL = `https://github.com/${UPDATE_REPO}/releases/latest/download/latest.json`;

/**
 * Android APK asset name on the same Release.
 * Upload as this exact filename so the latest/download URL stays stable.
 */
export const ANDROID_APK_NAME = "personal-os.apk";

export const ANDROID_APK_DOWNLOAD_URL = `https://github.com/${UPDATE_REPO}/releases/latest/download/${ANDROID_APK_NAME}`;
