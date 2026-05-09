import { Hono } from "hono";

import { createTasksRoutes } from "./crud.routes";
import { createExecutionRoutes } from "./execution.routes";
import { createTaskLifecycleRoutes } from "./lifecycle.routes";
import { createPlansRoutes } from "./plan.routes";
import { createTaskResultRoutes } from "./result.routes";
import { createTaskScheduleRoutes } from "./schedule.routes";

export function createTaskRoutes() {
  return new Hono()
    .route("/", createTaskScheduleRoutes())
    .route("/", createTasksRoutes())
    .route("/", createPlansRoutes())
    .route("/", createExecutionRoutes())
    .route("/", createTaskLifecycleRoutes())
    .route("/", createTaskResultRoutes());
}
