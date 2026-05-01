import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/.direnv/**",
      ".worktrees/**",
      "e2e/**",
      "**/*.bun.test.ts",
    ],
    environment: "jsdom",
    setupFiles: ["./apps/web/src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
