import { Hono } from "hono";

import { json } from "../lib/http";

import { createTaskRoutes } from "./tasks";
import { createPageRoutes } from "./pages";
import { createWorkspacesRoutes } from "./workspaces.routes";
import { createClientsRoutes } from "./ai/clients.routes";

export function createApiRouter() {
  return new Hono()
    .get("/health", (c) => json(c, { status: "ok" }))
    .route("/", createTaskRoutes())
    .route("/", createPageRoutes())
    .route("/", createWorkspacesRoutes())
    .route("/", createClientsRoutes());
}

/**
 * Exported type for the hono/client RPC:
 *   import type { ApiType } from "@chrona/server/routes/api";
 *   import { hc } from "hono/client";
 *   const client = hc<ApiType>("/api");
 */
export type ApiType = ReturnType<typeof createApiRouter>;
