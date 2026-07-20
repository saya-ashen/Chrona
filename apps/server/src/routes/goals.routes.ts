import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  createGoalBodySchema,
  createGoalTaskBodySchema,
  goalActionBodySchema,
  goalIdParamSchema,
  goalArtifactParamSchema,
  listGoalsQuerySchema,
  promoteTaskToGoalBodySchema,
  promoteTaskToGoalParamSchema,
  updateGoalBodySchema,
  updateGoalBriefBodySchema,
  updateGoalWorkingSetBodySchema,
} from "@chrona/contracts/api";
import { error, internalServerError, json, toHttpError } from "../lib/http";

function routeFailure(c: Parameters<typeof error>[0], route: string, cause: unknown, fallback: string) {
  const httpError = toHttpError(cause);
  if (httpError) return error(c, httpError.message, httpError.status);
  return internalServerError(c, route, cause, fallback);
}

// Route composition intentionally keeps the closed Goal HTTP surface together.
// eslint-disable-next-line max-lines-per-function
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
    .put(
      "/goals/:goalId/working-set",
      zValidator("param", goalIdParamSchema),
      zValidator("json", updateGoalWorkingSetBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.updateWorkingSet({
            goalId: c.req.valid("param").goalId,
            selections: c.req.valid("json").selections,
          }));
        } catch (cause) {
          return routeFailure(c, "PUT /api/goals/:goalId/working-set", cause, "Failed to update Goal working set");
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
      "/goals/:goalId/tasks",
      zValidator("param", goalIdParamSchema),
      zValidator("json", createGoalTaskBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.createTask({
            goalId: c.req.valid("param").goalId,
            command: c.req.valid("json"),
          }), 201);
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/tasks", cause, "Failed to create Goal task");
        }
      },
    )
    .get(
      "/goals/:goalId/artifacts/:artifactId",
      zValidator("param", goalArtifactParamSchema),
      async (c) => {
        try {
          return json(c, await engine.goals.getArtifact(c.req.valid("param")));
        } catch (cause) {
          return routeFailure(c, "GET /api/goals/:goalId/artifacts/:artifactId", cause, "Failed to get Goal artifact");
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
