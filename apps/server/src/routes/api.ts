import { Hono } from "hono";
import { randomUUID } from "node:crypto";

import { TaskStatus } from "../../../../src/generated/prisma/client";
import { db } from "../../../../src/lib/db";
import { createRuntimeAdapter } from "@chrona/openclaw-integration/runtime/adapter";
import type { GenerateTaskPlanResponse } from "@chrona/ai-features";
import type { StructuredSuggestion } from "../../../../src/hooks/ai/types";
import { createLogger, summarizeText } from "../../../../src/lib/logger";
import { aiAnalyzeConflicts, aiGeneratePlan, aiGeneratePlanStream, aiSuggestStream, aiSuggestTimeslots, getAIClientInfo, isAIAvailable } from "../../../../src/modules/ai/ai-service";
import type { TaskSnapshot, ScheduleHealthSnapshot } from "../../../../src/modules/ai/ai-service";
import { analyzeConflictsSmart } from "../../../../src/modules/ai/conflict-analyzer";
import { suggestAutomationSmart } from "../../../../src/modules/ai/automation-suggester";
import { suggestTimeslots } from "../../../../src/modules/ai/timeslot-suggester";
import type { ScheduleSlot, ScheduledTaskInfo, TaskAutomationInput, TaskPlanEdge, TaskPlanGraph, TaskPlanNode, TaskPlanStatus } from "../../../../src/modules/ai/types";
import { acceptTaskResult } from "../../../../src/modules/commands/accept-task-result";
import { applySchedule } from "../../../../src/modules/commands/apply-schedule";
import { clearSchedule } from "../../../../src/modules/commands/clear-schedule";
import { createFollowUpTask } from "../../../../src/modules/commands/create-follow-up-task";
import { createTask } from "../../../../src/modules/commands/create-task";
import { decideScheduleProposal } from "../../../../src/modules/commands/decide-schedule-proposal";
import { generateTaskPlanForTask } from "../../../../src/modules/commands/generate-task-plan-for-task";
import { invalidateMemory } from "../../../../src/modules/commands/invalidate-memory";
import { markTaskDone } from "../../../../src/modules/commands/mark-task-done";
import { materializeTaskPlan } from "../../../../src/modules/commands/materialize-task-plan";
import { provideInput } from "../../../../src/modules/commands/provide-input";
import { proposeSchedule } from "../../../../src/modules/commands/propose-schedule";
import { reopenTask } from "../../../../src/modules/commands/reopen-task";
import { resolveApproval } from "../../../../src/modules/commands/resolve-approval";
import { resumeRun } from "../../../../src/modules/commands/resume-run";
import { retryRun } from "../../../../src/modules/commands/retry-run";
import { sendOperatorMessage } from "../../../../src/modules/commands/send-operator-message";
import { startRun } from "../../../../src/modules/commands/start-run";
import {
  isTaskPlanGenerationRunning,
  startTaskPlanGeneration,
  stopTaskPlanGeneration,
  TaskPlanGenerationInFlightError,
  TASK_PLAN_GENERATION_IN_FLIGHT_CODE,
} from "../../../../src/modules/commands/task-plan-generation-registry";
import { updateTask } from "../../../../src/modules/commands/update-task";
import { appendCanonicalEvent } from "../../../../src/modules/events/append-canonical-event";
import { getInbox } from "../../../../src/modules/queries/get-inbox";
import { getMemoryConsole } from "../../../../src/modules/queries/get-memory-console";
import { getSchedulePage } from "../../../../src/modules/queries/get-schedule-page";
import { getTaskPage } from "../../../../src/modules/queries/get-task-page";
import { getWorkspaceOverview } from "../../../../src/modules/queries/get-workspace-overview";
import { getWorkspaces } from "../../../../src/modules/queries/get-workspaces";
import { getWorkPage, WorkPageTaskNotFoundError } from "../../../../src/modules/queries/get-work-page";
import { getAcceptedTaskPlanGraph, getLatestTaskPlanGraph, acceptTaskPlanGraph, saveTaskPlanGraph } from "../../../../src/modules/tasks/task-plan-graph-store";
import { ensureDefaultTaskSession } from "../../../../src/modules/task-execution/task-sessions";
import { getDefaultWorkspace } from "../../../../src/modules/workspaces/get-default-workspace";

