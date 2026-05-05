import { Hono } from "hono";
import { randomUUID } from "node:crypto";

import type { PlanBlueprint } from "@chrona/contracts/ai";
import type {
  RuntimeCommand,
  CompiledPlan,
} from "@chrona/contracts/ai";
import {
  aiGeneratePlan,
  aiGeneratePlanStream,
  ensureDefaultTaskSession,
  generateTaskPlanForTask,
  materializeTaskPlan,
  savePlanRun,
  getPlanRun,
  getLatestPlanRun,
  ensureTaskInWorkspace,
  ensurePlanInWorkspace,
  getTaskOrThrow,
  getTasksWithProjections,
  applyPlanPatchCommand,
  saveCompiledPlan,
  getLatestCompiledPlan,
  getAcceptedCompiledPlan,
  getEditablePlan,
  appendLayer,
  getLayers,
  createPlanRunFromCompiledPlan,
  applyCommandAndProduceLayer,
} from "@chrona/engine";
import { compilePlanBlueprint, compileBlueprintToCompiledPlan } from "@chrona/engine";
import {
  startTaskPlanGeneration,
  stopTaskPlanGeneration,
  TaskPlanGenerationInFlightError,
} from "@chrona/engine";
import { compileEditablePlan, resolveEffectivePlanGraph } from "@chrona/domain";
import { upgradeBlueprintToEditable } from "@chrona/contracts/ai";

