import { Hono } from "hono";
import { randomUUID } from "node:crypto";

import {
  ensureTaskInWorkspace,
  ensurePlanInWorkspace,
  applyPlanPatchCommand,
  saveCompiledPlan,
  getLatestCompiledPlan,
  streamTaskPlanGeneration,
  getLatestSavedAiPlanSnapshot,
  isTaskPlanGenerationRunning,
} from "@chrona/engine";
import {
  startTaskPlanGeneration,
  stopTaskPlanGeneration,
  TaskPlanGenerationInFlightError,
} from "@chrona/engine";

import { planGenerationConflictBody, sseEncode, logger } from "./helpers";
import { error, internalServerError, json } from "../lib/http";

export function createPlansRoutes() {
  const api = new Hono();

  api.get("/tasks/:taskId/plan/state", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const savedAiPlan = await getLatestSavedAiPlanSnapshot(taskId);
      const planStatus =
        savedAiPlan?.status === "accepted"
          ? "accepted"
          : savedAiPlan
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
        savedAiPlan,
      });
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Failed to get task plan state";
      return error(c, message, 500);
    }
  });

  api.post("/tasks/:taskId/plan/accept", async (c) => {
    try {
      const body = await c.req.json();
      const taskId = c.req.param("taskId");
      const planId = typeof body.planId === "string" ? body.planId : "";
      const workspaceId =
        typeof body.workspaceId === "string" ? body.workspaceId : undefined;

      if (!planId) {
        return error(c, "planId is required", 400);
      }

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
        status: "accepted",
        prompt: latest.prompt,
        summary: latest.summary,
        generatedBy: latest.generatedBy,
      });
      return json(c, {
        savedPlan: {
          id: planId,
          status: "accepted",
          prompt: latest.prompt,
          plan: latest.compiledPlan,
          summary: latest.summary,
        },
      });
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Failed to accept task AI plan";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/plan/generate/stop", async (c) => {
    try {
      const taskId = c.req.param("taskId");

      return json(c, { taskId, stopped: stopTaskPlanGeneration(taskId) });
    } catch (cause) {
      return internalServerError(
        c,
        "POST /api/tasks/:taskId/plan/generate/stop",
        cause,
        "Failed to stop task plan generation",
      );
    }
  });

  api.post("/tasks/:taskId/plan/generate", async (c) => {
    const taskId = c.req.param("taskId");
    try {
      const body = await c.req.json();
      const forceRefresh = body.forceRefresh === true;

      const requestId = randomUUID();
      logger.info("request.start", {
        requestId,
        feature: "generate_plan",
        taskId,
        streaming: true,
        forceRefresh,
      });

      const streamLock = startTaskPlanGeneration(taskId);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let streamClosed = false;
          try {
            const eventCounts: Record<string, number> = {};

            const safeEnqueue = (event: string, data: unknown) => {
              if (streamClosed) return false;
              try {
                controller.enqueue(encoder.encode(sseEncode(event, data)));
                return true;
              } catch {
                streamClosed = true;
                return false;
              }
            };

            for await (const event of streamTaskPlanGeneration({
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

              if (event.type === "status") {
                if (!safeEnqueue("status", { message: event.message })) break;
                continue;
              }
              if (event.type === "tool_call") {
                if (
                  !safeEnqueue("tool_call", {
                    tool: event.tool,
                    input: event.input,
                  })
                )
                  break;
                continue;
              }
              if (event.type === "tool_result") {
                if (
                  !safeEnqueue("tool_result", {
                    tool: event.tool,
                    result: event.result,
                  })
                )
                  break;
                continue;
              }
              if (event.type === "partial") {
                if (!safeEnqueue("partial", { text: event.text })) break;
                continue;
              }
              if (event.type === "result") {
                if (!safeEnqueue("result", event.response)) break;
                continue;
              }
              if (event.type === "error") {
                safeEnqueue("error", { message: event.message });
                break;
              }
              if (event.type === "done") {
                safeEnqueue("done", {});
                break;
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
              controller.enqueue(
                encoder.encode(
                  sseEncode("error", {
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "Failed to generate task plan",
                  }),
                ),
              );
            } catch {
              /* stream may already be closed */
            }
          } finally {
            streamLock.finish();
            try {
              controller.close();
            } catch {
              /* stream may already be closed */
            }
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (cause) {
      if (cause instanceof TaskPlanGenerationInFlightError) {
        return json(c, planGenerationConflictBody(taskId), 409);
      }
      const message =
        cause instanceof Error ? cause.message : "Failed to generate task plan";
      return error(c, message, message.includes("Task not found") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/plan", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const {
        operation,
        nodes,
        edges,
        nodePatches,
        deletedNodeIds,
        reorder,
        summary,
      } = body as {
        operation: string;
        nodes?: Array<Record<string, unknown>>;
        edges?: Array<Record<string, unknown>>;
        nodePatches?: Array<{ id: string } & Record<string, unknown>>;
        deletedNodeIds?: string[];
        reorder?: string[];
        summary?: string;
      };

      const result = await applyPlanPatchCommand({
        taskId,
        operation,
        nodes,
        edges,
        nodePatches,
        deletedNodeIds,
        reorder,
        summary,
      });

      return json(c, result, 200);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to apply plan patch";
      const status = message.includes("not found")
        ? 404
        : message.includes("requires")
          ? 400
          : 500;
      return error(c, message, status);
    }
  });

  return api;
}
