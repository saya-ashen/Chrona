import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  applyGoalReviewBodySchema,
  applyGoalReviewProposalBodySchema,
  generateGoalReviewBodySchema,
  goalArtifactParamSchema,
  goalIdParamSchema,
  goalReviewProposalParamSchema,
  promoteTaskToGoalBodySchema,
  promoteTaskToGoalParamSchema,
  rejectGoalReviewProposalBodySchema,
} from "@chrona/contracts/api";
import type { Hono } from "hono";
import { json } from "../lib/http";
import { routeFailure } from "./goals-route-support";

export function registerGoalReviewRoutes(app: Hono, engine: ChronaEngine) {
  app
    .post(
      "/goals/:goalId/reviews/generate",
      zValidator("param", goalIdParamSchema),
      zValidator("json", generateGoalReviewBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.generateReview({
            goalId: c.req.valid("param").goalId,
            command: c.req.valid("json"),
          }), 202);
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/reviews/generate", cause, "Failed to generate Goal review");
        }
      },
    )
    .post(
      "/goals/:goalId/reviews/:proposalId/apply",
      zValidator("param", goalReviewProposalParamSchema),
      zValidator("json", applyGoalReviewProposalBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.applyReviewProposal({
            ...c.req.valid("param"),
            command: c.req.valid("json"),
          }));
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/reviews/:proposalId/apply", cause, "Failed to apply Goal review proposal");
        }
      },
    )
    .post(
      "/goals/:goalId/reviews/:proposalId/reject",
      zValidator("param", goalReviewProposalParamSchema),
      zValidator("json", rejectGoalReviewProposalBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.rejectReviewProposal({
            ...c.req.valid("param"),
            command: c.req.valid("json"),
          }));
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/reviews/:proposalId/reject", cause, "Failed to reject Goal review proposal");
        }
      },
    )
    .post(
      "/goals/:goalId/reviews/apply",
      zValidator("param", goalIdParamSchema),
      zValidator("json", applyGoalReviewBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.applyReview({
            goalId: c.req.valid("param").goalId,
            command: c.req.valid("json"),
          }));
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/reviews/apply", cause, "Failed to apply Goal review");
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
