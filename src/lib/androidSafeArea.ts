/** Apply Android system-bar insets exposed by MainActivity (`--sab` / `--sat`). */

export function initAndroidSafeAreaFallback(): void {
  if (typeof window === "undefined") return;
  if (!/Android/i.test(navigator.userAgent || "")) return;

  const root = document.documentElement;
  // Until native injects real insets, assume 3-button nav (~48dp) so tabs aren't covered.
  if (!root.style.getPropertyValue("--sab")) {
    root.style.setProperty("--sab", "48px");
    root.dataset.androidNav = root.dataset.androidNav || "buttons";
  }

  window.setTimeout(() => {
    const sab = root.style.getPropertyValue("--sab").trim();
    // If still the conservative default and native never wrote dataset, keep 48px.
    if (!root.dataset.androidNav && (!sab || sab === "0px")) {
      root.style.setProperty("--sab", "48px");
      root.dataset.androidNav = "buttons";
    }
  }, 1200);
}
