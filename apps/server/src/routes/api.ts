import { Hono } from "hono";

import { json } from "../lib/http";

import { createTasksRoutes } from "./tasks.routes";
import { createProjectionsRoutes } from "./projections.routes";
import { createExecutionRoutes } from "./execution.routes";
import { createPlansRoutes } from "./plans.routes";
import { createAiRoutes } from "./ai.routes";

export function createApiRouter() {
  const api = new Hono();

  api.get("/health", (c) => json(c, { status: "ok" }));

  api.route("/", createTasksRoutes());
  api.route("/", createProjectionsRoutes());
  api.route("/", createExecutionRoutes());
  api.route("/", createPlansRoutes());
  api.route("/", createAiRoutes());

  return api;
}
