import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const apiBaseUrl = process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3101";
const devServerPort = Number(process.env.CHRONA_WEB_PORT ?? "3100");

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    exclude: ["@chrona/server", "@chrona/engine", "@chrona/db"],
  },
  server: {
    port: devServerPort,
    proxy: {
      "/api": {
        target: apiBaseUrl,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      "/health": {
        target: apiBaseUrl,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
