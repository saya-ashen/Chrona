import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Deliberately ignore generic E2E DB/port overrides: never reuse a dev server.
const dbPath = resolve(`e2e/.steward-${process.pid}-${Date.now()}.db`);
const database = `file:${dbPath}`;
const baseURL = "http://127.0.0.1:48131";
process.env.CHRONA_E2E_GENERATED_DB_PATH = dbPath;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /steward-loop\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: "list",
  outputDir: "test-results/steward",
  globalTeardown: "./e2e/cleanup-e2e-db.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: `bun run scripts/init-sqlite-db.ts --reset "${dbPath}" && DATABASE_URL="${database}" bun run db:seed && HOST=127.0.0.1 PORT=48130 ALLOWED_ORIGINS="${baseURL}" DATABASE_URL="${database}" VITE_API_BASE_URL=http://127.0.0.1:48130 CHRONA_WEB_PORT=48131 CHRONA_E2E_TEST_ROUTES=1 CHRONA_ENABLE_DEBUG_PROVIDER=false CHRONA_TASK_ORCHESTRATOR_ENABLED=false CHRONA_STEWARD_TICK_SECONDS=0 bun run e2e/results-server.ts`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true } },
  ],
});
