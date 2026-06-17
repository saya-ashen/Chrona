import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";

import { createDashboardRoutes } from "./dashboard.routes";
import { createInboxRoutes } from "./inbox.routes";
import { createMemoryRoutes } from "./memory.routes";
import { createScheduleRoutes } from "./schedule.routes";
import { createWorkRoutes } from "./work.routes";

export function createPageRoutes(engine: ChronaEngine) {
  return new Hono()
    .route("/", createScheduleRoutes(engine))
    .route("/", createInboxRoutes(engine))
    .route("/", createDashboardRoutes(engine))
    .route("/", createMemoryRoutes(engine))
    .route("/", createWorkRoutes(engine));
}
