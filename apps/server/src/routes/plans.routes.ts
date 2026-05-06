import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";

import {
  ensureTaskInWorkspace,
  ensurePlanInWorkspace,
  applyPlanPatchCommand,
  saveCompiledPlan,
  getLatestCompiledPlan,
  isTaskPlanGenerationRunning,
  generateTaskPlanManualStream,
  getLatestTaskPlanReadModel,
} from "@chrona/engine";
import {
  startTaskPlanGeneration,
  stopTaskPlanGeneration,
  TaskPlanGenerationInFlightError,
} from "@chrona/engine";
import {
  planStateParamSchema,
  planAcceptParamSchema,
  planAcceptBodySchema,
  planGenerateParamSchema,
  planGenerateBodySchema,
  planGenerateStopParamSchema,
  planPatchParamSchema,
  planPatchBodySchema,
} from "@chrona/contracts/api";
import { planGenerationConflictBody, logger } from "./helpers";
import { error, internalServerError, json } from "../lib/http";

export function createPlansRoutes() {
  return new Hono()
    .get(
      "/tasks/:taskId/plan/state",
      zValidator("param", planStateParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const savedPlan = await getLatestTaskPlanReadModel(taskId);

          const planStatus =
            savedPlan?.status === "accepted"
              ? "accepted"
              : savedPlan
                ? "waiting_acceptance"
                : "no_plan";

          const aiPlanGenerationStatus = isTaskPlanGenerationRunning(taskId)
            ? "generating"
            : planStatus === "accepted"
              ? "accepted"
              : planStatus === "waiting_acceptance"
                ? "waiting_acceptance"
                : "idle";

          return json(c, {
            taskId,
            aiPlanGenerationStatus,
            savedPlan,
          });
        } catch (cause) {
          const message =
            cause instanceof Error
              ? cause.message
              : "Failed to get task plan state";
          return error(c, message, 500);
        }
      },
    )
    .post(
      "/tasks/:taskId/plan/accept",
      zValidator("param", planAcceptParamSchema),
      zValidator("json", planAcceptBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { planId, workspaceId } = c.req.valid("json");

          if (workspaceId) {
            await ensureTaskInWorkspace(taskId, workspaceId);
            await ensurePlanInWorkspace(planId, taskId, workspaceId);
          }

          const latest = await getLatestCompiledPlan(taskId);
          if (!latest || latest.compiledPlan.editablePlanId !== planId) {
            return error(c, "Plan not found", 404);
          }
          await saveCompiledPlan({
            workspaceId: latest.workspaceId,
            taskId,
            compiledPlan: latest.compiledPlan,
            editablePlan: latest.editablePlan,
            status: "accepted",
            prompt: latest.prompt,
            summary: latest.summary,
            generatedBy: latest.generatedBy,
          });
          const acceptedPlan = await getLatestTaskPlanReadModel(taskId);
          return json(c, {
            savedPlan: acceptedPlan,
          });
        } catch (cause) {
          const message =
            cause instanceof Error
              ? cause.message
              : "Failed to accept task AI plan";
          return error(c, message, message.includes("not found") ? 404 : 500);
        }
      },
    )
    .post(
      "/tasks/:taskId/plan/generate/stop",
      zValidator("param", planGenerateStopParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, { taskId, stopped: stopTaskPlanGeneration(taskId) });
        } catch (cause) {
          return internalServerError(
            c,
            "POST /api/tasks/:taskId/plan/generate/stop",
            cause,
            "Failed to stop task plan generation",
          );
        }
      },
    )
    .post(
      "/tasks/:taskId/plan/generate",
      zValidator("param", planGenerateParamSchema),
      zValidator("json", planGenerateBodySchema),
      async (c) => {
        const { taskId } = c.req.valid("param");
        const { forceRefresh } = c.req.valid("json");
        try {
          const requestId = randomUUID();
          logger.info("request.start", {
            requestId,
            feature: "generate_plan",
            taskId,
            streaming: true,
            forceRefresh,
          });

          const streamLock = startTaskPlanGeneration(taskId);

          return streamSSE(c, async (stream) => {
            const eventCounts: Record<string, number> = {};
            stream.onAbort(() => streamLock.finish());

            try {
              for await (const event of generateTaskPlanManualStream({
                taskId,
                forceRefresh,
              })) {
                eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
                logger.info("stream.event", {
                  requestId,
                  feature: "generate_plan",
                  taskId,
                  eventType: event.type,
                });

                switch (event.type) {
                  case "status":
                    await stream.writeSSE({
                      event: "status",
                      data: JSON.stringify({
                        phase: event.phase,
                        message: event.message,
                      }),
                    });
                    break;
                  case "tool_call":
                    await stream.writeSSE({
                      event: "tool_call",
                      data: JSON.stringify({
                        tool: event.tool,
                        input: event.input,
                      }),
                    });
                    break;
                  case "partial":
                    await stream.writeSSE({
                      event: "partial",
                      data: JSON.stringify({ text: event.text }),
                    });
                    break;
                  case "result":
                    await stream.writeSSE({
                      event: "result",
                      data: JSON.stringify(event),
                    });
                    break;
                  case "error":
                    await stream.writeSSE({
                      event: "error",
                      data: JSON.stringify({
                        code: event.code,
                        message: event.message,
                      }),
                    });
                    return;
                  case "done":
                    await stream.writeSSE({ event: "done", data: "{}" });
                    return;
                }
              }

              logger.info("request.done", {
                requestId,
                feature: "generate_plan",
                taskId,
                eventCounts,
              });
            } catch (cause) {
              logger.error("request.stream_error", {
                requestId,
                feature: "generate_plan",
                taskId,
                error: cause instanceof Error ? cause.message : String(cause),
              });
              try {
                await stream.writeSSE({
                  event: "error",
                  data: JSON.stringify({
                    code: "INTERNAL_ERROR",
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "Failed to generate task plan",
                  }),
                });
              } catch {
                /* stream may already be closed */
              }
            } finally {
              streamLock.finish();
            }
          });
        } catch (cause) {
          if (cause instanceof TaskPlanGenerationInFlightError) {
            return json(c, planGenerationConflictBody(taskId), 409);
          }
          const message =
            cause instanceof Error
              ? cause.message
              : "Failed to generate task plan";
          return error(
            c,
            message,
            message.includes("Task not found") ? 404 : 500,
          );
        }
      },
    )
    .post(
      "/tasks/:taskId/plan",
      zValidator("param", planPatchParamSchema),
      zValidator("json", planPatchBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const {
            operation,
            nodes,
            edges,
            nodePatches,
            deletedNodeIds,
            reorder,
            summary,
          } = c.req.valid("json");

          const result = await applyPlanPatchCommand({
            taskId,
            operation,
            nodes: nodes as Array<Record<string, unknown>> | undefined,
            edges: edges as Array<Record<string, unknown>> | undefined,
            nodePatches: nodePatches as
              | Array<{ id: string } & Record<string, unknown>>
              | undefined,
            deletedNodeIds,
            reorder,
            summary,
          });

          return json(c, result, 200);
        } catch (cause) {
          const message =
            cause instanceof Error
              ? cause.message
              : "Failed to apply plan patch";
          const status = message.includes("not found")
            ? 404
            : message.includes("requires")
              ? 400
              : 500;
          return error(c, message, status);
        }
      },
    );
}
