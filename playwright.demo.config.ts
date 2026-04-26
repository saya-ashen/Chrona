import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const DEMO_DATABASE_URL = `file:${resolve("prisma/dev.db")}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["demo.readme.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "artifacts/demo/playwright",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "off",
    video: "on",
    viewport: {
      width: 1440,
      height: 960,
    },
  },
  webServer: {
    command: `DATABASE_URL="${DEMO_DATABASE_URL}" bun run db:seed && bun run dev`,
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: {
          width: 1440,
          height: 960,
        },
      },
    },
  ],
});
