import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { upgradeBlueprintToEditable } from "@chrona/contracts";

import {
  compilePlanBlueprint,
  createPlanRunFromCompiledPlan,
  ensureTaskInWorkspace,
  ensurePlanInWorkspace,
  applyPlanPatchCommand,
  materializeTaskPlan,
  saveCompiledPlan,
  getLatestCompiledPlan,
  isTaskPlanGenerationRunning,
  generateTaskPlanManualStream,
  getLatestTaskPlanReadModel,
  savePlanRun,
} from "@chrona/engine";
import {
  startTaskPlanGeneration,
  stopTaskPlanGeneration,
  TaskPlanGenerationInFlightError,
} from "@chrona/engine";
import { db } from "@chrona/db";
import { planGenerationConflictBody, logger } from "./helpers";
import { error, internalServerError, json } from "../lib/http";

export function createPlansRoutes() {
  const api = new Hono();

  api.get("/tasks/:taskId/plan/state", async (c) => {
    try {
      const taskId = c.req.param("taskId");
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
      const planningPrompt =
        typeof body.planningPrompt === "string" && body.planningPrompt.trim().length > 0
          ? body.planningPrompt
          : null;

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
            planningPrompt,
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
                  data: JSON.stringify({ phase: event.phase, message: event.message }),
                });
                break;
              case "tool_call":
                await stream.writeSSE({
                  event: "tool_call",
                  data: JSON.stringify({ tool: event.tool, input: event.input }),
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
                  data: JSON.stringify({ code: event.code, message: event.message }),
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

  api.post("/tasks/:taskId/plan/materialize", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const workspaceId =
        typeof body.workspaceId === "string" ? body.workspaceId : undefined;
      const providedNodes = Array.isArray(body.nodes) ? body.nodes : undefined;
      const providedEdges = Array.isArray(body.edges) ? body.edges : undefined;

      if (workspaceId) {
        await ensureTaskInWorkspace(taskId, workspaceId);
      }

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) {
        return error(c, "Task not found", 404);
      }

      let compiledPlan = null;

      if (providedNodes && providedNodes.length > 0) {
        const nodeCountLabel = `${providedNodes.length} planned step${providedNodes.length === 1 ? "" : "s"}`;
        const blueprint = {
          title: nodeCountLabel,
          goal: nodeCountLabel,
          nodes: providedNodes.map((node: Record<string, unknown>) => ({
            id:
              typeof node.id === "string"
                ? node.id
                : `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type:
              typeof node.type === "string" && ["task", "checkpoint", "condition", "wait"].includes(node.type)
                ? node.type
                : "task",
            title: typeof node.title === "string" ? node.title : "Untitled",
          })),
          edges: (providedEdges ?? []).map((edge: Record<string, unknown>) => ({
            from: typeof edge.fromNodeId === "string" ? edge.fromNodeId : "",
            to: typeof edge.toNodeId === "string" ? edge.toNodeId : "",
          })),
        } as const;

        const compiled = compilePlanBlueprint({
          taskId: task.id,
          blueprint,
          generatedBy: "batch-apply",
          source: "ai",
        });

        compiledPlan = compiled.compiledPlan;

        await saveCompiledPlan({
          workspaceId: task.workspaceId,
          taskId: task.id,
          compiledPlan: compiled.compiledPlan,
          editablePlan: upgradeBlueprintToEditable(blueprint, compiled.planId, 1),
          status: "draft",
          generatedBy: "batch-apply",
          summary: blueprint.title,
        });

        await savePlanRun({
          workspaceId: task.workspaceId,
          taskId: task.id,
          planId: compiled.planId,
          run: createPlanRunFromCompiledPlan(compiled.compiledPlan, []),
          layers: [compiled.initialLayer],
        });
      } else {
        const latest = await getLatestCompiledPlan(taskId);
        if (!latest) {
          return error(c, "No plan found for task", 404);
        }
        compiledPlan = latest.compiledPlan;
      }

      const materialization = await materializeTaskPlan({ taskId: task.id });
      const childTasks = await db.task.findMany({
        where: { id: { in: materialization.createdTaskIds } },
        include: { projection: true },
        orderBy: { createdAt: "asc" },
      });

      return json(c, {
        parentTaskId: taskId,
        childTasks,
        planGraph: compiledPlan,
        materialization: {
          createdTaskIds: materialization.createdTaskIds,
          updatedNodeIds: materialization.updatedNodeIds,
          skippedNodeIds: [],
        },
      }, 201);
    } catch (cause) {
      return internalServerError(
        c,
        "POST /api/tasks/:taskId/plan/materialize",
        cause,
        "Failed to apply task plan",
      );
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
