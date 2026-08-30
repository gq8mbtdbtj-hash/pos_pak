import { useEffect, useState } from "react";
import { isWeb } from "../lib/platform";

const WEB_VERSION = "0.1.2";

export default function TitleBar() {
  const web = isWeb();
  const [version, setVersion] = useState(WEB_VERSION);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (web) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      // Tauri-only window chrome; dynamically imported so the web bundle never
      // pulls in the desktop-only modules.
      const [{ getVersion }, { getCurrentWindow }] = await Promise.all([
        import("@tauri-apps/api/app"),
        import("@tauri-apps/api/window"),
      ]);
      if (cancelled) return;
      getVersion().then(setVersion).catch(() => setVersion(WEB_VERSION));
      const win = getCurrentWindow();
      win.isMaximized().then(setMaximized).catch(() => undefined);
      win
        .onResized(() => {
          win.isMaximized().then(setMaximized).catch(() => undefined);
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [web]);

  const win = async () => (await import("@tauri-apps/api/window")).getCurrentWindow();

  return (
    <header className="titlebar" data-tauri-drag-region={web ? undefined : true}>
      <div className="titlebar-left" data-tauri-drag-region={web ? undefined : true}>
        <span className="titlebar-mark" aria-hidden />
        <span className="titlebar-name" data-tauri-drag-region={web ? undefined : true}>
          Personal OS
        </span>
        <span className="titlebar-version">v{version}</span>
      </div>
      {!web && (
        <div className="titlebar-controls">
          <button
            type="button"
            className="titlebar-btn"
            aria-label="最小化"
            onClick={() => void win().then((w) => w.minimize())}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            type="button"
            className="titlebar-btn"
            aria-label={maximized ? "还原" : "最大化"}
            onClick={() => void win().then((w) => w.toggleMaximize())}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path
                  d="M2.5 3.5h4v4h-4zM3.5 2.5h4v4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.1"
                />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <rect
                  x="1.5"
                  y="1.5"
                  width="7"
                  height="7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="titlebar-btn titlebar-close"
            aria-label="关闭"
            onClick={() => void win().then((w) => w.close())}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
}
