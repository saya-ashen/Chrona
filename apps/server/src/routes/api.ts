import { Hono } from "hono";
import { areE2eTestRoutesEnabled, createTestSupportRoutes } from "./test-support.routes";
import { createStewardRoutes } from "./steward.routes";
import { createStewardAgentRoutes } from "./steward-agent.routes";
import type { StewardRuntime } from "../steward-runtime";

export type ApiRouterOptions = { steward: StewardRuntime };
export type ApiRouter = Hono;

export function createApiRouter({ steward }: ApiRouterOptions) {
  const service = steward.service;
  const router = new Hono()
    .get("/workspaces", async c => c.json(await steward.ports.db.workspace.findMany({ select: { id: true, name: true } })))
    .route("/steward", createStewardRoutes(steward.ports, service, () => { void steward.agent.runAgentOnce(); }))
    .route("/steward-agent", createStewardAgentRoutes(steward.ports, service));

  // Only mounted when the host explicitly enables the steward E2E seam.
  if (areE2eTestRoutesEnabled()) router.route("/", createTestSupportRoutes(steward));
  return router;
}

export type ApiType = ReturnType<typeof createApiRouter>;
