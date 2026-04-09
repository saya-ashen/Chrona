import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const E2E_DATABASE_URL = `file:${resolve("prisma/dev.db")}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: `DATABASE_URL="${E2E_DATABASE_URL}" bun run db:seed && DATABASE_URL="${E2E_DATABASE_URL}" bun run dev -- --hostname 127.0.0.1 --port 3100`,
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
