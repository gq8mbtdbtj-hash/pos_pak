/** Apply Android system-bar insets exposed by MainActivity (`--sab` / `--sat`). */

export function initAndroidSafeAreaFallback(): void {
  if (typeof window === "undefined") return;
  if (!/Android/i.test(navigator.userAgent || "")) return;

  const root = document.documentElement;
  // Until native injects real insets, assume 3-button nav (~48dp) so tabs aren't covered.
  // Do NOT set dataset.androidNav here — that would block visualViewport IME fallback
  // and can leave data-keyboard-open stuck if native inject is late.
  if (!root.style.getPropertyValue("--sab")) {
    root.style.setProperty("--sab", "48px");
  }

  window.setTimeout(() => {
    const sab = root.style.getPropertyValue("--sab").trim();
    if (!root.dataset.androidNav && (!sab || sab === "0px")) {
      root.style.setProperty("--sab", "48px");
    }
  }, 1200);
}

