import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@/lib/db": resolve(import.meta.dirname, "apps/web/src/test/db.ts"),
      "@chrona/db/db": resolve(import.meta.dirname, "apps/web/src/test/chrona-db.ts"),
      "@chrona/db": resolve(import.meta.dirname, "apps/web/src/test/chrona-db.ts"),
      "@chrona/codex": resolve(import.meta.dirname, "apps/web/src/test/codex-provider.ts"),
      "@chrona/omp": resolve(import.meta.dirname, "apps/web/src/test/omp-provider.ts"),
      "@features": resolve(import.meta.dirname, "features"),
      "@shared/ui": resolve(import.meta.dirname, "shared/ui/index.ts"),
      "shared/ui": resolve(import.meta.dirname, "shared/ui"),
      "@shared/http": resolve(import.meta.dirname, "shared/http/index.ts"),
      "shared/http": resolve(import.meta.dirname, "shared/http"),
    },
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
    server: {
      deps: {
        inline: [/^@chrona\//],
      },
    },
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
