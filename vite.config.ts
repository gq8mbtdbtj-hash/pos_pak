import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pure-web dev server. Binds on all interfaces so a same-WiFi phone can reach
// it, and proxies `/api` to the Go backend (default :8787). Override the target
// with POS_API_TARGET if the backend runs elsewhere.
const apiTarget = process.env.POS_API_TARGET || "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