import {
  error,
  HttpError,
  internalServerError,
  json,
  parseLimit,
  requireQuery,
  toHttpError,
} from "../lib/http";

const VALID_TASK_STATUSES = new Set(Object.values(TaskStatus));
const VALID_AI_FEATURES = ["suggest", "generate_plan", "conflicts", "timeslots", "chat"] as const;
const logger = createLogger("apps.server.api");

function mapSubtask(
  task: Awaited<ReturnType<typeof db.task.findMany>>[number] & {
    projection: { persistedStatus: string; scheduleStatus: string | null } | null;
  },
) {
  return {
    id: task.id,
    parentTaskId: task.parentTaskId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    persistedStatus: task.projection?.persistedStatus ?? task.status,
    scheduleStatus: task.projection?.scheduleStatus ?? task.scheduleStatus,
    dueAt: task.dueAt,
    scheduledStartAt: task.scheduledStartAt,
    scheduledEndAt: task.scheduledEndAt,
    completedAt: task.completedAt,
    isCompleted: task.status === "Done" || task.status === "Completed",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

async function testOpenClaw(config: Record<string, unknown>) {
  const bridgeUrl = typeof config.bridgeUrl === "string" ? config.bridgeUrl : "";
  if (!bridgeUrl) {
    return { available: false, reason: "Bridge URL is required" };
  }

  try {
    const res = await fetch(`${bridgeUrl}/v1/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return {
        available: false,
        reason: `Bridge health endpoint returned ${res.status}`,
      };
    }
    const body = (await res.json()) as { status?: string };
    if (body.status !== "ok") {
      return {
        available: false,
        reason: `Bridge health status was ${body.status ?? "unknown"}`,
      };
    }
    return { available: true, reason: "Bridge is reachable" };
  } catch (errorValue) {
    return {
      available: false,
      reason: errorValue instanceof Error ? errorValue.message : "Failed to reach bridge",
    };
  }
}

function testLlm(config: Record<string, unknown>) {
  if (typeof config.baseUrl !== "string" || !config.baseUrl) {
    return { available: false, reason: "Base URL is required" };
  }
  if (typeof config.apiKey !== "string" || !config.apiKey) {
    return { available: false, reason: "API key is required" };
  }
  return { available: true, reason: "LLM configuration looks valid" };
}

function buildSavedPlanSummary(savedPlan: {
  id: string;
  status: TaskPlanStatus;
  prompt: string | null;
  revision: number;
  summary: string | null;
  updatedAt: string;
}) {
  return {
    id: savedPlan.id,
    status: savedPlan.status,
    prompt: savedPlan.prompt,
    revision: savedPlan.revision,
    summary: savedPlan.summary,
    updatedAt: savedPlan.updatedAt,
  };
}

function generateSuggestionSummary(s: { title: string; priority: string; estimatedMinutes: number }) {
  const priorityMap: Record<string, string> = {
    Low: "低优先级",
    Medium: "中优先级",
    High: "高优先级",
    Urgent: "紧急",
  };
  return `创建${s.estimatedMinutes}分钟的「${s.title}」任务，${priorityMap[s.priority] ?? s.priority}`;
}

function normalizeSuggestionShape(parsed: unknown): StructuredSuggestion[] | null {
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as {
    suggestions?: Array<{
      title?: string;
      description?: string;
      priority?: string;
      estimatedMinutes?: number;
      tags?: string[];
      suggestedSlot?: { startAt: string; endAt: string };
    }>;
    result?: {
      suggestions?: Array<{
        title?: string;
        description?: string;
        priority?: string;
        estimatedMinutes?: number;
        tags?: string[];
        suggestedSlot?: { startAt: string; endAt: string };
      }>;
    };
  };

  const suggestions = envelope.suggestions ?? envelope.result?.suggestions;
  if (!Array.isArray(suggestions)) return null;

  return suggestions
    .filter((item) => item.title)
    .map((item) => ({
      id: randomUUID(),
      summary: generateSuggestionSummary({
        title: item.title!,
        priority: item.priority ?? "Medium",
        estimatedMinutes: item.estimatedMinutes ?? 30,
      }),
      action: {
        type: "create_task" as const,
        title: item.title!,
        description: item.description ?? "",
        priority: (item.priority ?? "Medium") as "Low" | "Medium" | "High" | "Urgent",
        estimatedMinutes: item.estimatedMinutes ?? 30,
        tags: item.tags ?? [],
        scheduledStartAt: item.suggestedSlot?.startAt,
        scheduledEndAt: item.suggestedSlot?.endAt,
      },
    }));
}

function tryExtractSuggestions(text: string): StructuredSuggestion[] | null {
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? text;
  try {
    return normalizeSuggestionShape(JSON.parse(jsonStr.trim()));
  } catch {
    return null;
  }
}

function planGenerationConflictBody(taskId: string) {
  return {
    error: "A task plan generation job is already running. Stop the current generation before starting a new one.",
    code: TASK_PLAN_GENERATION_IN_FLIGHT_CODE,
    taskId,
    stopEndpoint: "/api/ai/generate-task-plan/stop",
  };
}

function sseEncode(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toDateOrNull(value: unknown) {
  return typeof value === "string" && value ? new Date(value) : null;
}

async function deleteTaskWithRelations(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, workspaceId: true, title: true },
  });

  if (!task) {
    throw new HttpError(404, "Task not found");
  }

  await db.$transaction(async (tx) => {
    await tx.taskProjection.deleteMany({ where: { taskId } });
    await tx.run.deleteMany({ where: { taskId } });
    await tx.taskSession.deleteMany({ where: { taskId } });
    await tx.approval.deleteMany({ where: { taskId } });
    await tx.artifact.deleteMany({ where: { taskId } });
    await tx.memory.deleteMany({ where: { taskId } });
    await tx.event.deleteMany({ where: { taskId } });
    await tx.taskDependency.deleteMany({
      where: { OR: [{ taskId }, { dependsOnTaskId: taskId }] },
    });
    await tx.scheduleProposal.deleteMany({ where: { taskId } });

    const childTasks = await tx.task.findMany({
      where: { parentTaskId: taskId },
      select: { id: true },
    });

    for (const child of childTasks) {
      await tx.taskProjection.deleteMany({ where: { taskId: child.id } });
      await tx.run.deleteMany({ where: { taskId: child.id } });
      await tx.taskSession.deleteMany({ where: { taskId: child.id } });
      await tx.approval.deleteMany({ where: { taskId: child.id } });
      await tx.artifact.deleteMany({ where: { taskId: child.id } });
      await tx.memory.deleteMany({ where: { taskId: child.id } });
      await tx.event.deleteMany({ where: { taskId: child.id } });
      await tx.taskDependency.deleteMany({
        where: { OR: [{ taskId: child.id }, { dependsOnTaskId: child.id }] },
      });
      await tx.scheduleProposal.deleteMany({ where: { taskId: child.id } });
      await tx.task.delete({ where: { id: child.id } });
    }

    await tx.task.delete({ where: { id: taskId } });
  });

  await appendCanonicalEvent({
    eventType: "task.deleted",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: { title: task.title },
    dedupeKey: `task.deleted:${task.id}`,
  });

  return { success: true, taskId };
}

export function createApiRouter() {
  const api = new Hono();

  api.get("/health", (c) => json(c, { status: "ok" }));

  api.get("/tasks", async (c) => {
    try {
      const workspaceId = c.req.query("workspaceId");
      if (!workspaceId) {
        return error(c, "workspaceId query parameter is required", 400);
      }

      const status = c.req.query("status");
      const limit = parseLimit(c.req.query("limit"), 50, 200);

      if (status && !VALID_TASK_STATUSES.has(status as TaskStatus)) {
        return error(c, `Invalid status. Valid values: ${[...VALID_TASK_STATUSES].join(", ")}`, 400);
      }

      const tasks = await db.task.findMany({
        where: { workspaceId, ...(status ? { status: status as TaskStatus } : {}) },
        include: { projection: true },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });

      return json(c, { tasks, count: tasks.length });
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) {
        return error(c, httpError.message, httpError.status);
      }
      return internalServerError(c, "GET /api/tasks", cause, "Failed to list tasks");
    }
  });

  api.post("/tasks", async (c) => {
    try {
      const body = await c.req.json();
      const workspaceId = body.workspaceId;
      const title = body.title;

      if (!workspaceId) {
        return error(c, "workspaceId is required", 400);
      }

      if (!title || (typeof title === "string" && !title.trim())) {
        return error(c, "title is required", 400);
      }

      const result = await createTask({
        workspaceId,
        title,
        description: body.description,
        priority: body.priority,
        dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
        runtimeAdapterKey: body.runtimeAdapterKey,
        runtimeInput: body.runtimeInput,
        runtimeInputVersion: body.runtimeInputVersion,
        runtimeModel: body.runtimeModel,
        prompt: body.prompt,
        runtimeConfig: body.runtimeConfig,
      });

      return json(c, result, 201);
    } catch (cause) {
      return internalServerError(c, "POST /api/tasks", cause, "Failed to create task");
    }
  });

  api.get("/tasks/:taskId", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const task = await db.task.findUnique({
        where: { id: taskId },
        include: {
          projection: true,
          runs: { orderBy: { startedAt: "desc" }, take: 5 },
        },
      });

      if (!task) {
        return error(c, "Task not found", 404);
      }

      return json(c, { task });
    } catch (cause) {
      return internalServerError(c, "GET /api/tasks/:taskId", cause, "Failed to get task");
    }
  });

  api.get("/tasks/:taskId/detail", async (c) => {
    try {
      return json(c, await getTaskPage(c.req.param("taskId")));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to get task detail";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.patch("/tasks/:taskId", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const result = await updateTask({
        taskId,
        title: body.title,
        description: body.description,
        priority: body.priority,
        dueAt: body.dueAt !== undefined ? (body.dueAt ? new Date(body.dueAt) : null) : undefined,
        scheduledStartAt: body.scheduledStartAt !== undefined
          ? (body.scheduledStartAt ? new Date(body.scheduledStartAt) : null)
          : undefined,
        scheduledEndAt: body.scheduledEndAt !== undefined
          ? (body.scheduledEndAt ? new Date(body.scheduledEndAt) : null)
          : undefined,
        runtimeAdapterKey: body.runtimeAdapterKey,
        runtimeInput: body.runtimeInput,
        runtimeInputVersion: body.runtimeInputVersion,
        runtimeModel: body.runtimeModel,
        prompt: body.prompt,
        runtimeConfig: body.runtimeConfig,
      });

      return json(c, result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to update task";
      if (message.includes("Record to update not found") || message.includes("not found")) {
        return error(c, "Task not found", 404);
      }
      return internalServerError(c, "PATCH /api/tasks/:taskId", cause, "Failed to update task");
    }
  });

  api.delete("/tasks/:taskId", async (c) => {
    try {
      return json(c, await deleteTaskWithRelations(c.req.param("taskId")));
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) {
        return error(c, httpError.message, httpError.status);
      }
      return internalServerError(c, "DELETE /api/tasks/:taskId", cause, "Failed to delete task");
    }
  });

  api.get("/schedule/projection", async (c) => {
    try {
      return json(c, await getSchedulePage(requireQuery(c, "workspaceId")));
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) {
        return error(c, httpError.message, httpError.status);
      }
      return internalServerError(c, "GET /api/schedule/projection", cause, "Failed to get schedule projection");
    }
  });

  api.get("/inbox/projection", async (c) => {
    try {
      return json(c, await getInbox(requireQuery(c, "workspaceId")));
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) {
        return error(c, httpError.message, httpError.status);
      }
      return internalServerError(c, "GET /api/inbox/projection", cause, "Failed to get inbox projection");
    }
  });

  api.get("/memory/projection", async (c) => {
    try {
      return json(c, await getMemoryConsole(requireQuery(c, "workspaceId")));
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) {
        return error(c, httpError.message, httpError.status);
      }
      return internalServerError(c, "GET /api/memory/projection", cause, "Failed to get memory projection");
    }
  });

  api.get("/work/:taskId/projection", async (c) => {
    try {
      return json(c, await getWorkPage(c.req.param("taskId")));
    } catch (cause) {
      if (cause instanceof WorkPageTaskNotFoundError) {
        return error(c, "Task not found", 404);
      }
      return internalServerError(c, "GET /api/work/:taskId/projection", cause, "Failed to get work projection");
    }
  });

  api.get("/workspaces/default", async (c) => {
    try {
      return json(c, await getDefaultWorkspace());
    } catch (cause) {
      return internalServerError(c, "GET /api/workspaces/default", cause, "Failed to get default workspace");
    }
  });

  api.get("/workspaces", async (c) => {
    try {
      return json(c, await getWorkspaces());
    } catch (cause) {
      return internalServerError(c, "GET /api/workspaces", cause, "Failed to get workspaces");
    }
  });

  api.get("/workspaces/:workspaceId/overview", async (c) => {
    try {
      return json(c, await getWorkspaceOverview(c.req.param("workspaceId")));
    } catch (cause) {
      return internalServerError(c, "GET /api/workspaces/:workspaceId/overview", cause, "Failed to get workspace overview");
    }
  });

  api.post("/tasks/:taskId/run", async (c) => {
    try {
      const adapter = await createRuntimeAdapter();
      const body = await c.req.json().catch(() => ({}));
      return json(
        c,
        await startRun({ taskId: c.req.param("taskId"), prompt: body.prompt, adapter }),
        201,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to start run";
      if (message.includes("not found") || message.includes("No 'Task' record")) {
        return error(c, "Task not found", 404);
      }
      return error(c, message, 500);
    }
  });

  api.post("/tasks/:taskId/retry", async (c) => {
    try {
      const adapter = await createRuntimeAdapter();
      const body = await c.req.json().catch(() => ({}));
      return json(c, await retryRun({ taskId: c.req.param("taskId"), prompt: body.prompt, adapter }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to retry run";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/input", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      if (!body.inputText || (typeof body.inputText === "string" && !body.inputText.trim())) {
        return error(c, "inputText is required", 400);
      }
      let runId = body.runId as string | undefined;
      if (!runId) {
        const latestRun = await db.run.findFirst({
          where: { taskId, status: "WaitingForInput" },
          orderBy: { startedAt: "desc" },
          select: { id: true },
        });
        if (!latestRun) {
          return error(c, "No run waiting for input found for this task.", 400);
        }
        runId = latestRun.id;
      }
      const adapter = await createRuntimeAdapter();
      return json(c, await provideInput({ runId, inputText: body.inputText, adapter }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to provide input";
      return error(c, message, message.includes("not found") || message.includes("no longer exists") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/message", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      if (!body.message || (typeof body.message === "string" && !body.message.trim())) {
        return error(c, "message is required", 400);
      }
      let runId = body.runId as string | undefined;
      if (!runId) {
        const latestRun = await db.run.findFirst({
          where: { taskId, status: { in: ["Running", "WaitingForApproval"] } },
          orderBy: { startedAt: "desc" },
          select: { id: true },
        });
        if (!latestRun) {
          return error(c, "No active run found for this task. The agent must be running to receive messages.", 400);
        }
        runId = latestRun.id;
      }
      const adapter = await createRuntimeAdapter();
      return json(c, await sendOperatorMessage({ runId, message: body.message, adapter }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to send message";
      return error(c, message, message.includes("not found") || message.includes("no longer exists") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/resume", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.runId) {
        return error(c, "runId is required", 400);
      }
      const adapter = await createRuntimeAdapter();
      return json(
        c,
        await resumeRun({
          runId: body.runId,
          inputText: body.inputText,
          approvalId: body.approvalId,
          adapter,
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to resume run";
      return error(c, message, message.includes("not found") || message.includes("no longer exists") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/done", async (c) => {
    try {
      return json(c, await markTaskDone({ taskId: c.req.param("taskId") }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to mark task done";
      return error(c, message, message.includes("not found") || message.includes("No 'Task' record") ? 404 : 400);
    }
  });

  api.post("/tasks/:taskId/reopen", async (c) => {
    try {
      return json(c, await reopenTask({ taskId: c.req.param("taskId") }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to reopen task";
      return error(c, message, message.includes("not found") || message.includes("No 'Task' record") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/result/accept", async (c) => {
    try {
      return json(c, await acceptTaskResult({ taskId: c.req.param("taskId") }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to accept task result";
      return error(c, message, message.includes("not found") ? 404 : 400);
    }
  });

  api.post("/tasks/:taskId/follow-up", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.title || (typeof body.title === "string" && !body.title.trim())) {
        return error(c, "title is required", 400);
      }
      return json(
        c,
        await createFollowUpTask({
          taskId: c.req.param("taskId"),
          title: body.title,
          dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
          priority: body.priority,
        }),
        201,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to create follow-up task";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.get("/tasks/:taskId/plan-state", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const savedAiPlan = (await getAcceptedTaskPlanGraph(taskId)) ?? (await getLatestTaskPlanGraph(taskId));
      const aiPlanGenerationStatus = isTaskPlanGenerationRunning(taskId)
        ? "generating"
        : savedAiPlan?.status === "accepted"
          ? "accepted"
          : savedAiPlan
            ? "waiting_acceptance"
            : "idle";
      return json(c, {
        taskId,
        aiPlanGenerationStatus,
        savedAiPlan: savedAiPlan
          ? {
              id: savedAiPlan.id,
              status: savedAiPlan.status,
              prompt: savedAiPlan.prompt,
              revision: savedAiPlan.revision,
              summary: savedAiPlan.summary,
              updatedAt: savedAiPlan.updatedAt,
              plan: savedAiPlan.plan,
            }
          : null,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to get task plan state";
      return error(c, message, 500);
    }
  });

  api.get("/tasks/:taskId/subtasks", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const parentTask = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true },
      });

      if (!parentTask) {
        return error(c, "Task not found", 404);
      }

      const subtasks = await db.task.findMany({
        where: { parentTaskId: taskId },
        include: { projection: true },
        orderBy: { createdAt: "asc" },
      });

      const normalizedSubtasks = subtasks.map(mapSubtask);
      return json(c, { subtasks: normalizedSubtasks, count: normalizedSubtasks.length });
    } catch (cause) {
      return internalServerError(c, "GET /api/tasks/:taskId/subtasks", cause, "Failed to list subtasks");
    }
  });

  api.post("/tasks/:taskId/subtasks", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const parentTask = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true, workspaceId: true },
      });

      if (!parentTask) {
        return error(c, "Parent task not found", 404);
      }

      if (!body.title || (typeof body.title === "string" && !body.title.trim())) {
        return error(c, "title is required", 400);
      }

      const result = await createTask({
        workspaceId: parentTask.workspaceId,
        title: body.title,
        description: body.description,
        priority: body.priority,
        parentTaskId: taskId,
        dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
      });

      const subtask = await db.task.findUnique({
        where: { id: result.taskId },
        include: { projection: true },
      });

      return json(c, { subtask: subtask ? mapSubtask(subtask) : null }, 201);
    } catch (cause) {
      return internalServerError(c, "POST /api/tasks/:taskId/subtasks", cause, "Failed to create subtask");
    }
  });

  api.post("/tasks/:taskId/schedule", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();

      if (!body.scheduledStartAt || !body.scheduledEndAt) {
        return error(c, "scheduledStartAt and scheduledEndAt are required", 400);
      }

      return json(
        c,
        await applySchedule({
          taskId,
          scheduledStartAt: new Date(body.scheduledStartAt),
          scheduledEndAt: new Date(body.scheduledEndAt),
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          scheduleSource: body.scheduleSource ?? "system",
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to apply schedule";
      return error(c, message, message.includes("not found") || message.includes("No 'Task' record") ? 404 : 500);
    }
  });

  api.delete("/tasks/:taskId/schedule", async (c) => {
    try {
      return json(c, await clearSchedule({ taskId: c.req.param("taskId") }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to clear schedule";
      return error(c, message, message.includes("not found") || message.includes("No 'Task' record") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/schedule/proposals", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      return json(
        c,
        await proposeSchedule({
          taskId,
          source: body.source,
          proposedBy: body.proposedBy,
          summary: body.summary,
          dueAt: toDateOrNull(body.dueAt),
          scheduledStartAt: toDateOrNull(body.scheduledStartAt),
          scheduledEndAt: toDateOrNull(body.scheduledEndAt),
          assigneeAgentId: typeof body.assigneeAgentId === "string" ? body.assigneeAgentId : null,
        }),
        201,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to create schedule proposal";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/schedule/proposals/decision", async (c) => {
    try {
      const body = await c.req.json();
      const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
      const decision = body.decision;

      if (!proposalId) {
        return error(c, "proposalId is required", 400);
      }

      if (decision !== "Accepted" && decision !== "Rejected") {
        return error(c, 'decision must be "Accepted" or "Rejected"', 400);
      }

      return json(
        c,
        await decideScheduleProposal({
          proposalId,
          decision,
          resolutionNote: typeof body.resolutionNote === "string" ? body.resolutionNote : undefined,
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to resolve schedule proposal";
      return error(c, message, message.includes("not found") || message.includes("No 'ScheduleProposal' record") ? 404 : 400);
    }
  });

  api.post("/approvals/:approvalId/resolve", async (c) => {
    try {
      const approvalId = c.req.param("approvalId");
      const body = await c.req.json();
      return json(
        c,
        await resolveApproval({
          approvalId,
          decision: body.decision,
          resolutionNote: body.resolutionNote,
          editedContent: body.editedContent,
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to resolve approval";
      return error(c, message, message.includes("no longer exists") || message.includes("not found") ? 404 : 400);
    }
  });

  api.post("/tasks/:taskId/approvals/:approvalId/resolve", async (c) => {
    try {
      const approvalId = c.req.param("approvalId");
      const body = await c.req.json();
      return json(
        c,
        await resolveApproval({
          approvalId,
          decision: body.decision,
          resolutionNote: body.resolutionNote,
          editedContent: body.editedContent,
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to resolve approval";
      return error(c, message, message.includes("no longer exists") || message.includes("not found") ? 404 : 400);
    }
  });

  api.post("/memories/:memoryId/invalidate", async (c) => {
    try {
      return json(c, await invalidateMemory({ memoryId: c.req.param("memoryId") }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to invalidate memory";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/ai/task-plan/accept", async (c) => {
    try {
      const body = await c.req.json();
      const taskId = typeof body.taskId === "string" ? body.taskId : "";
      const planId = typeof body.planId === "string" ? body.planId : "";

      if (!taskId || !planId) {
        return error(c, "taskId and planId are required", 400);
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
      return error(c, message, 500);
    }
  });

  api.get("/ai/clients", async (c) => {
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

  api.post("/ai/clients", async (c) => {
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

  api.post("/ai/clients/test", async (c) => {
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

  api.get("/ai/clients/:clientId", async (c) => {
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

  api.patch("/ai/clients/:clientId", async (c) => {
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

  api.delete("/ai/clients/:clientId", async (c) => {
    try {
      await db.aiClient.delete({ where: { id: c.req.param("clientId") } });
      return json(c, { success: true });
    } catch {
      return error(c, "Client not found", 404);
    }
  });

  api.get("/ai/clients/:clientId/bindings", async (c) => {
    try {
      const bindings = await db.aiFeatureBinding.findMany({ where: { clientId: c.req.param("clientId") } });
      return json(c, { features: bindings.map((binding) => binding.feature) });
    } catch (cause) {
      return internalServerError(c, "GET /api/ai/clients/:clientId/bindings", cause, "Failed to get feature bindings");
    }
  });

  api.put("/ai/clients/:clientId/bindings", async (c) => {
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
        priority: _priority,
        dueAt: _dueAt,
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
        title: summarizeText(title ?? null),
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
                  const draftPlan: TaskPlanGraph = {
                    id: `graph-${taskId || "adhoc"}-${Date.now()}`,
                    taskId: taskId ?? "",
                    status: "draft",
                    revision: 1,
                    source: "ai",
                    generatedBy: event.plan.source ?? "ai",
                    prompt: planningPrompt ?? null,
                    summary: event.plan.summary,
                    changeSummary: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    nodes: event.plan.nodes,
                    edges: event.plan.edges,
                  };

                  if (taskId && resolvedWorkspaceId) {
                    const savedPlan = await saveTaskPlanGraph({
                      workspaceId: resolvedWorkspaceId,
                      taskId,
                      plan: draftPlan,
                      prompt: planningPrompt ?? null,
                      status: "draft",
                      source: "ai",
                      generatedBy: event.plan.source ?? "ai",
                      summary: event.plan.summary,
                    });
                    finalResponse = {
                      source: event.plan.source,
                      planGraph: savedPlan.plan,
                      taskSessionKey: sharedTaskSessionKey,
                      savedPlan: buildSavedPlanSummary(savedPlan),
                      reasoning: event.plan.reasoning,
                    };
                  } else {
                    finalResponse = {
                      source: event.plan.source,
                      planGraph: draftPlan,
                      taskSessionKey: sharedTaskSessionKey,
                      reasoning: event.plan.reasoning,
                    };
                  }
                  if (!safeEnqueue("result", finalResponse)) break;
                } else if (event.type === "error") {
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
              }
              try {
                controller.close();
              } catch {
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
        title: summarizeText(generatedContext.title),
        hasPlan: Boolean(planResult),
      });

      if (!planResult) {
        return error(c, "AI planning unavailable", 503);
      }

      const plan: TaskPlanGraph = {
        id: `graph-${taskId || "adhoc"}-${Date.now()}`,
        taskId: taskId ?? "",
        status: "draft",
        revision: 1,
        source: "ai",
        generatedBy: planResult.source ?? "ai",
        prompt: planningPrompt ?? null,
        summary: planResult.summary,
        changeSummary: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: planResult.nodes,
        edges: planResult.edges,
      };

      if (taskId && resolvedWorkspaceId) {
        const savedPlan = await saveTaskPlanGraph({
          workspaceId: resolvedWorkspaceId,
          taskId,
          plan,
          prompt: planningPrompt ?? null,
          status: "draft",
          source: "ai",
          generatedBy: planResult.source ?? "ai",
          summary: planResult.summary,
        });

        return json(c, {
          source: planResult.source,
          planGraph: savedPlan.plan,
          taskSessionKey: sharedTaskSessionKey,
          savedPlan: buildSavedPlanSummary(savedPlan),
          reasoning: planResult.reasoning,
        });
      }

      return json(c, {
        source: planResult.source,
        planGraph: plan,
        taskSessionKey: sharedTaskSessionKey,
        reasoning: planResult.reasoning,
      });
    } catch (cause) {
      if (cause instanceof TaskPlanGenerationInFlightError) {
        return json(c, planGenerationConflictBody(parsedTaskIdForConflict ?? "unknown"), 409);
      }
      const message = cause instanceof Error ? cause.message : "Failed to generate task plan";
      return error(c, message, message.includes("Task not found") ? 404 : 500);
    }
  });

  api.post("/ai/suggest-timeslot", async (c) => {
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

      let targetDate = date ? new Date(date) : new Date();
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

  api.post("/ai/suggest-automation", async (c) => {
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

  api.post("/ai/analyze-conflicts", async (c) => {
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

  api.post("/ai/dispatch-task", async (c) => {
    try {
      const body = await c.req.json();
      const taskId = typeof body.taskId === "string" ? body.taskId : "";
      const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";

      if (!taskId || !workspaceId) {
        return error(c, "taskId and workspaceId are required", 400);
      }

      const { dispatchNextTaskAction } = await import("../../../../src/modules/commands/dispatch-next-task-action");
      return json(c, await dispatchNextTaskAction({
        taskId,
        workspaceId,
        mode: "preview",
      }));
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/dispatch-task", cause, "Failed to dispatch task");
    }
  });

  api.post("/ai/auto-complete", async (c) => {
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

  api.post("/ai/batch-apply-plan", async (c) => {
    try {
      const body = await c.req.json();
      const { taskId, nodes: providedNodes, edges: providedEdges } = body as {
        taskId?: string;
        nodes?: TaskPlanNode[];
        edges?: TaskPlanEdge[];
      };

      if (!taskId) {
        return error(c, "taskId is required", 400);
      }

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) {
        return error(c, "Task not found", 404);
      }

      let graphPlan = null;
      if (providedNodes && Array.isArray(providedNodes) && providedNodes.length > 0) {
        const now = new Date().toISOString();
        const plan: TaskPlanGraph = {
          id: `graph-${taskId}-${Date.now()}`,
          taskId,
          status: "draft",
          revision: 1,
          source: "ai",
          generatedBy: "batch-apply",
          prompt: null,
          summary: `${providedNodes.length} planned step${providedNodes.length === 1 ? "" : "s"}`,
          changeSummary: null,
          createdAt: now,
          updatedAt: now,
          nodes: providedNodes,
          edges: providedEdges ?? [],
        };
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

      return json(c, {
        parentTaskId: taskId,
        childTasks: createdTasks,
        planGraph: graphPlan.plan,
      }, 201);
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/batch-apply-plan", cause, "Failed to apply task plan");
    }
  });

  api.post("/ai/apply-suggestion", async (c) => {
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

  api.get("/ai/status", async (c) => {
    try {
      return json(c, { available: await isAIAvailable(), clients: await getAIClientInfo() });
    } catch (cause) {
      console.error("GET /api/ai/status error:", cause);
      return json(c, { available: false, clients: [], error: "Failed to check AI status" }, 500);
    }
  });

  return api;
}
