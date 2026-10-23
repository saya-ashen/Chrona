import { Hono } from "hono";
import { z } from "zod";
import { createStewardRoutes } from "./steward.routes";
import { createStewardAgentRoutes } from "./steward-agent.routes";
import type { StewardRuntime } from "../steward-runtime";

export type ApiRouterOptions = { steward: StewardRuntime };
export type ApiRouter = Hono;

const localTestItems = z.object({ items: z.array(z.object({
  externalId: z.string().min(1).max(200), from: z.string().min(1).max(500), subject: z.string().max(1000),
  body: z.string().max(200 * 1024), receivedAt: z.string().datetime({ offset: true }),
}).strict()).min(1).max(50) }).strict();

export function createApiRouter({ steward }: ApiRouterOptions) {
  const service = steward.service;
  const router = new Hono()
    .get("/workspaces", async c => c.json(await steward.ports.db.workspace.findMany({ select: { id: true, name: true } })))
    .route("/steward", createStewardRoutes(steward.ports, service, steward.wake))
    .route("/steward-agent", createStewardAgentRoutes(steward.ports, service));
  // Test-only inbox for real-Provider runs of inbound flows; items still go through connector sync.
  if (process.env.CHRONA_E2E_TEST_ROUTES === "1") router.post("/steward-e2e/local-test-items", async c => {
    const parsed = localTestItems.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ code: "INVALID_REQUEST" }, 400);
    steward.localTest.push(parsed.data.items.map(item => ({ ...item, url: null })));
    return c.json({ queued: parsed.data.items.length });
  });

  return router;
}

export type ApiType = ReturnType<typeof createApiRouter>;
