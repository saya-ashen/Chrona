import { Hono } from "hono";
import { randomUUID } from "node:crypto";

import { db } from "@chrona/db";
import type { TaskPlanGraph } from "@chrona/contracts/ai";
import type { PlanBlueprint } from "@chrona/contracts/ai";
import {
  acceptTaskPlanGraph,
  aiGeneratePlan,
  aiGeneratePlanStream,
  ensureDefaultTaskSession,
  generateTaskPlanForTask,
  getAcceptedTaskPlanGraph,
  getLatestTaskPlanGraph,
  materializeTaskPlan,
  saveTaskPlanGraph,
} from "@chrona/engine";
import { compilePlanBlueprint } from "@chrona/engine";
import {
  startTaskPlanGeneration,
  stopTaskPlanGeneration,
  TaskPlanGenerationInFlightError,
} from "@chrona/engine";

import {
  ensureTaskInWorkspace,
  ensurePlanInWorkspace,
  buildSavedPlanSummary,
  summarizeStructuredPlanDebug,
  planGenerationConflictBody,
  sseEncode,
  logger,
} from "./helpers";
import {
  error,
  internalServerError,
  json,
} from "../lib/http";

export function createPlansRoutes() {
  const api = new Hono();

  api.post("/ai/task-plan/accept", async (c) => {
    try {
      const body = await c.req.json();
      const taskId = typeof body.taskId === "string" ? body.taskId : "";
      const planId = typeof body.planId === "string" ? body.planId : "";
      const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;

      if (!taskId || !planId) {
        return error(c, "taskId and planId are required", 400);
      }

      if (workspaceId) {
        await ensureTaskInWorkspace(taskId, workspaceId);
        await ensurePlanInWorkspace(planId, taskId, workspaceId);
      }

      const savedPlan = await acceptTaskPlanGraph({ taskId, planId });
      return json(c, {
        savedPlan: {
          id: savedPlan.id,
          status: savedPlan.status,
          prompt: savedPlan.prompt,
          revision: savedPlan.revision,
          summary: savedPlan.summary,
          updatedAt: savedPlan.updatedAt,
          plan: savedPlan.plan,
        },
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to accept task AI plan";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/ai/generate-task-plan/stop", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const taskId = typeof body.taskId === "string" ? body.taskId : null;

      if (!taskId) {
        return error(c, "taskId is required", 400);
      }

      return json(c, { taskId, stopped: stopTaskPlanGeneration(taskId) });
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/generate-task-plan/stop", cause, "Failed to stop task plan generation");
    }
  });

  api.post("/ai/generate-task-plan", async (c) => {
    let parsedTaskIdForConflict: string | null = null;
    try {
      const body = await c.req.json();
      const {
        taskId,
        title,
        description,
        estimatedMinutes,
        planningPrompt,
        forceRefresh = false,
      } = body;
      parsedTaskIdForConflict = typeof taskId === "string" ? taskId : null;

      if (!taskId && !title) {
        return error(c, "Either taskId or title is required", 400);
      }

      const acceptHeader = c.req.header("accept") ?? "";
      const wantsStream = acceptHeader.includes("text/event-stream");

      if (taskId && !wantsStream) {
        const lock = startTaskPlanGeneration(taskId);
        try {
          const result = await generateTaskPlanForTask({
            taskId,
            title,
            description,
            estimatedMinutes,
            planningPrompt: planningPrompt ?? null,
            forceRefresh,
            signal: lock.signal,
          });
          if (!result) {
            return error(c, "AI planning unavailable", 503);
          }
          return json(c, result);
        } finally {
          lock.finish();
        }
      }

      const requestId = randomUUID();
      logger.info("request.start", {
        requestId,
        feature: "generate_plan",
        taskId: taskId ?? null,
        title: typeof title === "string" ? title.slice(0, 200) : null,
        streaming: wantsStream,
        forceRefresh,
      });

      let resolvedWorkspaceId: string | null = null;
      let resolvedTitle = title;
      let resolvedDescription = description;
      let resolvedEstimatedMinutes = estimatedMinutes;
      let sharedTaskSessionKey: string | null = null;

      if (taskId) {
        const task = await db.task.findUnique({ where: { id: taskId } });
        if (!task) {
          return error(c, "Task not found", 404);
        }
        resolvedWorkspaceId = task.workspaceId;
        resolvedTitle = task.title;
        resolvedDescription = task.description ?? undefined;
        if (task.scheduledStartAt && task.scheduledEndAt) {
          resolvedEstimatedMinutes = Math.round((task.scheduledEndAt.getTime() - task.scheduledStartAt.getTime()) / 60000);
        }
        sharedTaskSessionKey = (
          await ensureDefaultTaskSession({
            taskId: task.id,
            taskTitle: task.title,
            runtimeName: "openclaw",
            defaultSessionId: task.defaultSessionId,
          })
        ).sessionKey;
      }

      if (taskId && !forceRefresh) {
        const savedPlan = await getLatestTaskPlanGraph(taskId);
        if (savedPlan) {
          if (wantsStream) {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(sseEncode("result", {
                  source: "saved",
                  planGraph: savedPlan.plan,
                  taskSessionKey: sharedTaskSessionKey,
                  savedPlan: buildSavedPlanSummary(savedPlan),
                })));
                controller.enqueue(encoder.encode(sseEncode("done", {})));
                controller.close();
              },
            });
            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              },
            });
          }

          return json(c, {
            source: "saved",
            planGraph: savedPlan.plan,
            taskSessionKey: sharedTaskSessionKey,
            savedPlan: buildSavedPlanSummary(savedPlan),
          });
        }
      }

      const generatedContext = {
        title:
          typeof taskId === "string" && taskId.length > 0 && typeof title === "string" && title.trim().length > 0
            ? title.trim()
            : resolvedTitle,
        description: typeof description === "string" ? description : resolvedDescription,
        estimatedMinutes: typeof estimatedMinutes === "number" ? estimatedMinutes : resolvedEstimatedMinutes,
      };

      if (wantsStream) {
        let streamLock: ReturnType<typeof startTaskPlanGeneration> | null = null;
        if (taskId) {
          try {
            streamLock = startTaskPlanGeneration(taskId);
          } catch (cause) {
            if (cause instanceof TaskPlanGenerationInFlightError) {
              return json(c, planGenerationConflictBody(taskId), 409);
            }
            throw cause;
          }
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let finalResponse: Record<string, unknown> | null = null;
            try {
              const eventCounts: Record<string, number> = {};
              let streamClosed = false;
              let requestFinished = false;

              const safeEnqueue = (event: string, data: unknown) => {
                if (streamClosed || requestFinished) {
                  return false;
                }
                try {
                  controller.enqueue(encoder.encode(sseEncode(event, data)));
                  return true;
                } catch {
                  streamClosed = true;
                  return false;
                }
              };

              const safeClose = () => {
                if (streamClosed) return;
                try {
                  controller.close();
                } catch {
                  /* stream may already be closed */
                } finally {
                  streamClosed = true;
                }
              };

              for await (const event of aiGeneratePlanStream({
                taskId: taskId ?? "",
                title: generatedContext.title,
                description: generatedContext.description,
                estimatedMinutes: generatedContext.estimatedMinutes,
                sessionKey: sharedTaskSessionKey ?? undefined,
              })) {
                if (streamClosed || requestFinished) {
                  break;
                }
                eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
                logger.info("stream.event", {
                  requestId,
                  feature: "generate_plan",
                  taskId: taskId ?? null,
                  eventType: event.type,
                });
                if (event.type === "status") {
                  if (!safeEnqueue("status", { message: event.message })) break;
                } else if (event.type === "tool_call") {
                  if (!safeEnqueue("tool_call", { tool: event.tool, input: event.input })) break;
                } else if (event.type === "tool_result") {
                  if (!safeEnqueue("tool_result", { tool: event.tool, result: event.result })) break;
                } else if (event.type === "partial") {
                  if (!safeEnqueue("partial", { text: event.text })) break;
                } else if (event.type === "result" && "plan" in event) {
                  if (event.plan.blueprint.nodes.length === 0) {
                    const message =
                      event.plan.structured?.error?.trim() ||
                      "AI returned an empty task plan with zero nodes.";
                    logger.warn("request.empty_plan", {
                      requestId,
                      feature: "generate_plan",
                      taskId: taskId ?? null,
                        planSummary: event.plan.blueprint.title,
                      structured: summarizeStructuredPlanDebug(
                        event.plan.structured,
                      ),
                    });
                    if (!safeEnqueue("error", { message })) break;
                    requestFinished = true;
                    break;
                  }
                  const draftPlan: TaskPlanGraph = compilePlanBlueprint({
                    graphId: `graph-${taskId || "adhoc"}-${Date.now()}`,
                    taskId: taskId ?? "",
                    blueprint: event.plan.blueprint,
                    prompt: planningPrompt ?? null,
                    generatedBy: event.plan.source ?? "ai",
                    source: "ai",
                    status: "draft",
                    revision: 1,
                  });

                  if (taskId && resolvedWorkspaceId) {
                    const savedPlan = await saveTaskPlanGraph({
                      workspaceId: resolvedWorkspaceId,
                      taskId,
                      plan: draftPlan,
                      prompt: planningPrompt ?? null,
                      status: "draft",
                      source: "ai",
                      generatedBy: event.plan.source ?? "ai",
                      summary: draftPlan.summary,
                    });
                    finalResponse = {
                      source: event.plan.source,
                      planGraph: savedPlan.plan,
                      taskSessionKey: sharedTaskSessionKey,
                      savedPlan: buildSavedPlanSummary(savedPlan),
                    };
                  } else {
                    finalResponse = {
                      source: event.plan.source,
                      planGraph: draftPlan,
                      taskSessionKey: sharedTaskSessionKey,
                    };
                  }
                  if (!safeEnqueue("result", finalResponse)) break;
                } else if (event.type === "error") {
                  logger.error("request.plan_generation_error", {
                    requestId,
                    feature: "generate_plan",
                    taskId: taskId ?? null,
                    error: event.message,
                    rawTextPreview:
                      typeof event.rawText === "string"
                        ? event.rawText.slice(0, 400)
                        : null,
                    structured: summarizeStructuredPlanDebug(
                      event.structured,
                    ),
                    diagnostics:
                      event.diagnostics && typeof event.diagnostics === "object"
                        ? event.diagnostics
                        : null,
                  });
                  if (!safeEnqueue("error", { message: event.message })) break;
                  requestFinished = true;
                  break;
                } else if (event.type === "done") {
                  logger.info("request.done", {
                    requestId,
                    feature: "generate_plan",
                    taskId: taskId ?? null,
                    eventCounts,
                    savedPlanId: finalResponse && typeof finalResponse === "object" && "savedPlan" in finalResponse && finalResponse["savedPlan"] && typeof finalResponse["savedPlan"] === "object"
                      ? (finalResponse["savedPlan"] as { id?: string }).id ?? null
                      : null,
                  });
                  if (!safeEnqueue("done", { response: finalResponse })) break;
                  requestFinished = true;
                  break;
                }
              }
              safeClose();
            } catch (cause) {
              logger.error("request.stream_error", {
                requestId,
                feature: "generate_plan",
                taskId: taskId ?? null,
                error: cause instanceof Error ? cause.message : String(cause),
              });
              try {
                controller.enqueue(encoder.encode(sseEncode("error", {
                  message: cause instanceof Error ? cause.message : "Failed to generate task plan",
                })));
              } catch {
                /* enqueue may fail if stream is closed */
              }
              try {
                controller.close();
              } catch {
                /* stream may already be closed */
              }
            } finally {
              streamLock?.finish();
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
      }

      const planResult = await aiGeneratePlan({
        taskId: taskId ?? "",
        title: generatedContext.title,
        description: generatedContext.description,
        estimatedMinutes: generatedContext.estimatedMinutes,
        sessionKey: sharedTaskSessionKey ?? undefined,
      });

      logger.info("request.blocking_result", {
        requestId,
        feature: "generate_plan",
        taskId: taskId ?? null,
        title: typeof generatedContext.title === "string" ? generatedContext.title.slice(0, 200) : null,
        hasPlan: Boolean(planResult),
      });

      if (!planResult) {
        return error(c, "AI planning unavailable", 503);
      }

      const plan: TaskPlanGraph = compilePlanBlueprint({
        graphId: `graph-${taskId || "adhoc"}-${Date.now()}`,
        taskId: taskId ?? "",
        blueprint: planResult.blueprint,
        prompt: planningPrompt ?? null,
        generatedBy: planResult.source ?? "ai",
        source: "ai",
        status: "draft",
        revision: 1,
      });

      if (taskId && resolvedWorkspaceId) {
        const savedPlan = await saveTaskPlanGraph({
          workspaceId: resolvedWorkspaceId,
          taskId,
          plan,
          prompt: planningPrompt ?? null,
          status: "draft",
          source: "ai",
          generatedBy: planResult.source ?? "ai",
          summary: plan.summary,
        });

        return json(c, {
          source: planResult.source,
          planGraph: savedPlan.plan,
          taskSessionKey: sharedTaskSessionKey,
          savedPlan: buildSavedPlanSummary(savedPlan),
        });
      }

      return json(c, {
        source: planResult.source,
        planGraph: plan,
        taskSessionKey: sharedTaskSessionKey,
      });
    } catch (cause) {
      if (cause instanceof TaskPlanGenerationInFlightError) {
        return json(c, planGenerationConflictBody(parsedTaskIdForConflict ?? "unknown"), 409);
      }
      const message = cause instanceof Error ? cause.message : "Failed to generate task plan";
      return error(c, message, message.includes("Task not found") ? 404 : 500);
    }
  });

  api.post("/ai/batch-apply-plan", async (c) => {
    try {
      const body = await c.req.json();
      const { taskId, blueprint: providedBlueprint } = body as {
        taskId?: string;
        blueprint?: PlanBlueprint;
      };

      if (!taskId) {
        return error(c, "taskId is required", 400);
      }

      if (typeof body.workspaceId === "string") {
        await ensureTaskInWorkspace(taskId, body.workspaceId);
      }

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) {
        return error(c, "Task not found", 404);
      }

      if (providedBlueprint !== undefined) {
        if (!providedBlueprint || typeof providedBlueprint !== "object" || !Array.isArray(providedBlueprint.nodes)) {
          return error(c, "blueprint must be a valid plan blueprint", 400);
        }
      }

      let graphPlan = null;
      if (providedBlueprint && Array.isArray(providedBlueprint.nodes) && providedBlueprint.nodes.length > 0) {
        const plan: TaskPlanGraph = compilePlanBlueprint({
          graphId: `graph-${taskId}-${Date.now()}`,
          taskId,
          blueprint: providedBlueprint,
          generatedBy: "batch-apply",
          source: "ai",
          status: "draft",
          revision: 1,
        });
        graphPlan = await saveTaskPlanGraph({
          workspaceId: task.workspaceId,
          taskId: task.id,
          plan,
          status: "draft",
          source: "ai",
          generatedBy: "batch-apply",
          summary: plan.summary,
        });
      } else {
        graphPlan = await getLatestTaskPlanGraph(taskId);
        if (!graphPlan) {
          return error(c, "No plan found for task", 404);
        }
      }

      const materialized = await materializeTaskPlan({ taskId: task.id });
      const createdTasks = await db.task.findMany({
        where: { id: { in: materialized.createdTaskIds } },
        include: { projection: true },
        orderBy: { createdAt: "asc" },
      });
      const acceptedPlan = (await getAcceptedTaskPlanGraph(taskId)) ?? graphPlan;
      const materializedNodeIds = new Set(
        acceptedPlan?.plan.nodes
          .filter((node) => typeof node.linkedTaskId === "string" && node.linkedTaskId.length > 0)
          .map((node) => node.id) ?? [],
      );
      const requestedNodeIds = new Set((acceptedPlan?.plan.nodes ?? []).map((node) => node.id));
      const skippedNodeIds = [...requestedNodeIds].filter((nodeId) => !materializedNodeIds.has(nodeId));

      return json(c, {
        parentTaskId: taskId,
        childTasks: createdTasks,
        planGraph: graphPlan.plan,
        materialization: {
          createdTaskIds: materialized.createdTaskIds,
          updatedNodeIds: materialized.updatedNodeIds,
          skippedNodeIds,
        },
      }, 201);
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/batch-apply-plan", cause, "Failed to apply task plan");
    }
  });

  api.post("/tasks/:taskId/plan", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const { operation, nodes, edges, nodePatches, deletedNodeIds, reorder, summary } =
        body as {
          operation: string;
          nodes?: Array<Record<string, unknown>>;
          edges?: Array<Record<string, unknown>>;
          nodePatches?: Array<{ id: string } & Record<string, unknown>>;
          deletedNodeIds?: string[];
          reorder?: string[];
          summary?: string;
        };

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return error(c, "Task not found", 404);

      const currentPlanGraph = await getLatestTaskPlanGraph(taskId);
      if (!currentPlanGraph) return error(c, "No plan found for this task", 404);

      // Deep-clone to avoid mutating the fetched plan reference
      const plan = {
        ...currentPlanGraph.plan,
        nodes: currentPlanGraph.plan.nodes.map((n: Record<string, unknown>) => ({ ...n })),
        edges: currentPlanGraph.plan.edges.map((e: Record<string, unknown>) => ({ ...e })),
      } as typeof currentPlanGraph.plan;
      switch (operation) {
        case "add_node": {
          if (!nodes || nodes.length === 0) {
            return error(c, "add_node requires nodes[]", 400);
          }
          const newNodes = nodes.map((n, i) => ({
            id: typeof n.id === "string" && n.id.trim() ? n.id : `node-${Date.now()}-${i}`,
            type: (typeof n.type === "string" ? n.type : "step") as import("@chrona/contracts/ai").TaskPlanNodeType,
            title: typeof n.title === "string" && n.title.trim() ? n.title : `Step ${plan.nodes.length + i + 1}`,
            objective: typeof n.objective === "string" && n.objective.trim() ? n.objective : (typeof n.title === "string" && n.title.trim() ? n.title : `Step ${plan.nodes.length + i + 1}`),
            description: typeof n.description === "string" && n.description.trim() ? n.description : null,
            status: "pending" as import("@chrona/contracts/ai").TaskPlanNodeStatus,
            phase: null as string | null,
            estimatedMinutes: typeof n.estimatedMinutes === "number" ? n.estimatedMinutes : null,
            priority: typeof n.priority === "string" ? n.priority as "Low" | "Medium" | "High" | "Urgent" | null : null,
            executionMode: (n.executionMode === "manual" || n.executionMode === "hybrid" ? n.executionMode : "automatic") as import("@chrona/contracts/ai").TaskPlanNodeExecutionMode,
            requiresHumanInput: Boolean(n.requiresHumanInput),
            requiresHumanApproval: Boolean(n.requiresHumanApproval),
            autoRunnable: !n.requiresHumanInput && !n.requiresHumanApproval,
            blockingReason: null as import("@chrona/contracts/ai").TaskPlanNodeBlockingReason,
            linkedTaskId: null as string | null,
            completionSummary: null as string | null,
            metadata: null as Record<string, unknown> | null,
            requiredInfo: Array.isArray(n.requiredInfo) ? n.requiredInfo as string[] : [] as string[],
            dependencies: Array.isArray(n.dependencies) ? n.dependencies as string[] : undefined,
            executionClassification: typeof n.executionClassification === "string" ? n.executionClassification as import("@chrona/contracts/ai").TaskPlanNodeExecutionClassification : undefined,
            nextAction: typeof n.nextAction === "string" ? n.nextAction as string | null : null,
            readiness: typeof n.readiness === "string" ? n.readiness as import("@chrona/contracts/ai").TaskPlanNodeReadiness : undefined,
          }));
          plan.nodes = [...plan.nodes, ...newNodes] as typeof plan.nodes;
          if (edges && edges.length > 0) {
            plan.edges = [...plan.edges, ...edges.map((e, i) => ({
              id: typeof e.id === "string" && e.id.trim() ? e.id : `edge-${Date.now()}-${i}`,
              fromNodeId: e.fromNodeId as string,
              toNodeId: e.toNodeId as string,
              type: (e.type === "depends_on" ? e.type : "sequential") as import("@chrona/contracts/ai").TaskPlanEdgeType,
              metadata: null as Record<string, unknown> | null,
            }))] as typeof plan.edges;
          }
          break;
        }
        case "update_node": {
          if (!nodePatches || nodePatches.length === 0) {
            return error(c, "update_node requires nodePatches[]", 400);
          }
          const existingIds = new Set(plan.nodes.map((n) => n.id));
          const unknownIds = nodePatches.map((p) => p.id).filter((id) => !existingIds.has(id));
          if (unknownIds.length > 0) {
            return error(c, `Unknown node id(s): ${unknownIds.join(", ")}`, 400);
          }
          const patchMap = new Map(nodePatches.map((p) => [p.id, p]));
          plan.nodes = plan.nodes.map((node) => {
            const patch = patchMap.get(node.id);
            if (!patch) return node;
            return {
              ...node,
              ...(typeof patch.title === "string" ? { title: patch.title } : {}),
              ...(typeof patch.objective === "string" ? { objective: patch.objective } : {}),
              ...(typeof patch.description === "string" ? { description: patch.description } : {}),
              ...(typeof patch.estimatedMinutes === "number" ? { estimatedMinutes: patch.estimatedMinutes } : {}),
              ...(typeof patch.status === "string" ? { status: patch.status as import("@chrona/contracts/ai").TaskPlanNodeStatus } : {}),
              ...(typeof patch.priority === "string" ? { priority: patch.priority as import("@chrona/contracts/ai").TaskPlanNode["priority"] } : {}),
              ...(typeof patch.executionMode === "string" ? { executionMode: patch.executionMode as import("@chrona/contracts/ai").TaskPlanNodeExecutionMode } : {}),
              ...(patch.requiresHumanInput !== undefined ? { requiresHumanInput: patch.requiresHumanInput as boolean, autoRunnable: !(patch.requiresHumanInput as boolean) && !(node.requiresHumanApproval ?? false) } : {}),
              ...(patch.requiresHumanApproval !== undefined ? { requiresHumanApproval: patch.requiresHumanApproval as boolean, autoRunnable: !(node.requiresHumanInput ?? false) && !(patch.requiresHumanApproval as boolean) } : {}),
              ...(Array.isArray(patch.requiredInfo) ? { requiredInfo: patch.requiredInfo as string[] } : {}),
              ...(Array.isArray(patch.dependencies) ? { dependencies: patch.dependencies as string[] } : {}),
              ...(typeof patch.executionClassification === "string" ? { executionClassification: patch.executionClassification as import("@chrona/contracts/ai").TaskPlanNodeExecutionClassification } : {}),
              ...(typeof patch.nextAction === "string" ? { nextAction: patch.nextAction as string | null } : {}),
              ...(typeof patch.readiness === "string" ? { readiness: patch.readiness as import("@chrona/contracts/ai").TaskPlanNodeReadiness } : {}),
            };
          });
          break;
        }
        case "delete_node": {
          if (!deletedNodeIds || deletedNodeIds.length === 0) {
            return error(c, "delete_node requires deletedNodeIds[]", 400);
          }
          const deleteSet = new Set(deletedNodeIds);
          plan.nodes = plan.nodes.filter((n) => !deleteSet.has(n.id));
          plan.edges = plan.edges.filter(
            (e) => !deleteSet.has(e.fromNodeId) && !deleteSet.has(e.toNodeId),
          );
          break;
        }
        case "update_dependencies": {
          if (!edges || edges.length === 0) {
            return error(c, "update_dependencies requires edges[]", 400);
          }
          const existingIds = new Set(plan.nodes.map((n) => n.id));
          const missingFrom = edges.filter((e) => !existingIds.has(e.fromNodeId as string));
          const missingTo = edges.filter((e) => !existingIds.has(e.toNodeId as string));
          if (missingFrom.length > 0) {
            return error(c, `Unknown fromNodeId(s): ${missingFrom.map((e) => e.fromNodeId).join(", ")}`, 400);
          }
          if (missingTo.length > 0) {
            return error(c, `Unknown toNodeId(s): ${missingTo.map((e) => e.toNodeId).join(", ")}`, 400);
          }
          const newEdgeIds = new Set(edges.map((e) => `${e.fromNodeId}->${e.toNodeId}`));
          plan.edges = [
            ...plan.edges.filter((e) => !newEdgeIds.has(`${e.fromNodeId}->${e.toNodeId}`)),
            ...edges.map((e, i) => ({
              id: typeof e.id === "string" && e.id.trim() ? e.id : `edge-${Date.now()}-${i}`,
              fromNodeId: e.fromNodeId as string,
              toNodeId: e.toNodeId as string,
              type: (e.type === "depends_on" ? e.type : "sequential") as import("@chrona/contracts/ai").TaskPlanEdgeType,
              metadata: null as Record<string, unknown> | null,
            })),
          ] as typeof plan.edges;
          break;
        }
        case "reorder_nodes": {
          if (!reorder || reorder.length === 0) {
            return error(c, "reorder_nodes requires reorder[]", 400);
          }
          const orderMap = new Map(reorder.map((id, i) => [id, i]));
          const reordered = plan.nodes
            .filter((n) => orderMap.has(n.id))
            .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
          const firstIndex = plan.nodes.findIndex((n) => orderMap.has(n.id));
          const insertAt = firstIndex >= 0 ? firstIndex : plan.nodes.length;
          const kept = plan.nodes.filter((n) => !orderMap.has(n.id));
          plan.nodes = [...kept.slice(0, insertAt), ...reordered, ...kept.slice(insertAt)];
          break;
        }
        case "update_plan_summary": {
          if (summary !== undefined) {
            plan.summary = summary;
          }
          break;
        }
        default:
          return error(c, `Unsupported plan operation: ${operation}`, 400);
      }

      const savedPlan = await saveTaskPlanGraph({
        workspaceId: task.workspaceId,
        taskId,
        plan,
        prompt: currentPlanGraph.prompt,
        status: currentPlanGraph.status,
        source: "mixed",
        generatedBy: currentPlanGraph.generatedBy,
        summary: plan.summary ?? currentPlanGraph.summary,
        changeSummary: `Applied plan patch: ${operation}`,
      });

      return json(c, {
        taskId,
        operation,
        planGraph: savedPlan.plan,
      }, 200);
    } catch (cause) {
      return internalServerError(c, "POST /api/tasks/:taskId/plan", cause, "Failed to apply plan patch");
    }
  });

  return api;
}
