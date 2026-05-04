import { Hono } from "hono";
import { randomUUID } from "node:crypto";

import { db } from "@chrona/db";
import { summarizeText } from "@chrona/db/logger";
import type { TaskSnapshot, ScheduleHealthSnapshot } from "@chrona/engine";
import type { ScheduleSlot, ScheduledTaskInfo, TaskAutomationInput } from "@chrona/contracts/ai";
import {
  aiAnalyzeConflicts,
  aiChat,
  aiSuggestStream,
  aiSuggestTimeslots,
  analyzeConflictsSmart,
  buildTaskWorkspaceSystemPrompt,
  ensureDefaultTaskSession,
  getAIClientInfo,
  isAIAvailable,
  suggestAutomationSmart,
  suggestTimeslots,
} from "@chrona/engine";

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
} from "../lib/http";
import {
  createAiClientSchema,
  taskWorkspaceChatSchema,
  applySuggestionChangesSchema,
  applySuggestionSingleSchema,
} from "./schemas";

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

      const parsed = createAiClientSchema.safeParse(body);
      if (!parsed.success) {
        return error(c, parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), 400);
      }

      const { name, type, config, isDefault } = parsed.data;

      if (isDefault) {
        await db.aiClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }

      const client = await db.aiClient.create({
        data: {
          id: randomUUID().replace(/-/g, "").slice(0, 25),
          name,
          type,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          config: (config ?? {}) as any,
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

      const validFeatures = [...new Set(features.filter((feature: string) => (VALID_AI_FEATURES as readonly string[]).includes(feature)))];

      // Feature bindings are globally unique: each feature can only be bound to one client at a time.
      // We must atomically remove existing bindings for the selected features (from any client)
      // and remove any stale bindings for this client, then create new bindings.
      await db.$transaction(async (tx) => {
        if (validFeatures.length > 0) {
          await tx.aiFeatureBinding.deleteMany({ where: { feature: { in: validFeatures } } });
        }

        await tx.aiFeatureBinding.deleteMany({
          where: {
            clientId,
            feature: { notIn: validFeatures },
          },
        });

        for (const feature of validFeatures) {
          await tx.aiFeatureBinding.create({
            data: {
              id: randomUUID().replace(/-/g, "").slice(0, 25),
              feature,
              clientId,
            },
          });
        }
      });

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

      const input: TaskAutomationInput = {
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

      const { dispatchNextTaskAction } = await import("@chrona/engine");
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

      // Try changes-array format first
      const changesResult = applySuggestionChangesSchema.safeParse(body);
      if (changesResult.success) {
        const { workspaceId, suggestionId, changes } = changesResult.data;

        const taskIds = changes.map((change) => change.taskId);
        const tasks = await db.task.findMany({
          where: { id: { in: taskIds }, workspaceId },
        });

        if (tasks.length !== taskIds.length) {
          return error(c, "Some tasks do not belong to this workspace", 403);
        }

        await db.$transaction(async (tx) => {
          await Promise.all(changes.map((change) => tx.taskProjection.update({
            where: { taskId: change.taskId },
            data: {
              ...(change.scheduledStartAt && { scheduledStartAt: new Date(change.scheduledStartAt) }),
              ...(change.scheduledEndAt && { scheduledEndAt: new Date(change.scheduledEndAt) }),
              updatedAt: new Date(),
            },
          })));
        });

        return json(c, { success: true, appliedChanges: changes.length, suggestionId });
      }

      // Try single-suggestion format
      const singleResult = applySuggestionSingleSchema.safeParse(body);
      if (!singleResult.success) {
        return error(c, singleResult.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), 400);
      }

      const { workspaceId, suggestion } = singleResult.data;
      const taskId = randomUUID();
      const now = new Date();
      await db.$transaction(async (tx) => {
        await tx.task.create({
          data: {
            id: taskId,
            workspaceId,
            title: suggestion.action.title,
            description: suggestion.action.description || null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            priority: (suggestion.action.priority ?? "Medium") as any,
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
        await tx.taskProjection.upsert({
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

      const parsed = taskWorkspaceChatSchema.safeParse(body);
      if (!parsed.success) {
        return error(c, parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), 400);
      }

      const { taskId: _taskId, message, currentTask, currentPlan, history: rawHistory } = parsed.data;
      const history = rawHistory ?? [];

      const taskSnapshotText = currentTask
        ? JSON.stringify(currentTask, null, 2)
        : "No task data provided.";

      const planSnapshotText = currentPlan
        ? (() => {
            const plan = currentPlan as Record<string, unknown>;
            return JSON.stringify(
            {
              id: plan.id,
              status: plan.status,
              revision: plan.revision,
              summary: plan.summary,
              nodeCount: (plan.nodes as unknown[])?.length ?? 0,
              nodes: ((plan.nodes as unknown[]) ?? []).map((n) => {
                const node = n as Record<string, unknown>;
                return {
                id: node.id,
                title: node.title,
                status: node.status,
                objective: node.objective,
                estimatedMinutes: node.estimatedMinutes,
                priority: node.priority,
                executionMode: node.executionMode,
                dependsOn: node.dependsOn,
              }}),
              edges: ((plan.edges as unknown[]) ?? []).map((e) => {
                const edge = e as Record<string, unknown>;
                return {
                fromNodeId: edge.fromNodeId,
                toNodeId: edge.toNodeId,
                type: edge.type,
              }}),
            },
            null,
            2,
          )})()
        : "No plan data provided.";

      const systemPrompt = buildTaskWorkspaceSystemPrompt(taskSnapshotText, planSnapshotText);

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
