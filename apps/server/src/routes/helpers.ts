import { randomUUID } from "node:crypto";

import { TaskStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import { createRuntimeAdapter } from "@chrona/openclaw-integration/runtime/adapter";
import type { StructuredSuggestion } from "@chrona/contracts";
import { createLogger, summarizeText } from "@chrona/db/logger";
import type { TaskPlanStatus } from "@chrona/runtime/modules/ai/types";
import { appendCanonicalEvent } from "@chrona/runtime/modules/events/append-canonical-event";
import { TASK_PLAN_GENERATION_IN_FLIGHT_CODE } from "@chrona/runtime/modules/commands/task-plan-generation-registry";
import { OpenClawClient } from "@chrona/providers-core";

import { HttpError } from "../lib/http";

export const VALID_TASK_STATUSES = new Set(Object.values(TaskStatus));
export const VALID_AI_FEATURES = ["suggest", "generate_plan", "conflicts", "timeslots", "chat"] as const;
export const logger = createLogger("apps.server.api");

export function mapSubtask(
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

export async function getOpenClawAdapter() {
  const client = await db.aiClient.findFirst({
    where: { type: "openclaw", isDefault: true, enabled: true },
  });
  const config = (client?.config as Record<string, unknown> | null) ?? {};
  const bridgeUrl = typeof config.bridgeUrl === "string" ? config.bridgeUrl : "";
  const bridgeToken = typeof config.bridgeToken === "string" ? config.bridgeToken : "";
  return createRuntimeAdapter(
    bridgeUrl ? { bridgeUrl, bridgeToken } : undefined,
  );
}

export async function testOpenClaw(config: Record<string, unknown>) {
  const gatewayUrl = typeof config.gatewayUrl === "string" ? config.gatewayUrl : typeof config.bridgeUrl === "string" ? config.bridgeUrl : "";
  const gatewayToken = typeof config.gatewayToken === "string" ? config.gatewayToken : "";
  if (!gatewayUrl) {
    return { available: false, reason: "Gateway URL is required" };
  }

  try {
    const client = new OpenClawClient({ gatewayUrl, gatewayToken: gatewayToken || undefined });
    const healthy = await client.checkHealth();
    return healthy
      ? { available: true, reason: "Gateway is reachable" }
      : { available: false, reason: "Gateway health check failed" };
  } catch (errorValue) {
    return {
      available: false,
      reason: errorValue instanceof Error ? errorValue.message : "Failed to reach gateway",
    };
  }
}

export function testLlm(config: Record<string, unknown>) {
  if (typeof config.baseUrl !== "string" || !config.baseUrl) {
    return { available: false, reason: "Base URL is required" };
  }
  if (typeof config.apiKey !== "string" || !config.apiKey) {
    return { available: false, reason: "API key is required" };
  }
  return { available: true, reason: "LLM configuration looks valid" };
}

export function buildSavedPlanSummary(savedPlan: {
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

export function summarizeStructuredPlanDebug(structured: unknown) {
  if (!structured || typeof structured !== "object") return null;
  const record = structured as {
    error?: unknown;
    source?: unknown;
    toolName?: unknown;
    rawOutput?: unknown;
    bridgeToolCalls?: Array<{ tool?: unknown; status?: unknown }>;
    validationIssues?: unknown;
  };

  return {
    error: typeof record.error === "string" ? record.error : null,
    source: typeof record.source === "string" ? record.source : null,
    toolName: typeof record.toolName === "string" ? record.toolName : null,
    rawOutputPreview:
      typeof record.rawOutput === "string"
        ? summarizeText(record.rawOutput, 240)
        : null,
    bridgeToolCalls: Array.isArray(record.bridgeToolCalls)
      ? record.bridgeToolCalls.map((toolCall) => ({
          tool: typeof toolCall.tool === "string" ? toolCall.tool : null,
          status: typeof toolCall.status === "string" ? toolCall.status : null,
        }))
      : [],
    validationIssues: Array.isArray(record.validationIssues)
      ? record.validationIssues
      : [],
  };
}

export function generateSuggestionSummary(s: { title: string; priority: string; estimatedMinutes: number }) {
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

export function tryExtractSuggestions(text: string): StructuredSuggestion[] | null {
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? text;
  try {
    return normalizeSuggestionShape(JSON.parse(jsonStr.trim()));
  } catch {
    return null;
  }
}

export function planGenerationConflictBody(taskId: string) {
  return {
    error: "A task plan generation job is already running. Stop the current generation before starting a new one.",
    code: TASK_PLAN_GENERATION_IN_FLIGHT_CODE,
    taskId,
    stopEndpoint: "/api/ai/generate-task-plan/stop",
  };
}

export function sseEncode(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function toDateOrNull(value: unknown) {
  return typeof value === "string" && value ? new Date(value) : null;
}

function isInvalidDate(value: Date | null | undefined) {
  return value instanceof Date && Number.isNaN(value.getTime());
}

export function ensureValidDateFields(fields: Record<string, Date | null | undefined>) {
  for (const [field, value] of Object.entries(fields)) {
    if (isInvalidDate(value)) {
      throw new HttpError(400, `${field} must be a valid date string`);
    }
  }
}

export async function ensureTaskInWorkspace(taskId: string, workspaceId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, workspaceId: true },
  });

  if (!task) {
    throw new HttpError(404, "Task not found");
  }

  if (task.workspaceId !== workspaceId) {
    throw new HttpError(404, "Task not found");
  }

  return task;
}

export async function ensureProposalInWorkspace(proposalId: string, workspaceId: string) {
  const proposal = await db.scheduleProposal.findUnique({
    where: { id: proposalId },
    select: { id: true, workspaceId: true },
  });

  if (!proposal) {
    throw new HttpError(404, "Schedule proposal not found");
  }

  if (proposal.workspaceId !== workspaceId) {
    throw new HttpError(404, "Schedule proposal not found");
  }

  return proposal;
}

export async function ensurePlanInWorkspace(planId: string, taskId: string, workspaceId: string) {
  const plan = await db.memory.findUnique({
    where: { id: planId },
    select: { id: true, taskId: true, workspaceId: true },
  });

  if (!plan || plan.taskId !== taskId) {
    throw new HttpError(404, "Task plan graph not found");
  }

  if (plan.workspaceId !== workspaceId) {
    throw new HttpError(404, "Task plan graph not found");
  }

  return plan;
}

export async function deleteTaskWithRelations(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, workspaceId: true, title: true },
  });

  if (!task) {
    throw new HttpError(404, "Task not found");
  }

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

  return { success: true, taskId };
}
