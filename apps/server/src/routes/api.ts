import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";

import { json } from "../lib/http";

import { createTaskRoutes } from "./tasks";
import { createPageRoutes } from "./pages";
import { createWorkspacesRoutes } from "./workspaces.routes";
import { createClientsRoutes } from "./ai/clients.routes";
import { createAssistantSurfaceRoutes } from "./assistant-surface.routes";
import { createMcpRoutes } from "./mcp/mcp.routes";
import { createRuntimeRoutes } from "./runtime.routes";
import { createHermesIntegrationRoutes } from "./integrations/hermes.routes";
import { createCalendarSourceRoutes, type CalendarSourceRouteOptions } from "./calendar-sources.routes";
import { areE2eTestRoutesEnabled, createTestSupportRoutes } from "./test-support.routes";
import { createAgentControlRoutes } from "./agent-control.routes";

export type ApiRouterOptions = {
  calendarSources?: CalendarSourceRouteOptions;
};

export function createApiRouter(engine: ChronaEngine, options: ApiRouterOptions = {}) {
  const router = new Hono()
    .get("/health", (c) => json(c, { status: "ok" }))
    .route("/", createTaskRoutes(engine))
    .route("/", createPageRoutes(engine))
    .route("/", createWorkspacesRoutes(engine))
    .route("/", createClientsRoutes(engine))
    .route("/", createHermesIntegrationRoutes())
    .route("/", createCalendarSourceRoutes(options.calendarSources))
    .route("/", createRuntimeRoutes(engine))
    .route("/", createAssistantSurfaceRoutes(engine))
    .route("/", createMcpRoutes(engine))
    .route("/", createAgentControlRoutes());
  if (areE2eTestRoutesEnabled()) {
    router.route("/", createTestSupportRoutes(engine));
  }

  return router;
}

/**
 * Exported type for the hono/client RPC:
 *   import type { ApiType } from "@chrona/server/routes/api";
 *   import { hc } from "hono/client";
 *   const client = hc<ApiType>("/api");
 */
export type ApiType = ReturnType<typeof createApiRouter>;
