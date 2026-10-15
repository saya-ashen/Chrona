import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    include: ["features/steward/**/*.test.{ts,tsx}", "apps/web/src/**/*.test.{ts,tsx}", "packages/{shared,logging,i18n}/src/**/*.test.{ts,tsx}", "shared/ui/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "**/*.bun.test.ts"],
    environment: "jsdom",
    setupFiles: ["./apps/web/src/test/setup.ts"],
    server: { deps: { inline: [/^@chrona\//] } },
    testTimeout: 15_000,
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
