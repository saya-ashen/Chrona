import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  createGoalBodySchema,
  goalActionBodySchema,
  goalIdParamSchema,
  listGoalsQuerySchema,
  promoteTaskToGoalBodySchema,
  promoteTaskToGoalParamSchema,
  updateGoalBodySchema,
} from "@chrona/contracts/api";
import { error, internalServerError, json, toHttpError } from "../lib/http";

function routeFailure(c: Parameters<typeof error>[0], route: string, cause: unknown, fallback: string) {
  const httpError = toHttpError(cause);
  if (httpError) return error(c, httpError.message, httpError.status);
  return internalServerError(c, route, cause, fallback);
}

export function createGoalRoutes(engine: ChronaEngine) {
  return new Hono()
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
    )
    .post(
      "/tasks/:taskId/actions/promote-to-goal",
      zValidator("param", promoteTaskToGoalParamSchema),
      zValidator("json", promoteTaskToGoalBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.promoteTask({
            taskId: c.req.valid("param").taskId,
            command: c.req.valid("json"),
          }), 201);
        } catch (cause) {
          return routeFailure(c, "POST /api/tasks/:taskId/actions/promote-to-goal", cause, "Failed to promote task to Goal");
        }
      },
    );
}
