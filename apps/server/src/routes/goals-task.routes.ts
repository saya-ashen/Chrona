import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  createGoalTaskBodySchema,
  goalIdParamSchema,
  goalTaskParamSchema,
  processGoalResultBodySchema,
  reviewGoalCriterionBodySchema,
  confirmGoalCriterionBodySchema,
} from "@chrona/contracts/api";
import type { Hono } from "hono";
import { json } from "../lib/http";
import { routeFailure } from "./goals-route-support";

const goalCriterionParamSchema = goalTaskParamSchema
  .extend({ criterionId: goalIdParamSchema.shape.goalId })
  .omit({ taskId: true });

export function registerGoalTaskRoutes(app: Hono, engine: ChronaEngine) {
  app
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
    .post(
      "/goals/:goalId/results/:taskId/process",
      zValidator("param", goalTaskParamSchema),
      zValidator("json", processGoalResultBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.processResult({
            ...c.req.valid("param"),
            command: c.req.valid("json"),
          }));
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/results/:taskId/process", cause, "Failed to process Goal result");
        }
      },
    )
    .post(
      "/goals/:goalId/criteria/:criterionId/review",
      zValidator("param", goalCriterionParamSchema),
      zValidator("json", reviewGoalCriterionBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.reviewCriterion({
            ...c.req.valid("param"),
            command: c.req.valid("json"),
          }));
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/criteria/:criterionId/review", cause, "Failed to review Goal criterion");
        }
      },
    )
    .post(
      "/goals/:goalId/criteria/:criterionId/confirm",
      zValidator("param", goalCriterionParamSchema),
      zValidator("json", confirmGoalCriterionBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.confirmCriterion({
            ...c.req.valid("param"),
            command: c.req.valid("json"),
          }));
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/criteria/:criterionId/confirm", cause, "Failed to confirm Goal criterion");
        }
      },
    );
}
