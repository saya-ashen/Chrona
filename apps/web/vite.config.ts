import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

const apiBaseUrl = process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3101";

export default defineConfig({
  plugins: [react() as PluginOption],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    exclude: ["@chrona/server", "@chrona/engine", "@chrona/db"],
  },
  server: {
    port: 3100,
    proxy: {
      "/api": {
        target: apiBaseUrl,
        changeOrigin: true,
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
});
