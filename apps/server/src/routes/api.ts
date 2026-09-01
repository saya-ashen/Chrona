import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";

import { json } from "../lib/http";

import { createTaskRoutes } from "./tasks";
import { createPageRoutes } from "./pages";
import { createWorkspacesRoutes } from "./workspaces.routes";
import { createGoalRoutes } from "./goals.routes";
import { createGoalWorkbenchRoutes } from "./goal-workbench.routes";
import { createTaskTriggerRoutes } from "./task-triggers.routes";
import { createEmailTriggerAdapterRoutes } from "./email-trigger-adapter.routes";
import { createClientsRoutes } from "./ai/clients.routes";
import { createAiSuggestionRoutes } from "./ai/suggestions.routes";
import { createAssistantSurfaceRoutes } from "./assistant-surface.routes";
import { createMcpRoutes, createAgentControlRoutes } from "../../../../features/mcp-control-plane/server";
import { createRuntimeRoutes } from "./runtime.routes";
import { createHermesIntegrationRoutes } from "./integrations/hermes.routes";
import { createCalendarSourceRoutes, type CalendarSourceRouteOptions } from "../../../../features/external-calendar/server";
import { areE2eTestRoutesEnabled, createTestSupportRoutes } from "./test-support.routes";

export type ApiRouterOptions = {
  calendarSources?: CalendarSourceRouteOptions;
  /** Passed from the server composition root; MCP owns scoped run-token auth. */
  mcpApiKey?: string;
};

export type ApiRouter = Hono;

export function createApiRouter(engine: ChronaEngine, options: ApiRouterOptions = {}) {
  const router = new Hono()
    .get("/health", (c) => json(c, { status: "ok" }))
    .get("/ready", async (c) => {
      const readiness = await engine.runtime.getReadiness();
      return json(c, readiness, readiness.status === "ready" ? 200 : 503);
    })
    .route("/", createTaskRoutes(engine))
    .route("/", createPageRoutes(engine))
    .route("/", createWorkspacesRoutes(engine))
    .route("/", createGoalRoutes(engine))
    .route("/", createGoalWorkbenchRoutes(engine))
    .route("/", createTaskTriggerRoutes(engine))
    .route("/", createEmailTriggerAdapterRoutes(engine))
    .route("/", createClientsRoutes(engine))
    .route("/", createAiSuggestionRoutes(engine))
    .route("/", createHermesIntegrationRoutes())
    .route("/", createCalendarSourceRoutes(options.calendarSources))
    .route("/", createRuntimeRoutes(engine))
    .route("/", createAssistantSurfaceRoutes(engine))
    .route("/", createMcpRoutes(engine, { apiKey: options.mcpApiKey }))
    .route("/", createAgentControlRoutes());

  // Env-gated E2E test seam — only ever mounted when the Playwright webServer
  // sets CHRONA_E2E_TEST_ROUTES=1. Keeps the production surface unchanged.
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
