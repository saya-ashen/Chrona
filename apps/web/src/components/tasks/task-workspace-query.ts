import { api } from "@/lib/rpc-client";
import type { ExecutionActionInput, TaskPlanGenerationSessionReadModel } from "@chrona/contracts/ai";
import type { TaskData, TaskPlanGenerationStatus } from "./task-workspace-types";

export type TaskExecutionDispatchResult = {
  taskId: string;
  planId: string | null;
  mainSessionId: string | null;
  status: string;
  currentNodeId: string | null;
  executedNodeIds: string[];
  waitingNodeIds: string[];
  blockedNodeIds: string[];
  message: string;
  errorDetails?: unknown;
};

export type TaskPlanState = {
  taskId: string;
  aiPlanGenerationStatus: TaskPlanGenerationStatus;
  savedPlan: TaskData["savedPlan"] | null;
  generationSession: TaskPlanGenerationSessionReadModel | null;
};

export const taskWorkspaceQueryKeys = {
  all: ["task-workspace"] as const,
  detail: (taskId: string) => [...taskWorkspaceQueryKeys.all, "detail", taskId] as const,
  planState: (taskId: string) => [...taskWorkspaceQueryKeys.all, "plan-state", taskId] as const,
};

export async function fetchTaskWorkspaceTask(taskId: string) {
  const response = await api.tasks[":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to load task detail" }));
    throw new Error((err as { error?: string }).error ?? "Failed to load task detail");
  }

  const payload = await response.json() as unknown as { task: TaskData };
  return payload.task;
}

export async function fetchTaskPlanState(taskId: string): Promise<TaskPlanState> {
  const response = await api.tasks[":taskId"].plan.$get({
    param: { taskId },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to load task plan state" }));
    throw new Error((err as { error?: string }).error ?? "Failed to load task plan state");
  }

  const payload = await response.json() as {
      taskId: string;
      aiPlanGenerationStatus?: string;
      savedPlan?: TaskData["savedPlan"] | null;
      generationSession?: TaskPlanGenerationSessionReadModel | null;
    };

  return {
    taskId: payload.taskId,
    aiPlanGenerationStatus: (payload.aiPlanGenerationStatus ?? "idle") as TaskPlanState["aiPlanGenerationStatus"],
    savedPlan: payload.savedPlan ?? null,
    generationSession: payload.generationSession ?? null,
  };
}

export async function dispatchTaskExecutionAction(
  taskId: string,
  action: ExecutionActionInput,
): Promise<TaskExecutionDispatchResult> {
  const response = await api.tasks[":taskId"].execution.actions.$post({
    param: { taskId },
    json: action,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to dispatch execution action" }));
    throw new Error((err as { error?: string }).error ?? "Failed to dispatch execution action");
  }

  return await response.json() as TaskExecutionDispatchResult;
}