import {
  buildSavedPlanSummary,
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
        const task = await getTaskOrThrow(taskId);
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
          const savedCompiled = await getLatestCompiledPlan(taskId);
          if (savedCompiled) {
            const layers = await getLayers(taskId, savedCompiled.compiledPlan.editablePlanId);
            const effective = resolveEffectivePlanGraph(savedCompiled.compiledPlan, layers);
            if (wantsStream) {
              const encoder = new TextEncoder();
              const stream = new ReadableStream({
                start(controller) {
                  controller.enqueue(encoder.encode(sseEncode("result", {
                    source: "saved",
                    compiledPlan: savedCompiled.compiledPlan,
                    effectivePlanGraph: effective,
                    taskSessionKey: sharedTaskSessionKey,
                    savedPlan: buildSavedPlanSummary(savedCompiled),
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
              compiledPlan: savedCompiled.compiledPlan,
              effectivePlanGraph: effective,
              taskSessionKey: sharedTaskSessionKey,
              savedPlan: buildSavedPlanSummary(savedCompiled),
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
                workspaceId: resolvedWorkspaceId ?? undefined,
                planningPrompt,
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
                  finalResponse = {
                    source: event.source ?? event.plan.source,
                    planGraph: event.planGraph,
                    taskSessionKey: sharedTaskSessionKey,
                    savedPlan: event.savedPlan,
                  };
                  if (!safeEnqueue("result", finalResponse)) break;
                } else if (event.type === "error") {
                  logger.error("request.plan_generation_error", {
                    requestId,
                    feature: "generate_plan",
                    taskId: taskId ?? null,
                    error: event.message,
                    rawText: event.rawText,
                    diagnostics: event.diagnostics,
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

      const compResult = compilePlanBlueprint({
        taskId: taskId ?? "",
        blueprint: planResult.blueprint,
        prompt: planningPrompt ?? null,
        generatedBy: planResult.source ?? "ai",
        source: "ai",
      });

      if (taskId && resolvedWorkspaceId) {
        await saveCompiledPlan({
          workspaceId: resolvedWorkspaceId,
          taskId,
          compiledPlan: compResult.compiledPlan,
          status: "draft",
          prompt: planningPrompt ?? null,
          summary: planResult.blueprint.title ?? null,
          generatedBy: planResult.source ?? "ai",
        });

        const run = createPlanRunFromCompiledPlan(compResult.compiledPlan, [compResult.initialLayer]);
        await savePlanRun({
          workspaceId: resolvedWorkspaceId,
          taskId,
          planId: compResult.planId,
          run,
          layers: [compResult.initialLayer],
        });

        return json(c, {
          source: planResult.source,
          compiledPlan: compResult.compiledPlan,
          planId: compResult.planId,
          taskSessionKey: sharedTaskSessionKey,
        });
      }

      return json(c, {
        source: planResult.source,
        compiledPlan: compResult.compiledPlan,
        planId: compResult.planId,
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

      const task = await getTaskOrThrow(taskId);

      if (providedBlueprint !== undefined) {
        if (!providedBlueprint || typeof providedBlueprint !== "object" || !Array.isArray(providedBlueprint.nodes)) {
          return error(c, "blueprint must be a valid plan blueprint", 400);
        }
      }

      let compiledPlan: CompiledPlan | null = null;
      let planId: string | null = null;
      let graphPlan: { compiledPlan: CompiledPlan; planId: string } | null = null;
      if (providedBlueprint && Array.isArray(providedBlueprint.nodes) && providedBlueprint.nodes.length > 0) {
        const compResult = compilePlanBlueprint({
          taskId,
          blueprint: providedBlueprint,
          generatedBy: "batch-apply",
          source: "ai",
        });
        compiledPlan = compResult.compiledPlan;
        planId = compResult.planId;
        graphPlan = { compiledPlan: compResult.compiledPlan, planId: compResult.planId };

        await saveCompiledPlan({
          workspaceId: task.workspaceId,
          taskId: task.id,
          compiledPlan: compResult.compiledPlan,
          status: "draft",
          generatedBy: "batch-apply",
          summary: providedBlueprint.title ?? null,
        });

        const run = createPlanRunFromCompiledPlan(compResult.compiledPlan, [compResult.initialLayer]);
        await savePlanRun({
          workspaceId: task.workspaceId,
          taskId: task.id,
          planId: compResult.planId,
          run,
          layers: [compResult.initialLayer],
        });
      } else {
        const savedCompiled = await getLatestCompiledPlan(taskId);
        if (!savedCompiled) {
          return error(c, "No plan found for task", 404);
        }
        compiledPlan = savedCompiled.compiledPlan;
        planId = savedCompiled.compiledPlan.editablePlanId;
        graphPlan = { compiledPlan: savedCompiled.compiledPlan, planId: savedCompiled.compiledPlan.editablePlanId };
      }

      const materialized = await materializeTaskPlan({ taskId: task.id });
      const createdTasks = await getTasksWithProjections(materialized.createdTaskIds);
      const accepted = await getAcceptedCompiledPlan(taskId);
      const layers = accepted ? await getLayers(taskId, accepted.planId) : [];
      const effective = accepted ? resolveEffectivePlanGraph(accepted.compiledPlan, layers) : null;
      const materializedNodeIds = new Set(
        (effective?.nodes ?? [])
          .filter((node) => typeof node.linkedTaskId === "string" && node.linkedTaskId.length > 0)
          .map((node) => node.id),
      );
      const requestedNodeIds = new Set((effective?.nodes ?? []).map((node) => node.id));
      const skippedNodeIds = [...requestedNodeIds].filter((nodeId) => !materializedNodeIds.has(nodeId));

      return json(c, {
        parentTaskId: taskId,
        childTasks: createdTasks,
        compiledPlan,
        planId,
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
      const message = cause instanceof Error ? cause.message : "Failed to apply plan patch";
      const status = message.includes("not found") ? 404 : message.includes("requires") ? 400 : 500;
      return error(c, message, status);
    }
  });

  api.post("/plan-runs/from-accepted", async (c) => {
    try {
      const body = await c.req.json();
      const taskId = typeof body.taskId === "string" ? body.taskId : "";

      if (!taskId) {
        return error(c, "taskId is required", 400);
      }

      const task = await getTaskOrThrow(taskId);

      const accepted = await getAcceptedCompiledPlan(taskId);
      if (!accepted) return error(c, "No accepted plan found for this task", 404);

      const result = createPlanRunFromCompiledPlan(accepted.compiledPlan, []);
      if (!result) return error(c, "Failed to create PlanRun", 400);

      await savePlanRun({
        workspaceId: task.workspaceId,
        taskId,
        planId: accepted.planId,
        run: result,
      });

      return json(c, { planRun: result }, 201);
    } catch (cause) {
      return internalServerError(c, "POST /api/plan-runs/from-accepted", cause, "Failed to create PlanRun");
    }
  });

  api.post("/plan-runs/command", async (c) => {
    try {
      const body = await c.req.json();
      const taskId = typeof body.taskId === "string" ? body.taskId : "";
      const command = body.command as RuntimeCommand | undefined;

      if (!taskId) {
        return error(c, "taskId is required", 400);
      }

      if (!command || typeof command.type !== "string") {
        return error(c, "command is required with a valid 'type' field", 400);
      }

      const task = await getTaskOrThrow(taskId);

      const accepted = await getAcceptedCompiledPlan(taskId);
      if (!accepted) return error(c, "No accepted plan found for this task", 404);

      const runAndLayers = await getPlanRun(taskId, accepted.planId);
      if (!runAndLayers) return error(c, "No PlanRun found. Create one first via POST /api/plan-runs/from-accepted", 404);

      const result = applyCommandAndProduceLayer(runAndLayers.planRun, accepted.compiledPlan, command, 1);

      if (!result.ok || !result.run) {
        return json(c, { ok: false, error: result.error }, 400);
      }

      const layers = [...runAndLayers.layers];
      if (result.layer) {
        layers.push(result.layer);
      }

      await savePlanRun({
        workspaceId: task.workspaceId,
        taskId,
        planId: accepted.planId,
        run: result.run,
        layers,
      });

      return json(c, { ok: true, planRun: result.run });
    } catch (cause) {
      return internalServerError(c, "POST /api/plan-runs/command", cause, "Failed to apply runtime command");
    }
  });

  api.get("/tasks/:taskId/plan-run", async (c) => {
    try {
      const taskId = c.req.param("taskId");

      const planRun = await getLatestPlanRun(taskId);
      if (!planRun) return error(c, "No PlanRun found for this task", 404);

      return json(c, { planRun });
    } catch (cause) {
      return internalServerError(c, "GET /api/tasks/:taskId/plan-run", cause, "Failed to get PlanRun");
    }
  });

  return api;
}
