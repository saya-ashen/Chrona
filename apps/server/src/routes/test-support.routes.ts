import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";

import { internalServerError, json } from "../lib/http";

/**
 * Returns true only when the E2E test-support routes are explicitly enabled
 * via `CHRONA_E2E_TEST_ROUTES=1`. This flag is set ONLY by the Playwright
 * webServer command (`playwright.config.ts`) — never in production or normal
 * dev — so the test seam below cannot exist in a real deployment.
 */
export function areE2eTestRoutesEnabled(): boolean {
  const value = process.env.CHRONA_E2E_TEST_ROUTES?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * Test-only routes. These are mounted by `createApiRouter` ONLY when
 * `areE2eTestRoutesEnabled()` is true, so the bundle is identical in
 * production but the orchestrator can be driven deterministically from
 * Playwright (milestone §7.3: drive `tick()` from the test, do NOT add
 * sleep-based waits).
 */
export function createTestSupportRoutes(engine: ChronaEngine) {
  return new Hono().post("/test/orchestrator/tick", async (c) => {
    try {
      await engine.runtime.tickTaskOrchestrator();
      return json(c, { ok: true, tickedAt: new Date().toISOString() });
    } catch (cause) {
      return internalServerError(
        c,
        "POST /api/test/orchestrator/tick",
        cause,
        "Failed to run orchestrator tick",
      );
    }
  });
}
