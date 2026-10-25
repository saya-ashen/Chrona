import { Hono } from "hono";
import { createStewardAgentRoutes } from "./steward-agent.routes";
import type { StewardRuntime } from "../steward-runtime";

export type ApiRouterOptions = { steward: StewardRuntime };
export type ApiRouter = Hono;

/** Kernel routes under /api: only the Provider's tool bridge. Everything else is a module's (`listen`, v2-8/v2-9). */
export function createApiRouter({ steward }: ApiRouterOptions) {
  return new Hono().route("/steward-agent", createStewardAgentRoutes(steward.ports, steward.service));
}

export type ApiType = ReturnType<typeof createApiRouter>;
