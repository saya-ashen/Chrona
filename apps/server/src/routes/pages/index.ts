import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";

import { createDashboardRoutes } from "./dashboard.routes";
import { createActionCenterRoutes } from "./action-center.routes";
import { createMemoryRoutes } from "./memory.routes";
import { createScheduleRoutes } from "../../../../../features/schedule/server";
import { createWorkRoutes } from "./work.routes";

export function createPageRoutes(engine: ChronaEngine) {
  return new Hono()
    .route("/", createScheduleRoutes(engine))
    .route("/", createActionCenterRoutes(engine))
    .route("/", createDashboardRoutes(engine))
    .route("/", createMemoryRoutes(engine))
    .route("/", createWorkRoutes(engine));
}
