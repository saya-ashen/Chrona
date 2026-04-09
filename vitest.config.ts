import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    exclude: [
      ...configDefaults.exclude,
      ".worktrees/**",
      "e2e/**",
      "**/*.bun.test.ts",
      "src/modules/db/**/*.test.ts",
    ],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
