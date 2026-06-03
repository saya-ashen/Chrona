import { api } from "./rpc-client";
import { buildAccessKeyHeaders, handleUnauthorizedResponse } from "./access-key";
import type { ExecutionActionInput } from "@chrona/contracts/ai";
import type { AutomationTimingPreset } from "@chrona/contracts";

async function parseActionResponse(response: {
  ok: boolean;
  json: () => Promise<unknown>;
}) {
  const body = await response.json();
  if (!response.ok && body && typeof body === "object" && "error" in body) {
    throw new Error(String((body as { error: unknown }).error));
  }

  return body;
}

// ═══════════════════════════════════════════════════════════════
// Task CRUD
// ═══════════════════════════════════════════════════════════════

export function createTaskFromSchedule(input: {
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
  parentTaskId?: string | null;
  recurrenceRule?: string | null;
  recurrenceAnchorStartAt?: string | null;
  recurrenceAnchorEndAt?: string | null;
}) {
  return api.tasks
    .$post({
      json: {
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
        parentTaskId: input.parentTaskId,
        recurrenceRule: input.recurrenceRule ?? undefined,
        recurrenceAnchorStartAt: input.recurrenceAnchorStartAt ?? undefined,
        recurrenceAnchorEndAt: input.recurrenceAnchorEndAt ?? undefined,
      },
    })
    .then(parseActionResponse);
}

export function updateTaskConfigFromSchedule(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: string;
  executionRuntime?: string;
  executionConfig?: Record<string, unknown>;
  autoPlanGeneration?: boolean;
  autoExecute?: boolean;
  autoPlanGenerationTiming?: AutomationTimingPreset;
  autoExecuteTiming?: AutomationTimingPreset;
  recurrenceRule?: string | null;
  recurrenceAnchorStartAt?: string | null;
  recurrenceAnchorEndAt?: string | null;
}) {
  return api.tasks[":taskId"]
    .$patch({
      param: { taskId: input.taskId },
      json: {
        title: input.title,
        description: input.description ?? undefined,
        priority: input.priority as
          | "Low"
          | "Medium"
          | "High"
          | "Urgent"
          | undefined,
        executionRuntime: input.executionRuntime,
        executionConfig: input.executionConfig,
        autoPlanGeneration: input.autoPlanGeneration,
        autoExecute: input.autoExecute,
        autoPlanGenerationTiming: input.autoPlanGenerationTiming,
        autoExecuteTiming: input.autoExecuteTiming,
        recurrenceRule: input.recurrenceRule ?? undefined,
        recurrenceAnchorStartAt: input.recurrenceAnchorStartAt ?? undefined,
        recurrenceAnchorEndAt: input.recurrenceAnchorEndAt ?? undefined,
      },
    })
    .then(parseActionResponse);
}

export function deleteTask(input: { taskId: string }) {
  return api.tasks[":taskId"]
    .$delete({
      param: { taskId: input.taskId },
      query: {},
    })
    .then(parseActionResponse);
}

// ═══════════════════════════════════════════════════════════════
// Schedule
// ═══════════════════════════════════════════════════════════════

export function applySchedule(input: {
  taskId: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  dueAt?: Date | null;
  scheduleSource?: "human" | "ai" | "system";
}) {
  return api.tasks[":taskId"]
    .schedule.$put({
      param: { taskId: input.taskId },
      json: {
        scheduledStartAt: input.scheduledStartAt.toISOString(),
        scheduledEndAt: input.scheduledEndAt.toISOString(),
        dueAt: input.dueAt?.toISOString() ?? null,
        scheduleSource: input.scheduleSource ?? "system",
      },
    })
    .then(parseActionResponse);
}

export function clearSchedule(input: { taskId: string }) {
  return api.tasks[":taskId"]
    .schedule.$delete({
      param: { taskId: input.taskId },
    })
    .then(parseActionResponse);
}

export function moveWorkBlock(input: {
  workBlockId: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
}) {
  return fetch(`/api/tasks/work-blocks/${encodeURIComponent(input.workBlockId)}/schedule`, {
    method: "PUT",
    headers: buildAccessKeyHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      scheduledStartAt: input.scheduledStartAt.toISOString(),
      scheduledEndAt: input.scheduledEndAt.toISOString(),
    }),
  }).then(async (res) => {
    handleUnauthorizedResponse(res);
    return parseActionResponse(res);
  });
}

export function decideScheduleProposal(input: {
  proposalId: string;
  decision: "Accepted" | "Rejected";
  resolutionNote?: string | null;
}) {
  return api.tasks["schedule-proposals"].decision
    .$post({
      json: {
        proposalId: input.proposalId,
        decision: input.decision,
        resolutionNote: input.resolutionNote ?? undefined,
      },
    })
    .then(parseActionResponse);
}

// ═══════════════════════════════════════════════════════════════
// Execution
// ═══════════════════════════════════════════════════════════════

export function startExecution(input: {
  taskId: string;
  prompt?: string | null;
}) {
  return api.tasks[":taskId"].execution.actions
    .$post({
      param: { taskId: input.taskId },
      json: { action: "start_manual", prompt: input.prompt ?? undefined },
    })
    .then(parseActionResponse);
}

export function retryExecution(input: {
  taskId: string;
  prompt?: string | null;
}) {
  return api.tasks[":taskId"].execution.actions
    .$post({
      param: { taskId: input.taskId },
      json: { action: "start_manual", prompt: input.prompt ?? undefined },
    })
    .then(parseActionResponse);
}

export function dispatchExecutionAction(input: {
  taskId: string;
  action: ExecutionActionInput;
}) {
  return api.tasks[":taskId"].execution.actions
    .$post({
      param: { taskId: input.taskId },
      json: input.action,
    })
    .then(parseActionResponse);
}

export function submitExecutionInput(input: {
  taskId: string;
  inputFields: Record<string, string>;
}) {
  return api.tasks[":taskId"].execution.actions
    .$post({
      param: { taskId: input.taskId },
      json: { action: "resume_with_input", inputFields: input.inputFields },
    })
    .then(parseActionResponse);
}

export function sendExecutionMessage(input: {
  taskId: string;
  message: string;
}) {
  return api.tasks[":taskId"].execution.actions
    .$post({
      param: { taskId: input.taskId },
      json: { action: "resume_after_unblock", note: input.message },
    })
    .then(parseActionResponse);
}

export function markTaskDone(input: { taskId: string }) {
  return api.tasks[":taskId"].complete
    .$post({
      param: { taskId: input.taskId },
    })
    .then(parseActionResponse);
}

export function reopenTask(input: { taskId: string }) {
  return api.tasks[":taskId"].reopen
    .$post({
      param: { taskId: input.taskId },
    })
    .then(parseActionResponse);
}

export function acceptTaskResult(input: { taskId: string }) {
  return api.tasks[":taskId"].result.accept
    .$post({
      param: { taskId: input.taskId },
    })
    .then(parseActionResponse);
}
