import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

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
        target: process.env.VITE_API_BASE_URL ?? "http://localhost:3101",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.VITE_API_BASE_URL ?? "http://localhost:3101",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
