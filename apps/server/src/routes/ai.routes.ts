import { Hono } from "hono";
import { randomUUID } from "node:crypto";

import { db } from "@chrona/db";
import { summarizeText } from "@chrona/db/logger";
import type { StructuredSuggestion } from "@chrona/contracts";
import type { TaskSnapshot, ScheduleHealthSnapshot } from "@chrona/runtime/modules/ai/ai-service";
import type { ScheduleSlot, ScheduledTaskInfo, TaskAutomationInput } from "@chrona/runtime/modules/ai/types";
import {
  aiAnalyzeConflicts,
  aiChat,
  aiSuggestStream,
  aiSuggestTimeslots,
  getAIClientInfo,
  isAIAvailable,
} from "@chrona/runtime/modules/ai/ai-service";
import { analyzeConflictsSmart } from "@chrona/runtime/modules/ai/conflict-analyzer";
import { suggestAutomationSmart } from "@chrona/runtime/modules/ai/automation-suggester";
import { suggestTimeslots } from "@chrona/runtime/modules/ai/timeslot-suggester";
import { ensureDefaultTaskSession } from "@chrona/runtime/modules/task-execution/task-sessions";

import {
  testOpenClaw,
  testLlm,
  VALID_AI_FEATURES,
  logger,
  generateSuggestionSummary,
  tryExtractSuggestions,
  sseEncode,
} from "./helpers";
import {
  error,
  internalServerError,
  json,
  toHttpError,
} from "../lib/http";

