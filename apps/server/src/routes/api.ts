import { Hono } from "hono";
import { createStewardRoutes } from "./steward.routes";
import { createStewardAgentRoutes } from "./steward-agent.routes";
import type { StewardRuntime } from "../steward-runtime";

export type ApiRouterOptions = { steward: StewardRuntime };
export type ApiRouter = Hono;

export function createApiRouter({ steward }: ApiRouterOptions) {
  const service = steward.service;
  const router = new Hono()
    .get("/workspaces", async c => c.json(await steward.ports.db.workspace.findMany({ select: { id: true, name: true } })))
    .route("/steward", createStewardRoutes(steward.ports, service, steward.wake))
    .route("/steward-agent", createStewardAgentRoutes(steward.ports, service));

  return router;
}

export type ApiType = ReturnType<typeof createApiRouter>;
