import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pure-web dev server. Binds on all interfaces so a same-WiFi phone can reach
// it, and proxies `/api` to the Go backend (default :8787). Override the target
// with POS_API_TARGET if the backend runs elsewhere.
const apiTarget = process.env.POS_API_TARGET || "http://127.0.0.1:8787";

// While the Go backend is still compiling on first run, the proxy spits out a
// stack trace per request. Collapse that noise into a single friendly line.
const logger = createLogger();
const originalError = logger.error.bind(logger);
let backendWarned = false;
logger.error = (msg, options) => {
  if (typeof msg === "string" && msg.indexOf("http proxy error") !== -1) {
    if (!backendWarned) {
      backendWarned = true;
      originalError(
        "⏳ 后端(:8787)尚未就绪（首次编译中），就绪后自动恢复；请等待终端出现「后端就绪」再刷新页面。",
        options,
      );
    }
    return;
  }
  backendWarned = false;
  originalError(msg, options);
};

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  customLogger: logger,
  server: {
    port: 1420,
    strictPort: true,
    host: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configure: (proxy: any) => {
          // Return a clean 503 (not a socket hangup) while the backend is down.
          proxy.on("error", (_err: unknown, _req: unknown, res: any) => {
            try {
              if (res && res.writeHead && !res.headersSent) {
                res.writeHead(503, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "后端尚未就绪，请稍候…" }));
              }
            } catch {
              /* ignore */
            }
          });
        },
      },
    },
  },
});
