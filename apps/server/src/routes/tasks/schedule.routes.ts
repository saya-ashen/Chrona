import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import type { ScheduleSource } from "@chrona/db/generated/prisma/client";
import {
  clearScheduleParamSchema,
  scheduleBodySchema,
  scheduleParamSchema,
  scheduleProposalParamSchema,
  scheduleProposalBodySchema,
  scheduleProposalDecisionBodySchema,
  workBlockScheduleParamSchema,
  workBlockScheduleBodySchema,
} from "@chrona/contracts/api";

import { error, internalServerError, json, toHttpError } from "../../lib/http";

export function createTaskScheduleRoutes(engine: ChronaEngine) {
  return new Hono()
    .post(
      "/tasks/schedule-proposals/decision",
      zValidator("json", scheduleProposalDecisionBodySchema),
      async (c) => {
        try {
          const body = c.req.valid("json");
          const result = await engine.tasks.schedule.decideProposal({
            proposalId: body.proposalId,
            decision: body.decision,
            resolutionNote: body.resolutionNote,
          });

          return json(c, result);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
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
          const result = await engine.tasks.schedule.apply({
            taskId,
            dueAt: body.dueAt ? new Date(body.dueAt) : null,
            scheduledStartAt: new Date(body.scheduledStartAt),
            scheduledEndAt: new Date(body.scheduledEndAt),
            scheduleSource: body.scheduleSource,
          });

          return json(c, result);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
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
          const result = await engine.tasks.schedule.clear({ taskId });

          return json(c, result);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
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
    .put(
      "/work-blocks/:workBlockId/schedule",
      zValidator("param", workBlockScheduleParamSchema),
      zValidator("json", workBlockScheduleBodySchema),
      async (c) => {
        try {
          const { workBlockId } = c.req.valid("param");
          const body = c.req.valid("json");
          const result = await engine.tasks.schedule.moveWorkBlock({
            workBlockId,
            scheduledStartAt: new Date(body.scheduledStartAt),
            scheduledEndAt: new Date(body.scheduledEndAt),
          });

          return json(c, result);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "PUT /api/work-blocks/:workBlockId/schedule",
            cause,
            "Failed to move work block",
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

          const result = await engine.tasks.schedule.propose({
            taskId,
            source: (body.source ?? "system") as ScheduleSource,
            proposedBy: body.proposedBy ?? "system",
            summary: body.summary ?? "Schedule proposal",
            dueAt,
            scheduledStartAt,
            scheduledEndAt,
          });

          return json(c, result, 201);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
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
