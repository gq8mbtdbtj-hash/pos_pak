/** Shared desktop + mobile platform helpers. One codebase; no forks. */

export type AppPlatform = "desktop" | "mobile";

let cached: AppPlatform | null = null;

export function detectPlatform(): AppPlatform {
  if (cached) return cached;
  if (typeof window === "undefined") {
    cached = "desktop";
    return cached;
  }
  const ua = navigator.userAgent || "";
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const narrow =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 860px)").matches;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  // Tauri Android/iOS webviews usually expose Android/iPhone in UA.
  cached = mobileUa || (coarse && narrow) ? "mobile" : "desktop";
  return cached;
}

export function isMobile(): boolean {
  return detectPlatform() === "mobile";
}

export function isDesktop(): boolean {
  return detectPlatform() === "desktop";
}

/**
 * True in the pure-web build (no Tauri runtime). Detected by the absence of
 * Tauri's injected internals so the same source also works if bundled for Tauri.
 */
export function isWeb(): boolean {
  return (
    typeof window === "undefined" ||
    !(
      "__TAURI_INTERNALS__" in window ||
      "__TAURI__" in window ||
      "__TAURI_METADATA__" in window
    )
  );
}

/**
 * Knowledge document create/update/delete. On desktop this was desktop-only;
 * in the pure-web build the phone browser is the primary entry point, so
 * editing is allowed there too.
 */
export function canEditKnowledge(): boolean {
  return isWeb() || isDesktop();
}
