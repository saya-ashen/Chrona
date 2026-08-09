import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const E2E_DB_PATH =
	process.env.CHRONA_E2E_DB_PATH ?? join(tmpdir(), "chrona-e2e.db");
const E2E_DATABASE_URL = `file:${E2E_DB_PATH}`;
const E2E_TEMPLATE_DB_PATH = process.env.CHRONA_E2E_TEMPLATE_DB_PATH;
const E2E_TEMPLATE_ARG = E2E_TEMPLATE_DB_PATH
	? ` --template "${E2E_TEMPLATE_DB_PATH}"`
	: "";
const E2E_WEB_PORT = process.env.CHRONA_E2E_WEB_PORT ?? "43100";
const E2E_API_PORT = process.env.CHRONA_E2E_API_PORT ?? "43101";
const E2E_BASE_URL = `http://127.0.0.1:${E2E_WEB_PORT}`;
const E2E_API_BASE_URL = `http://127.0.0.1:${E2E_API_PORT}`;

function findChromiumExecutable() {
	const candidates = [
		process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		process.env.CHROMIUM_BIN,
		process.env.CHROME_BIN,
		"/run/current-system/sw/bin/chromium",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
	];

	return candidates.find((candidate) => candidate && existsSync(candidate));
}

const CHROMIUM_EXECUTABLE_PATH = findChromiumExecutable();

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
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: E2E_BASE_URL,
		trace: "on-first-retry",
		...(CHROMIUM_EXECUTABLE_PATH
			? { launchOptions: { executablePath: CHROMIUM_EXECUTABLE_PATH } }
			: {}),
	},
	webServer: {
		command: `bun run scripts/init-sqlite-db.ts --reset${E2E_TEMPLATE_ARG} "${E2E_DB_PATH}" && DATABASE_URL="${E2E_DATABASE_URL}" bun run db:seed && HOST=127.0.0.1 PORT="${E2E_API_PORT}" ALLOWED_ORIGINS="${E2E_BASE_URL}" DATABASE_URL="${E2E_DATABASE_URL}" VITE_API_BASE_URL="${E2E_API_BASE_URL}" CHRONA_WEB_PORT="${E2E_WEB_PORT}" CHRONA_SERVER_WATCH=false CHRONA_E2E_CALENDAR_FIXTURES=1 CHRONA_E2E_TEST_ROUTES=1 CHRONA_ENABLE_DEBUG_PROVIDER=true CHRONA_TASK_ORCHESTRATOR_ENABLED=true CHRONA_TASK_ORCHESTRATOR_INTERVAL_MS=600000 bun run dev`,
		url: E2E_BASE_URL,
		reuseExistingServer: false,
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
			},
		},
		{
			name: "tablet",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1024, height: 768 },
			},
		},
		{
			name: "mobile",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 390, height: 844 },
				isMobile: true,
			},
		},
	],
});
