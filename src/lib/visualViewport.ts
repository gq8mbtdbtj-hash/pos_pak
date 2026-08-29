/**
 * Soft-keyboard open detection for mobile.
 * On Android 15+ / Tauri, visualViewport often does NOT shrink; MainActivity
 * pads the WebView and sets data-keyboard-open / --ime. This keeps a JS
 * fallback for browsers where visualViewport does update.
 */
export function initVisualViewportLock(): void {
  if (typeof window === "undefined") return;

  const root = document.documentElement;

  const sync = () => {
    // Prefer native IME signal from MainActivity when present.
    const nativeIme = root.style.getPropertyValue("--ime").trim();
    if (nativeIme && nativeIme !== "0px" && root.dataset.androidNav) {
      return;
    }

    const vv = window.visualViewport;
    if (!vv) {
      root.style.setProperty("--ime", "0px");
      delete root.dataset.keyboardOpen;
      return;
    }

    const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty("--ime", `${covered}px`);
    if (covered > 72) root.dataset.keyboardOpen = "1";
    else delete root.dataset.keyboardOpen;
  };

  sync();
  window.visualViewport?.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("scroll", sync);
  window.addEventListener("resize", sync);
}
