import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineConfig, devices } from "@playwright/test";

// Each viewport owns a fresh database and loopback-only servers. Never reuse dev.
const stamp = `${process.pid}-${Date.now()}`;
const projects = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
].map((project, index) => ({ ...project, port: 48130 + index * 2,
  dbPath: join(tmpdir(), `chrona-steward-${stamp}-${project.name}.db`) }));
process.env.CHRONA_STEWARD_E2E_DATABASES = JSON.stringify(projects.map(p => p.dbPath));

export default defineConfig({
  testDir: "./e2e",
  testMatch: /steward-loop\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: "list",
  outputDir: "test-results/steward",
  globalTeardown: "./e2e/steward-cleanup.ts",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: projects.flatMap(({ port, dbPath }) => {
    const baseURL = `http://127.0.0.1:${port}`, database = `file:${dbPath}`;
    return [{
      command: `HOST=127.0.0.1 PORT=${port} API_KEY=steward-e2e-owner ALLOWED_ORIGINS="http://127.0.0.1:${port + 1}" DATABASE_URL="${database}" CHRONA_E2E_TEST_ROUTES=1 CHRONA_STEWARD_ASSESSOR=rule CHRONA_STEWARD_AGENT=none CHRONA_STEWARD_AGENT_POLL_SECONDS=0 CHRONA_STEWARD_TICK_SECONDS=0 bun apps/server/src/index.bun.ts`,
      url: `${baseURL}/health`, reuseExistingServer: false, timeout: 120_000,
    }, {
      command: `VITE_API_BASE_URL=${baseURL} CHRONA_WEB_PORT=${port + 1} bunx --no-install vite --host 127.0.0.1 --config apps/web/vite.config.ts apps/web`,
      url: `http://127.0.0.1:${port + 1}`, reuseExistingServer: false, timeout: 120_000,
    }];
  }),
  projects: projects.map(({ name, width, height, port }) => ({ name,
    use: { ...devices["Desktop Chrome"], viewport: { width, height }, isMobile: name === "mobile", baseURL: `http://127.0.0.1:${port + 1}` },
  })),
});
