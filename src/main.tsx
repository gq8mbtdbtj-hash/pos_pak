import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Self-hosted fonts (bundled) — works offline and avoids Google Fonts, which is
// slow/blocked in mainland China. Latin subset only (Chinese text uses the
// system CJK fonts declared in the CSS font stacks).
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/newsreader/latin-600.css";
import "./index.css";
import { initAndroidSafeAreaFallback } from "./lib/androidSafeArea";
import { initVisualViewportLock } from "./lib/visualViewport";

initAndroidSafeAreaFallback();
initVisualViewportLock();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
