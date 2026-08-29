import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
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
