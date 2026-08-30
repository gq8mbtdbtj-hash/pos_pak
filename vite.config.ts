import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// Pure-web dev: bind on all interfaces so a same-WiFi phone can reach the dev
// server, and proxy `/api` to the Go backend (default :8787). Override the
// target with POS_API_TARGET if the backend runs elsewhere.
const apiTarget = process.env.POS_API_TARGET || "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
