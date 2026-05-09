import { Hono } from "hono";

import { createInboxRoutes } from "./inbox.routes";
import { createMemoryRoutes } from "./memory.routes";
import { createScheduleRoutes } from "./schedule.routes";
import { createWorkRoutes } from "./work.routes";

export function createPageRoutes() {
  return new Hono()
    .route("/", createScheduleRoutes())
    .route("/", createInboxRoutes())
    .route("/", createMemoryRoutes())
    .route("/", createWorkRoutes());
}
