import { Hono } from "hono";

import { json } from "../lib/http";

import { createTasksRoutes } from "./tasks.routes";
import { createProjectionsRoutes } from "./projections.routes";
import { createExecutionRoutes } from "./execution.routes";
import { createPlansRoutes } from "./plans.routes";
import { createAiRoutes } from "./ai.routes";

export function createApiRouter() {
  return new Hono()
    .get("/health", (c) => json(c, { status: "ok" }))
    .route("/", createTasksRoutes())
    .route("/", createProjectionsRoutes())
    .route("/", createExecutionRoutes())
    .route("/", createPlansRoutes())
    .route("/", createAiRoutes());
}

/**
 * Exported type for the hono/client RPC:
 *   import type { ApiType } from "@chrona/server/routes/api";
 *   import { hc } from "hono/client";
 *   const client = hc<ApiType>("/api");
 */
export type ApiType = ReturnType<typeof createApiRouter>;
