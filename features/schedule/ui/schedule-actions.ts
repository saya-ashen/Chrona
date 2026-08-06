import type { AutomationTimingPreset } from "@chrona/contracts";
import { apiJson } from "@shared/http";

export type CreateTaskFromScheduleInput = {
  workspaceId: string;
  title: string;
  description?: string | null;
  priority?: string;
  autoPlanGeneration?: boolean;
  autoExecute?: boolean;
  autoPlanGenerationTiming?: AutomationTimingPreset;
  autoExecuteTiming?: AutomationTimingPreset;
  executionRuntime?: string;
  executionConfig?: Record<string, unknown>;
  aiClientId?: string | null;
  parentTaskId?: string | null;
  recurrenceRule?: string | null;
  recurrenceAnchorStartAt?: string | null;
  recurrenceAnchorEndAt?: string | null;
};

type CreatedTask = { taskId: string };

export function createTaskFromSchedule(input: CreateTaskFromScheduleInput) {
  return apiJson<CreatedTask>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description ?? undefined,
      priority: input.priority as
        | "Low"
        | "Medium"
        | "High"
        | "Urgent"
        | undefined,
      autoPlanGeneration: input.autoPlanGeneration,
      autoExecute: input.autoExecute,
      autoPlanGenerationTiming: input.autoPlanGenerationTiming,
      autoExecuteTiming: input.autoExecuteTiming,
      executionRuntime: input.executionRuntime,
      executionConfig: input.executionConfig,
      aiClientId: input.aiClientId ?? null,
      parentTaskId: input.parentTaskId,
      recurrenceRule: input.recurrenceRule ?? undefined,
      recurrenceAnchorStartAt: input.recurrenceAnchorStartAt ?? undefined,
      recurrenceAnchorEndAt: input.recurrenceAnchorEndAt ?? undefined,
    }),
  });
}

export async function createScheduledTask(
  input: CreateTaskFromScheduleInput & {
    dueAt: Date | null;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
  },
) {
  const created = await createTaskFromSchedule(input);
  await applySchedule({
    taskId: created.taskId,
    dueAt: input.dueAt,
    scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt: input.scheduledEndAt,
    scheduleSource: "human",
  });
  return created;
}

export function updateTaskConfigFromSchedule(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: string;
  executionRuntime?: string;
  executionConfig?: Record<string, unknown>;
  aiClientId?: string | null;
  autoPlanGeneration?: boolean;
  autoExecute?: boolean;
  autoPlanGenerationTiming?: AutomationTimingPreset;
  autoExecuteTiming?: AutomationTimingPreset;
  recurrenceRule?: string | null;
  recurrenceAnchorStartAt?: string | null;
  recurrenceAnchorEndAt?: string | null;
}) {
  return apiJson(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: input.title,
      description: input.description ?? undefined,
      priority: input.priority as
        | "Low"
        | "Medium"
        | "High"
        | "Urgent"
        | undefined,
      aiClientId: input.aiClientId ?? null,
      executionRuntime: input.executionRuntime,
      executionConfig: input.executionConfig,
      autoPlanGeneration: input.autoPlanGeneration,
      autoExecute: input.autoExecute,
      autoPlanGenerationTiming: input.autoPlanGenerationTiming,
      autoExecuteTiming: input.autoExecuteTiming,
      recurrenceRule: input.recurrenceRule ?? undefined,
      recurrenceAnchorStartAt: input.recurrenceAnchorStartAt ?? undefined,
      recurrenceAnchorEndAt: input.recurrenceAnchorEndAt ?? undefined,
    }),
  });
}


export function applySchedule(input: {
  taskId: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  dueAt?: Date | null;
  scheduleSource?: "human" | "ai" | "system";
}) {
  return apiJson(`/api/tasks/${encodeURIComponent(input.taskId)}/schedule`, {
    method: "PUT",
    body: JSON.stringify({
      scheduledStartAt: input.scheduledStartAt.toISOString(),
      scheduledEndAt: input.scheduledEndAt.toISOString(),
      dueAt: input.dueAt?.toISOString() ?? null,
      scheduleSource: input.scheduleSource ?? "system",
    }),
  });
}

export function clearSchedule(input: { taskId: string }) {
  return apiJson(`/api/tasks/${encodeURIComponent(input.taskId)}/schedule`, {
    method: "DELETE",
  });
}

export function moveWorkBlock(input: {
  workBlockId: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
}) {
  return apiJson(
    `/api/tasks/work-blocks/${encodeURIComponent(input.workBlockId)}/schedule`,
    {
      method: "PUT",
      body: JSON.stringify({
        scheduledStartAt: input.scheduledStartAt.toISOString(),
        scheduledEndAt: input.scheduledEndAt.toISOString(),
      }),
    },
  );
}

export function decideScheduleProposal(input: {
  proposalId: string;
  decision: "Accepted" | "Rejected";
  resolutionNote?: string | null;
}) {
  return apiJson("/api/tasks/schedule-proposals/decision", {
    method: "POST",
    body: JSON.stringify({
      proposalId: input.proposalId,
      decision: input.decision,
      resolutionNote: input.resolutionNote ?? undefined,
    }),
  });
}
