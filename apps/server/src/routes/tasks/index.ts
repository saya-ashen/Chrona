import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";

import { createTasksRoutes } from "./crud.routes";
import { createExecutionRoutes } from "./execution.routes";
import { createTaskLifecycleRoutes } from "./lifecycle.routes";
import { createPlansRoutes } from "./plan.routes";
import { createTaskResultRoutes } from "./result.routes";
import { createTaskScheduleRoutes } from "./schedule.routes";

export function createTaskRoutes(engine: ChronaEngine) {
  return new Hono()
    .route("/", createTaskScheduleRoutes(engine))
    .route("/", createTasksRoutes(engine))
    .route("/", createPlansRoutes(engine))
    .route("/", createExecutionRoutes(engine))
    .route("/", createTaskLifecycleRoutes(engine))
    .route("/", createTaskResultRoutes(engine));
}
