/**
 * Soft-keyboard helpers.
 *
 * MainActivity pads R.id.content by IME, zeros --sab while open, and toggles
 * data-keyboard-open. Frontend hides the tab bar only while that flag is set.
 */
export function initVisualViewportLock(): void {
  if (typeof window === "undefined") return;

  const root = document.documentElement;

  const setKeyboardOpen = (open: boolean) => {
    if (open) root.dataset.keyboardOpen = "1";
    else delete root.dataset.keyboardOpen;
  };

  const syncFromVisualViewport = () => {
    if (root.dataset.androidNav) {
      const ime = root.style.getPropertyValue("--ime").trim();
      const imePx = Number.parseInt(ime, 10);
      if (!ime || ime === "0px" || !Number.isFinite(imePx) || imePx <= 100) {
        setKeyboardOpen(false);
      }
      return;
    }

    const vv = window.visualViewport;
    if (!vv) {
      root.style.setProperty("--ime", "0px");
      setKeyboardOpen(false);
      return;
    }

    const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty("--ime", `${covered}px`);
    setKeyboardOpen(covered > 100);
  };

  const scrollFocusedDockInput = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return;
    if (!el.closest(".dash-capture-dock")) return;
    window.setTimeout(() => {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }, 80);
  };

  syncFromVisualViewport();
  window.visualViewport?.addEventListener("resize", syncFromVisualViewport);
  window.visualViewport?.addEventListener("scroll", syncFromVisualViewport);
  window.addEventListener("resize", syncFromVisualViewport);
  window.addEventListener("personal-os-ime", ((e: Event) => {
    const detail = (e as CustomEvent<{ ime?: number; open?: boolean }>).detail;
    if (detail && typeof detail.open === "boolean") {
      setKeyboardOpen(detail.open);
    } else if (detail && typeof detail.ime === "number") {
      setKeyboardOpen(detail.ime > 100);
    }
    if (detail?.open) scrollFocusedDockInput();
  }) as EventListener);
  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.closest(".dash-capture-dock")) {
      scrollFocusedDockInput();
    }
  });
  document.addEventListener("focusout", () => {
    window.setTimeout(syncFromVisualViewport, 180);
  });
}
