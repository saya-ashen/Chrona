import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";
import { registerGoalCoreRoutes } from "./goals-core.routes";
import { registerGoalReviewRoutes } from "./goals-review.routes";
import { registerGoalTaskRoutes } from "./goals-task.routes";

export function createGoalRoutes(engine: ChronaEngine) {
  const app = new Hono();
  registerGoalCoreRoutes(app, engine);
  registerGoalTaskRoutes(app, engine);
  registerGoalReviewRoutes(app, engine);
  return app;
}
