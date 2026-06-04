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
    testTimeout: 15_000,
    onConsoleLog(log: string) {
      if (log.includes("cannot contain a nested") || log.includes("validateDOMNesting")) {
        return false;
      }
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        lines: 50,
        functions: 45,
        branches: 40,
        statements: 50,
      },
    },
  },
});
