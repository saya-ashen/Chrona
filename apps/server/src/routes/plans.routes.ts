import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
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

import { planGenerationConflictBody, logger } from "./helpers";
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

      return streamSSE(c, async (stream) => {
        const eventCounts: Record<string, number> = {};
        stream.onAbort(() => streamLock.finish());

        try {
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

            switch (event.type) {
              case "status":
                await stream.writeSSE({ event: "status", data: JSON.stringify({ message: event.message }) });
                break;
              case "tool_call":
                await stream.writeSSE({ event: "tool_call", data: JSON.stringify({ tool: event.tool, input: event.input }) });
                break;
              case "tool_result":
                await stream.writeSSE({ event: "tool_result", data: JSON.stringify({ tool: event.tool, result: event.result }) });
                break;
              case "partial":
                await stream.writeSSE({ event: "partial", data: JSON.stringify({ text: event.text }) });
                break;
              case "result":
                await stream.writeSSE({ event: "result", data: JSON.stringify(event.response) });
                break;
              case "error":
                await stream.writeSSE({ event: "error", data: JSON.stringify({ message: event.message }) });
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
                message: cause instanceof Error ? cause.message : "Failed to generate task plan",
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
