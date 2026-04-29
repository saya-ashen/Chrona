import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const E2E_DATABASE_URL = `file:${resolve("prisma/dev.db")}`;

/**
 * Default CI-stable Playwright config.
 *
 * Only runs stable E2E tests under e2e/specs/.  Demo / recording scripts
 * live under e2e/demo/ and run via their own configs:
 *   - bun run test:e2e:demo    (playwright.demo.config.ts)
 *   - bun run test:e2e:record  (playwright.record.config.ts)
 */
export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: `DATABASE_URL="${E2E_DATABASE_URL}" bun run db:seed && bun run dev`,
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