export function createAiRoutes() {
  const ai = new Hono();

  // ──────────────────────────────────────────────
  // AI Client Management
  // ──────────────────────────────────────────────

  ai.get("/ai/clients", async (c) => {
    try {
      const clients = await db.aiClient.findMany({
        include: { bindings: true },
        orderBy: { createdAt: "asc" },
      });

      return json(c, {
        clients: clients.map((client) => ({
          id: client.id,
          name: client.name,
          type: client.type,
          config: client.config,
          isDefault: client.isDefault,
          enabled: client.enabled,
          bindings: client.bindings.map((binding) => binding.feature),
          createdAt: client.createdAt.toISOString(),
        })),
      });
    } catch (cause) {
      return internalServerError(c, "GET /api/ai/clients", cause, "Failed to list AI clients");
    }
  });

  ai.post("/ai/clients", async (c) => {
    try {
      const body = await c.req.json();
      const { name, type, config, isDefault } = body;

      if (!name || !type) {
        return error(c, "name and type are required", 400);
      }

      if (type !== "openclaw" && type !== "llm") {
        return error(c, "type must be 'openclaw' or 'llm'", 400);
      }

      if (isDefault) {
        await db.aiClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }

      const client = await db.aiClient.create({
        data: {
          id: randomUUID().replace(/-/g, "").slice(0, 25),
          name,
          type,
          config: config ?? {},
          isDefault: isDefault ?? false,
          enabled: true,
        },
      });

      return json(c, { client }, 201);
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/clients", cause, "Failed to create AI client");
    }
  });

  ai.post("/ai/clients/test", async (c) => {
    try {
      const body = await c.req.json();
      const { type, config } = body ?? {};

      if (!type || (type !== "openclaw" && type !== "llm")) {
        return json(c, { ok: false, error: "type must be 'openclaw' or 'llm'" }, 400);
      }

      const result = type === "openclaw"
        ? await testOpenClaw((config ?? {}) as Record<string, unknown>)
        : testLlm((config ?? {}) as Record<string, unknown>);

      return json(c, { ok: true, ...result });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to test client";
      return json(c, { ok: false, available: false, reason: message, error: message }, 500);
    }
  });

  ai.get("/ai/clients/:clientId", async (c) => {
    try {
      const client = await db.aiClient.findUnique({
        where: { id: c.req.param("clientId") },
        include: { bindings: true },
      });

      if (!client) {
        return error(c, "Client not found", 404);
      }

      return json(c, {
        id: client.id,
        name: client.name,
        type: client.type,
        config: client.config,
        isDefault: client.isDefault,
        enabled: client.enabled,
        bindings: client.bindings.map((binding) => binding.feature),
      });
    } catch (cause) {
      return internalServerError(c, "GET /api/ai/clients/:clientId", cause, "Failed to get AI client");
    }
  });

  ai.patch("/ai/clients/:clientId", async (c) => {
    try {
      const clientId = c.req.param("clientId");
      const body = await c.req.json();
      const existing = await db.aiClient.findUnique({ where: { id: clientId } });

      if (!existing) {
        return error(c, "Client not found", 404);
      }

      if (body.isDefault === true) {
        await db.aiClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }

      const updated = await db.aiClient.update({
        where: { id: clientId },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.config !== undefined && { config: body.config }),
          ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
        },
      });

      return json(c, { client: updated });
    } catch (cause) {
      return internalServerError(c, "PATCH /api/ai/clients/:clientId", cause, "Failed to update AI client");
    }
  });

  ai.delete("/ai/clients/:clientId", async (c) => {
    try {
      await db.aiClient.delete({ where: { id: c.req.param("clientId") } });
      return json(c, { success: true });
    } catch {
      return error(c, "Client not found", 404);
    }
  });

  ai.get("/ai/clients/:clientId/bindings", async (c) => {
    try {
      const bindings = await db.aiFeatureBinding.findMany({ where: { clientId: c.req.param("clientId") } });
      return json(c, { features: bindings.map((binding) => binding.feature) });
    } catch (cause) {
      return internalServerError(c, "GET /api/ai/clients/:clientId/bindings", cause, "Failed to get feature bindings");
    }
  });

  ai.put("/ai/clients/:clientId/bindings", async (c) => {
    try {
      const clientId = c.req.param("clientId");
      const body = await c.req.json();
      const features = body.features;

      if (!Array.isArray(features)) {
        return error(c, "features must be an array", 400);
      }

      const client = await db.aiClient.findUnique({ where: { id: clientId } });
      if (!client) {
        return error(c, "Client not found", 404);
      }

      const validFeatures = features.filter((feature: string) => (VALID_AI_FEATURES as readonly string[]).includes(feature));

      if (validFeatures.length > 0) {
        await db.aiFeatureBinding.deleteMany({ where: { feature: { in: validFeatures } } });
      }

      await db.aiFeatureBinding.deleteMany({
        where: {
          clientId,
          feature: { notIn: validFeatures },
        },
      });

      for (const feature of validFeatures) {
        await db.aiFeatureBinding.create({
          data: {
            id: randomUUID().replace(/-/g, "").slice(0, 25),
            feature,
            clientId,
          },
        });
      }

      return json(c, { bindings: validFeatures });
    } catch (cause) {
      return internalServerError(c, "PUT /api/ai/clients/:clientId/bindings", cause, "Failed to update feature bindings");
    }
  });

  // ──────────────────────────────────────────────
  // Scheduling AI Intelligence
  // ──────────────────────────────────────────────

  ai.post("/ai/suggest-timeslot", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceId, taskId, date } = body;

      if (!workspaceId || !taskId) {
        return error(c, "workspaceId and taskId are required", 400);
      }

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) {
        return error(c, "Task not found", 404);
      }

      const targetDate = date ? new Date(date) : new Date();
      targetDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const projections = await db.taskProjection.findMany({
        where: {
          workspaceId,
          scheduledStartAt: { gte: targetDate, lt: nextDay },
          NOT: { taskId },
        },
        include: { task: { select: { title: true, priority: true, status: true } } },
      });

      let estimatedMinutes = 60;
      if (task.scheduledStartAt && task.scheduledEndAt) {
        estimatedMinutes = Math.round((new Date(task.scheduledEndAt).getTime() - new Date(task.scheduledStartAt).getTime()) / 60000);
      }

      const taskSnapshots: TaskSnapshot[] = projections
        .filter((projection) => projection.scheduledStartAt && projection.scheduledEndAt)
        .map((projection) => ({
          id: projection.taskId,
          title: projection.task?.title ?? "",
          status: projection.task?.status ?? "open",
          priority: projection.task?.priority ?? undefined,
          scheduledStartAt: projection.scheduledStartAt!.toISOString(),
          scheduledEndAt: projection.scheduledEndAt!.toISOString(),
        }));

      const adapterResult = await aiSuggestTimeslots({
        taskTitle: task.title,
        estimatedMinutes,
        priority: task.priority as "Low" | "Medium" | "High" | "Urgent" | undefined,
        deadline: task.dueAt?.toISOString(),
        currentSchedule: taskSnapshots,
      });

      if (adapterResult) {
        return json(c, adapterResult);
      }

      const currentSchedule: ScheduleSlot[] = projections
        .filter((projection) => projection.scheduledStartAt !== null && projection.scheduledEndAt !== null)
        .map((projection) => ({
          taskId: projection.taskId,
          title: projection.task?.title ?? "Untitled",
          startAt: projection.scheduledStartAt!,
          endAt: projection.scheduledEndAt!,
        }));

      return json(c, suggestTimeslots({
        taskId: task.id,
        title: task.title,
        priority: task.priority,
        estimatedMinutes,
        dueAt: task.dueAt,
        currentSchedule,
      }));
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/suggest-timeslot", cause, "Failed to suggest timeslot");
    }
  });

  ai.post("/ai/suggest-automation", async (c) => {
    try {
      const body = await c.req.json();
      const { taskId, title, description, priority, dueAt, scheduledStartAt, scheduledEndAt, isRunnable, runnabilityState, ownerType } = body;

      if (!taskId && !title) {
        return error(c, "Either taskId or title is required", 400);
      }

      const input: TaskAutomationInput = taskId && !title
        ? (() => {
            const task = null as never;
            return task;
          })()
        : {
            taskId: taskId ?? "",
            title,
            description: description ?? "",
            priority: priority ?? "Medium",
            dueAt: dueAt ? new Date(dueAt) : null,
            scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt) : null,
            scheduledEndAt: scheduledEndAt ? new Date(scheduledEndAt) : null,
            isRunnable: isRunnable ?? false,
            runnabilityState: runnabilityState ?? "",
            ownerType: ownerType ?? "",
          };

      if (taskId && !title) {
        const task = await db.task.findUnique({ where: { id: taskId } });
        if (!task) {
          return error(c, "Task not found", 404);
        }
        return json(c, await suggestAutomationSmart({
          taskId: task.id,
          title: task.title,
          description: task.description ?? "",
          priority: task.priority,
          dueAt: task.dueAt,
          scheduledStartAt: task.scheduledStartAt,
          scheduledEndAt: task.scheduledEndAt,
          isRunnable: !!task.runtimeAdapterKey,
          runnabilityState: task.status ?? "",
          ownerType: task.ownerType ?? "",
        }));
      }

      return json(c, await suggestAutomationSmart(input));
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/suggest-automation", cause, "Failed to suggest automation");
    }
  });

  ai.post("/ai/analyze-conflicts", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceId, date } = body;

      if (!workspaceId) {
        return error(c, "workspaceId is required", 400);
      }

      let startDate: Date;
      let endDate: Date;
      if (date) {
        startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
      } else {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 7);
      }

      const projections = await db.taskProjection.findMany({
        where: {
          workspaceId,
          scheduledStartAt: { gte: startDate, lt: endDate },
        },
        include: {
          task: {
            include: {
              dependencies: { select: { dependsOnTaskId: true } },
            },
          },
        },
      });

      const validProjections = projections.filter(
        (projection) => projection.scheduledStartAt !== null && projection.scheduledEndAt !== null && projection.task !== null,
      );

      const taskSnapshots: TaskSnapshot[] = validProjections.map((projection) => ({
        id: projection.taskId,
        title: projection.task.title,
        status: projection.task.status,
        priority: projection.task.priority ?? undefined,
        scheduledStartAt: projection.scheduledStartAt!.toISOString(),
        scheduledEndAt: projection.scheduledEndAt!.toISOString(),
      }));

      const adapterResult = await aiAnalyzeConflicts({
        tasks: taskSnapshots,
        workspaceId,
        focusDate: date,
      });

      if (adapterResult) {
        return json(c, adapterResult);
      }

      const tasks: ScheduledTaskInfo[] = validProjections.map((projection) => ({
        taskId: projection.taskId,
        title: projection.task.title,
        priority: projection.task.priority,
        scheduledStartAt: projection.scheduledStartAt!,
        scheduledEndAt: projection.scheduledEndAt!,
        dueAt: projection.task.dueAt,
        estimatedMinutes: Math.round((projection.scheduledEndAt!.getTime() - projection.scheduledStartAt!.getTime()) / 60000),
        dependencies: projection.task.dependencies.map((dependency) => dependency.dependsOnTaskId),
      }));

      return json(c, await analyzeConflictsSmart(tasks));
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/analyze-conflicts", cause, "Failed to analyze conflicts");
    }
  });

  // ──────────────────────────────────────────────
  // AI Task Dispatching & Auto-Complete
  // ──────────────────────────────────────────────

  ai.post("/ai/dispatch-task", async (c) => {
    try {
      const body = await c.req.json();
      const taskId = typeof body.taskId === "string" ? body.taskId : "";
      const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";

      if (!taskId || !workspaceId) {
        return error(c, "taskId and workspaceId are required", 400);
      }

      const { dispatchNextTaskAction } = await import("@chrona/runtime/modules/commands/dispatch-next-task-action");
      return json(c, await dispatchNextTaskAction({
        taskId,
        workspaceId,
        mode: "preview",
      }));
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/dispatch-task", cause, "Failed to dispatch task");
    }
  });

  ai.post("/ai/auto-complete", async (c) => {
    try {
      const body = await c.req.json();
      const { title, workspaceId } = body;

      if (!title || typeof title !== "string" || title.trim().length < 2) {
        return error(c, "title is required (min 2 characters)", 400);
      }

      const trimmedTitle = title.trim();
      const requestId = randomUUID();
      logger.info("request.start", {
        requestId,
        workspaceId: workspaceId ?? null,
        feature: "suggest",
        rawInput: summarizeText(title),
        normalizedInput: summarizeText(trimmedTitle),
        source: "schedule_quick_create",
        streaming: true,
      });

      let context: { existingTasks?: TaskSnapshot[]; scheduleHealth?: ScheduleHealthSnapshot } | undefined;
      let sharedTaskSessionKey: string | null = null;
      if (workspaceId) {
        try {
          const recentTasks = await db.taskProjection.findMany({
            where: { workspaceId },
            take: 10,
            orderBy: { updatedAt: "desc" },
            include: { task: { select: { title: true, status: true, priority: true, defaultSessionId: true, runtimeAdapterKey: true } } },
          });
          context = {
            existingTasks: recentTasks.map((projection) => ({
              id: projection.taskId,
              title: projection.task?.title ?? "",
              status: projection.task?.status ?? "open",
              priority: projection.task?.priority ?? undefined,
              scheduledStartAt: projection.scheduledStartAt?.toISOString(),
              scheduledEndAt: projection.scheduledEndAt?.toISOString(),
            })),
          };

          const exactTask = recentTasks.find((projection) => projection.task?.title?.trim() === trimmedTitle);
          if (exactTask?.task) {
            sharedTaskSessionKey = (
              await ensureDefaultTaskSession({
                taskId: exactTask.taskId,
                taskTitle: exactTask.task.title ?? trimmedTitle,
                runtimeName: exactTask.task.runtimeAdapterKey ?? "openclaw",
                defaultSessionId: exactTask.task.defaultSessionId,
              })
            ).sessionKey;
          }
        } catch {
          /* session creation may fail; continue with stream */
        }
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            let fullText = "";
            const eventCounts: Record<string, number> = {};
            const generator = aiSuggestStream({
              input: trimmedTitle,
              kind: "auto-complete",
              workspaceId,
              taskId: context?.existingTasks?.find((task) => task.title?.trim() === trimmedTitle)?.id,
              sessionKey: sharedTaskSessionKey ?? undefined,
              context,
            });

            for await (const event of generator) {
              eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
              logger.info("stream.event", {
                requestId,
                workspaceId: workspaceId ?? null,
                feature: "suggest",
                eventType: event.type,
              });
              switch (event.type) {
                case "status":
                  controller.enqueue(encoder.encode(sseEncode("status", { message: event.message })));
                  break;
                case "tool_call":
                  controller.enqueue(encoder.encode(sseEncode("tool_call", { tool: event.tool, input: event.input })));
                  break;
                case "tool_result":
                  controller.enqueue(encoder.encode(sseEncode("tool_result", { tool: event.tool, result: event.result })));
                  break;
                case "partial":
                  fullText += event.text;
                  controller.enqueue(encoder.encode(sseEncode("partial", { text: event.text })));
                  break;
                case "result":
                  if ("suggestions" in event) {
                    const aiSuggestions = event.suggestions.suggestions.map((suggestion) => ({
                      id: randomUUID(),
                      summary: generateSuggestionSummary({
                        title: suggestion.title,
                        priority: suggestion.priority,
                        estimatedMinutes: suggestion.estimatedMinutes,
                      }),
                      action: {
                        type: "create_task",
                        title: suggestion.title,
                        description: suggestion.description,
                        priority: suggestion.priority,
                        estimatedMinutes: suggestion.estimatedMinutes,
                        tags: suggestion.tags,
                        scheduledStartAt: suggestion.suggestedSlot?.startAt,
                        scheduledEndAt: suggestion.suggestedSlot?.endAt,
                      },
                    }));
                    if (aiSuggestions.length > 0) {
                      controller.enqueue(encoder.encode(sseEncode("suggestions", {
                        suggestions: aiSuggestions,
                        source: event.suggestions.source ?? "ai",
                        requestId,
                        isFinal: true,
                      })));
                    }
                  }
                  break;
                case "done": {
                  fullText = event.text;
                  const aiSuggestions = tryExtractSuggestions(fullText);
                  if (aiSuggestions && aiSuggestions.length > 0) {
                    controller.enqueue(encoder.encode(sseEncode("suggestions", {
                      suggestions: aiSuggestions,
                      source: "ai",
                      requestId,
                      isFinal: true,
                    })));
                  }
                  break;
                }
                case "error":
                  controller.enqueue(encoder.encode(sseEncode("error", { message: event.message })));
                  break;
              }
            }

            logger.info("request.done", {
              requestId,
              workspaceId: workspaceId ?? null,
              feature: "suggest",
              eventCounts,
            });
            controller.enqueue(encoder.encode(sseEncode("done", { requestId })));
            controller.close();
          } catch (cause) {
            logger.error("request.stream_error", {
              requestId,
              workspaceId: workspaceId ?? null,
              feature: "suggest",
              error: cause instanceof Error ? cause.message : String(cause),
            });
            controller.enqueue(encoder.encode(sseEncode("error", {
              message: cause instanceof Error ? cause.message : "Unknown error",
            })));
            controller.close();
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
      logger.error("request.error", {
        feature: "suggest",
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return error(c, "Failed to generate suggestions", 500);
    }
  });

  // ──────────────────────────────────────────────
  // Suggestion Application
  // ──────────────────────────────────────────────

  ai.post("/ai/apply-suggestion", async (c) => {
    try {
      const body = await c.req.json();
      if (body && typeof body === "object" && "changes" in body && Array.isArray(body.changes)) {
        const { workspaceId, suggestionId, changes } = body as {
          workspaceId: string;
          suggestionId: string;
          changes: Array<{ taskId: string; scheduledStartAt?: string; scheduledEndAt?: string; priority?: string }>;
        };

        if (!workspaceId || !suggestionId || !changes) {
          return error(c, "workspaceId, suggestionId, and changes are required", 400);
        }

        const taskIds = changes.map((change) => change.taskId);
        const tasks = await db.task.findMany({
          where: { id: { in: taskIds }, workspaceId },
        });

        if (tasks.length !== taskIds.length) {
          return error(c, "Some tasks do not belong to this workspace", 403);
        }

        await Promise.all(changes.map((change) => db.taskProjection.update({
          where: { taskId: change.taskId },
          data: {
            ...(change.scheduledStartAt && { scheduledStartAt: new Date(change.scheduledStartAt) }),
            ...(change.scheduledEndAt && { scheduledEndAt: new Date(change.scheduledEndAt) }),
            updatedAt: new Date(),
          },
        })));

        return json(c, { success: true, appliedChanges: changes.length, suggestionId });
      }

      const { workspaceId, suggestion } = body as { workspaceId: string; suggestion: StructuredSuggestion };
      if (!workspaceId || !suggestion?.action) {
        return error(c, "workspaceId and suggestion with action are required", 400);
      }

      if (suggestion.action.type !== "create_task") {
        return error(c, `Unknown action type: ${suggestion.action.type}`, 400);
      }

      const taskId = randomUUID();
      const now = new Date();
      await db.task.create({
        data: {
          id: taskId,
          workspaceId,
          title: suggestion.action.title,
          description: suggestion.action.description || null,
          priority: suggestion.action.priority,
          status: "Draft",
          scheduleStatus: suggestion.action.scheduledStartAt ? "Scheduled" : "Unscheduled",
          scheduleSource: "ai",
          scheduledStartAt: suggestion.action.scheduledStartAt ? new Date(suggestion.action.scheduledStartAt) : null,
          scheduledEndAt: suggestion.action.scheduledEndAt ? new Date(suggestion.action.scheduledEndAt) : null,
          ownerType: "human",
          createdAt: now,
          updatedAt: now,
        },
      });
      await db.taskProjection.upsert({
        where: { taskId },
        create: {
          taskId,
          workspaceId,
          persistedStatus: "Draft",
          scheduledStartAt: suggestion.action.scheduledStartAt ? new Date(suggestion.action.scheduledStartAt) : null,
          scheduledEndAt: suggestion.action.scheduledEndAt ? new Date(suggestion.action.scheduledEndAt) : null,
          updatedAt: now,
        },
        update: {
          scheduledStartAt: suggestion.action.scheduledStartAt ? new Date(suggestion.action.scheduledStartAt) : null,
          scheduledEndAt: suggestion.action.scheduledEndAt ? new Date(suggestion.action.scheduledEndAt) : null,
          updatedAt: now,
        },
      });

      return json(c, {
        success: true,
        taskId,
        suggestionId: suggestion.id,
        action: suggestion.action.type,
        summary: suggestion.summary,
      });
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/apply-suggestion", cause, "Failed to apply suggestion");
    }
  });

  // ──────────────────────────────────────────────
  // Task Workspace AI Chat
  // ──────────────────────────────────────────────

  ai.post("/ai/task-workspace/chat", async (c) => {
    try {
      const body = await c.req.json();
      const taskId = typeof body.taskId === "string" ? body.taskId : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const currentTask = body.currentTask ?? null;
      const currentPlan = body.currentPlan ?? null;
      const history = Array.isArray(body.history) ? body.history : [];

      if (!taskId) {
        return error(c, "taskId is required", 400);
      }
      if (!message) {
        return error(c, "message is required", 400);
      }

      const taskSnapshotText = currentTask
        ? JSON.stringify(currentTask, null, 2)
        : "No task data provided.";

      const planSnapshotText = currentPlan
        ? JSON.stringify(
            {
              id: currentPlan.id,
              status: currentPlan.status,
              revision: currentPlan.revision,
              summary: currentPlan.summary,
              nodeCount: currentPlan.nodes?.length ?? 0,
              nodes: (currentPlan.nodes ?? []).map((n: Record<string, unknown>) => ({
                id: n.id,
                title: n.title,
                status: n.status,
                objective: n.objective,
                estimatedMinutes: n.estimatedMinutes,
                priority: n.priority,
                executionMode: n.executionMode,
                dependsOn: n.dependsOn,
              })),
              edges: (currentPlan.edges ?? []).map((e: Record<string, unknown>) => ({
                fromNodeId: e.fromNodeId,
                toNodeId: e.toNodeId,
                type: e.type,
              })),
            },
            null,
            2,
          )
        : "No plan data provided.";

      const systemPrompt = `You are the Task Workspace Assistant for Chrona.
Your role is to help users modify the current task and its corresponding plan through natural language.

## Current Task:
${taskSnapshotText}

## Current Plan:
${planSnapshotText}

## Data schemas (CRITICAL — use these exact field names):

### Node fields when creating (add_node):
{ "id": "unique-string", "type": "step"|"checkpoint"|"decision"|"user_input"|"deliverable"|"tool_action", "title": "string", "objective": "string", "description": "string or null", "status": "pending"|"in_progress"|"done"|"blocked"|"skipped", "estimatedMinutes": number|null, "priority": "Low"|"Medium"|"High"|"Urgent"|null, "executionMode": "automatic"|"manual"|"hybrid" }

### NodePatch fields (update_node — only include fields to change):
{ "id": "node-id", "title"?: "string", "objective"?: "string", "description"?: "string", "estimatedMinutes"?: number, "status"?: "pending"|"in_progress"|"done", "priority"?: "Low"|"Medium"|"High"|"Urgent", "executionMode"?: "automatic"|"manual"|"hybrid" }

### Edge fields (for add_node and update_dependencies):
{ "id"?: "edge-id", "fromNodeId": "existing-node-id", "toNodeId": "existing-node-id", "type": "depends_on"|"sequential"|"branches_to"|"unblocks"|"feeds_output" }

## Available operations:

### update_node
Edit content of existing nodes. Use nodePatches[] with ONLY the fields to change plus the node "id". Edges are unchanged.
When: "change node X title to Y", "clarify step 2", "mark node X as done"

### add_node
Add new nodes. Provide full node objects in nodes[] using the Node fields schema above. Provide connecting edges in edges[] using the Edge fields schema. Edge fromNodeId/toNodeId MUST reference existing node IDs from the current plan.
When: "add a step for testing", "insert a review node"

### delete_node
Remove nodes by ID in deletedNodeIds[]. Edges involving deleted nodes are auto-removed.
When: "remove the deployment step", "delete node X"

### update_dependencies
ADD new edges (or replace existing ones). Provide edges[] using the Edge fields schema. Edges not listed are KEPT. Duplicate fromNodeId→toNodeId pairs are ignored (idempotent).
When: "connect X to Y", "add a dependency from A to B"

### reorder_nodes
Change the display order of specific nodes. Provide reorder[] with ONLY the node IDs being reordered, in the desired order. Other nodes keep their relative positions. The reordered block is placed at the position of the first reordered node.
When: "move X before Y", "reorder the steps"

### update_plan_summary
Change only the plan's top-level summary text.
When: "rename the plan", "change the plan description"

### replace_plan
Replace the entire plan graph. Use ONLY when user asks to regenerate or overhaul.
When: "regenerate the whole plan", "start over"

### materialize_child_tasks
Convert plan nodes into child tasks.
When: "materialize", "create subtasks", "sync to child tasks"

## Choosing the right operation (EXAMPLES):
- "update node X to say Y" → update_node with nodePatches: [{"id":"X", "title":"Y"}]
- "clarify / make clearer / reword node X" → update_node with nodePatches: [{"id":"X", "objective":"..."}]
- "add a step for testing after node B" → add_node with nodes: [{...}], edges: [{"fromNodeId":"B", "toNodeId":"new-id", "type":"sequential"}]
- "remove the deployment step" → delete_node with deletedNodeIds: ["node-d"]
- "connect step A to step C" → update_dependencies with edges: [{"fromNodeId":"A", "toNodeId":"C", "type":"depends_on"}]
- "move review before design" → reorder_nodes with reorder: ["review-id", "design-id"]
- "rename this plan to..." → update_plan_summary with summary: "New Name"
- "regenerate the whole plan" → replace_plan with nodes/edges

## NEVER use "custom" as an operation.

## Rules:
1. ONLY use proposals when the user explicitly asks for a change.
2. Use the exact field names from the schemas above.
3. All time fields must be ISO 8601 (e.g. "2026-04-26T15:00:00.000Z").
4. Do NOT modify system fields (id, workspaceId, createdAt, updatedAt).
5. requiresConfirmation: true for: replacing plan, deleting nodes, materializing, clearing prompt/description, modifying runtimeConfig, schedule adjustments.
6. Priority: "Low"|"Medium"|"High"|"Urgent".
7. Edge fromNodeId/toNodeId MUST match EXISTING node IDs from the current plan.
8. For add_node edges, reference nodes by their real IDs from the plan snapshot.

## Response format:
Always respond as:
{
  "assistantMessage": "Your conversational reply.",
  "proposal": {
    "summary": "Brief summary of changes",
    "confidence": "high"|"medium"|"low",
    "taskPatch": { /* optional */ },
    "planPatch": {
      "operation": "update_node"|"add_node"|"delete_node"|"update_dependencies"|"reorder_nodes"|"update_plan_summary"|"replace_plan"|"materialize_child_tasks"
      /* Include exactly one of: nodePatches[], nodes[]+edges[], deletedNodeIds[], edges[], reorder[], summary */
    },
    "warnings": [],
    "requiresConfirmation": true|false
  }
}

## Concrete response examples:

### Example 1 — update a node title:
{
  "assistantMessage": "I've updated the Research node title to 'Deep Market Research'.",
  "proposal": {
    "summary": "Rename Research node",
    "confidence": "high",
    "planPatch": {
      "operation": "update_node",
      "nodePatches": [{ "id": "node-a", "title": "Deep Market Research" }]
    },
    "requiresConfirmation": false
  }
}

### Example 2 — add a node with an edge:
{
  "assistantMessage": "I've added a 'Code Review' step after the Design phase.",
  "proposal": {
    "summary": "Add Code Review step after Design",
    "confidence": "high",
    "planPatch": {
      "operation": "add_node",
      "nodes": [{ "id": "node-review", "type": "checkpoint", "title": "Code Review", "objective": "Review code for quality", "executionMode": "manual" }],
      "edges": [{ "fromNodeId": "node-b", "toNodeId": "node-review", "type": "sequential" }]
    },
    "requiresConfirmation": false
  }
}

### Example 3 — add a dependency:
{
  "assistantMessage": "I've connected the Research node directly to the Review node.",
  "proposal": {
    "summary": "Add dependency from Research to Review",
    "confidence": "high",
    "planPatch": {
      "operation": "update_dependencies",
      "edges": [{ "fromNodeId": "node-a", "toNodeId": "node-c", "type": "depends_on" }]
    },
    "requiresConfirmation": false
  }
}

### Example 4 — delete a node:
{
  "assistantMessage": "I've removed the Shipping step from the plan.",
  "proposal": {
    "summary": "Remove Shipping node",
    "confidence": "high",
    "planPatch": {
      "operation": "delete_node",
      "deletedNodeIds": ["node-d"]
    },
    "requiresConfirmation": true
  }
}

### Example 5 — reorder nodes:
{
  "assistantMessage": "I've moved the Review step before Design.",
  "proposal": {
    "summary": "Reorder: Review before Design",
    "confidence": "high",
    "planPatch": {
      "operation": "reorder_nodes",
      "reorder": ["node-c", "node-b"]
    },
    "requiresConfirmation": false
  }
}

### Example 6 — update plan summary:
{
  "assistantMessage": "I've renamed the plan to 'Q2 Delivery Flow'.",
  "proposal": {
    "summary": "Rename plan",
    "confidence": "high",
    "planPatch": {
      "operation": "update_plan_summary",
      "summary": "Q2 Delivery Flow"
    },
    "requiresConfirmation": false
  }
}

### Example 7 — conversational (no change):
{
  "assistantMessage": "Your plan has 4 steps in a linear A→B→C→D flow. The Research step is estimated at 30 minutes."
}

Only include \`proposal\` when the user has clearly asked for a specific modification.`;

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
      ];

      for (const entry of history) {
        if (
          entry &&
          typeof entry === "object" &&
          (entry.role === "user" || entry.role === "assistant") &&
          typeof entry.content === "string"
        ) {
          messages.push(entry as { role: "user" | "assistant"; content: string });
        }
      }

      messages.push({ role: "user", content: message });

      const response = await aiChat({
        messages,
        jsonMode: true,
        temperature: 0.3,
      });

      if (!response) {
        return json(c, {
          assistantMessage:
            "Sorry, I could not process your request. AI service may be unavailable.",
        });
      }

      if (response.parsed && typeof response.parsed === "object") {
        const parsed = response.parsed as Record<string, unknown>;

        let assistantMessage: string;
        let proposal: Record<string, unknown> | undefined;

        if (typeof parsed.assistantMessage === "string") {
          assistantMessage = parsed.assistantMessage;
          proposal =
            parsed.proposal && typeof parsed.proposal === "object"
              ? (parsed.proposal as Record<string, unknown>)
              : undefined;
        } else if (typeof parsed.content === "string") {
          try {
            const inner = JSON.parse(parsed.content) as Record<string, unknown>;
            assistantMessage =
              typeof inner.assistantMessage === "string"
                ? inner.assistantMessage
                : parsed.content;
            proposal =
              inner.proposal && typeof inner.proposal === "object"
                ? (inner.proposal as Record<string, unknown>)
                : undefined;
          } catch {
            assistantMessage = parsed.content;
          }
        } else {
          assistantMessage = response.content;
        }

        return json(c, { assistantMessage, proposal });
      }

      return json(c, {
        assistantMessage: response.content,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to process AI chat";
      if (message.includes("AI client") || message.includes("No AI client")) {
        return json(c, { assistantMessage: "AI service is not configured. Please set up an AI client in Settings.", error: message }, 503);
      }
      return internalServerError(c, "POST /api/ai/task-workspace/chat", cause, "Failed to process AI workspace chat");
    }
  });

  // ──────────────────────────────────────────────
  // AI Service Status
  // ──────────────────────────────────────────────

  ai.get("/ai/status", async (c) => {
    try {
      return json(c, { available: await isAIAvailable(), clients: await getAIClientInfo() });
    } catch (cause) {
      console.error("GET /api/ai/status error:", cause);
      return json(c, { available: false, clients: [], error: "Failed to check AI status" }, 500);
    }
  });

  return ai;
}
