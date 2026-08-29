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

/** Knowledge create/update/delete/import — desktop only. Mobile is view + Q&A. */
export function canEditKnowledge(): boolean {
  return isDesktop();
}
