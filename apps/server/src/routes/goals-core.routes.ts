import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  createGoalBodySchema,
  createGoalWithFirstTaskBodySchema,
  goalActionBodySchema,
  goalIdParamSchema,
  listGoalsQuerySchema,
  updateGoalBodySchema,
  updateGoalBriefBodySchema,
} from "@chrona/contracts/api";
import type { Hono } from "hono";
import { json } from "../lib/http";
import { routeFailure } from "./goals-route-support";

export function registerGoalCoreRoutes(app: Hono, engine: ChronaEngine) {
  app
    .get("/goals", zValidator("query", listGoalsQuerySchema), async (c) => {
      try {
        return json(c, await engine.goals.list(c.req.valid("query")));
      } catch (cause) {
        return routeFailure(c, "GET /api/goals", cause, "Failed to list Goals");
      }
    })
    .post("/goals", zValidator("json", createGoalBodySchema), async (c) => {
      try {
        return json(c, await engine.goals.create(c.req.valid("json")), 201);
      } catch (cause) {
        return routeFailure(c, "POST /api/goals", cause, "Failed to create Goal");
      }
    })
    .post("/goals/with-first-task", zValidator("json", createGoalWithFirstTaskBodySchema), async (c) => {
      try {
        return json(c, await engine.goals.createWithFirstTask(c.req.valid("json")), 201);
      } catch (cause) {
        return routeFailure(c, "POST /api/goals/with-first-task", cause, "Failed to create Goal with first task");
      }
    })
    .get("/goals/:goalId", zValidator("param", goalIdParamSchema), async (c) => {
      try {
        return json(c, await engine.goals.get(c.req.valid("param")));
      } catch (cause) {
        return routeFailure(c, "GET /api/goals/:goalId", cause, "Failed to get Goal");
      }
    })
    .patch(
      "/goals/:goalId",
      zValidator("param", goalIdParamSchema),
      zValidator("json", updateGoalBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.update({
            goalId: c.req.valid("param").goalId,
            patch: c.req.valid("json"),
          }));
        } catch (cause) {
          return routeFailure(c, "PATCH /api/goals/:goalId", cause, "Failed to update Goal");
        }
      },
    )
    .put(
      "/goals/:goalId/brief",
      zValidator("param", goalIdParamSchema),
      zValidator("json", updateGoalBriefBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.updateBrief({
            goalId: c.req.valid("param").goalId,
            brief: c.req.valid("json").brief,
          }));
        } catch (cause) {
          return routeFailure(c, "PUT /api/goals/:goalId/brief", cause, "Failed to update Goal brief");
        }
      },
    )
    .post(
      "/goals/:goalId/actions",
      zValidator("param", goalIdParamSchema),
      zValidator("json", goalActionBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.action({
            goalId: c.req.valid("param").goalId,
            command: c.req.valid("json"),
          }));
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/actions", cause, "Failed to apply Goal action");
        }
      },
    );
}
