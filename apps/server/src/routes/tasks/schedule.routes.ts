import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  applySchedule,
  clearSchedule,
  decideScheduleProposal,
  proposeSchedule,
} from "@chrona/engine";
import {
  clearScheduleParamSchema,
  scheduleBodySchema,
  scheduleParamSchema,
  scheduleProposalParamSchema,
  scheduleProposalBodySchema,
  scheduleProposalDecisionBodySchema,
} from "@chrona/contracts/api";

import { error, internalServerError, json } from "../../lib/http";

export function createTaskScheduleRoutes() {
  return new Hono()
    .post(
      "/tasks/schedule-proposals/decision",
      zValidator("json", scheduleProposalDecisionBodySchema),
      async (c) => {
        try {
          const body = c.req.valid("json");
          const result = await decideScheduleProposal({
            proposalId: body.proposalId,
            decision: body.decision,
            resolutionNote: body.resolutionNote,
          });

          return json(c, result);
        } catch (cause) {
          const message =
            cause instanceof Error
              ? cause.message
              : "Failed to decide schedule proposal";
          if (message.includes("not found")) {
            return error(c, message, 404);
          }
          if (message.includes("workspace")) {
            return error(c, message, 400);
          }
          return internalServerError(
            c,
            "POST /api/tasks/schedule-proposals/decision",
            cause,
            "Failed to decide schedule proposal",
          );
        }
      },
    )
    .put(
      "/tasks/:taskId/schedule",
      zValidator("param", scheduleParamSchema),
      zValidator("json", scheduleBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const body = c.req.valid("json");
          const result = await applySchedule({
            taskId,
            dueAt: body.dueAt ? new Date(body.dueAt) : null,
            scheduledStartAt: new Date(body.scheduledStartAt),
            scheduledEndAt: new Date(body.scheduledEndAt),
            scheduleSource: body.scheduleSource,
          });

          return json(c, result);
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : "Failed to apply schedule";
          if (message.includes("not found")) {
            return error(c, message, 404);
          }
          if (message.includes("scheduled") || message.includes("work block")) {
            return error(c, message, 400);
          }
          return internalServerError(
            c,
            "PUT /api/tasks/:taskId/schedule",
            cause,
            "Failed to apply schedule",
          );
        }
      },
    )
    .delete(
      "/tasks/:taskId/schedule",
      zValidator("param", clearScheduleParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const result = await clearSchedule({ taskId });

          return json(c, result);
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : "Failed to clear schedule";
          if (message.includes("not found")) {
            return error(c, message, 404);
          }
          return internalServerError(
            c,
            "DELETE /api/tasks/:taskId/schedule",
            cause,
            "Failed to clear schedule",
          );
        }
      },
    )
    .post(
      "/tasks/:taskId/schedule/proposals",
      zValidator("param", scheduleProposalParamSchema),
      zValidator("json", scheduleProposalBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const body = c.req.valid("json");
          const dueAt = body.dueAt ? new Date(body.dueAt) : null;
          const scheduledStartAt = body.scheduledStartAt
            ? new Date(body.scheduledStartAt)
            : null;
          const scheduledEndAt = body.scheduledEndAt
            ? new Date(body.scheduledEndAt)
            : null;

          const result = await proposeSchedule({
            taskId,
            source: (body.source ?? "system") as Parameters<
              typeof proposeSchedule
            >[0]["source"],
            proposedBy: body.proposedBy ?? "system",
            summary: body.summary ?? "Schedule proposal",
            dueAt,
            scheduledStartAt,
            scheduledEndAt,
          });

          return json(c, result, 201);
        } catch (cause) {
          const message =
            cause instanceof Error
              ? cause.message
              : "Failed to propose schedule";
          if (message.includes("not found")) {
            return error(c, message, 404);
          }
          return internalServerError(
            c,
            "POST /api/tasks/:taskId/schedule/proposals",
            cause,
            "Failed to propose schedule",
          );
        }
      },
    );
}
