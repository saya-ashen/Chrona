import type { TaskWorkspaceUpdateProposal } from "./commands";

export interface GenerateTaskPlanRequest {
  taskId?: string;
  title: string;
  description?: string;
  priority?: string;
  dueAt?: Date | string | null;
  estimatedMinutes?: number;
  userInstruction?: string | null;
  /**
   * Read-only context owned by an external source (e.g. an imported calendar
   * event's description). Distinct from `description`, which is the editable
   * Chrona note. Both are surfaced to the planner as separate sections.
   */
  sourceContext?: string | null;
  sessionKey?: string;
  signal?: AbortSignal;
}

export interface GenerateTaskPlanApiRequest {
  forceRefresh?: boolean;
  userInstruction?: string | null;
}

export interface TaskWorkspaceChatRequest {
  taskId: string;
  message: string;
  currentTask: {
    title: string;
    description: string | null;
    priority: string;
    dueAt: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    scheduleStatus: string;
    executionRuntime: string;
    executionConfig: unknown;
    status: string;
  };
  currentPlan?: {
    id: string;
    status: string;
    revision: number;
    summary: string | null;
    nodes: Array<{
      id: string;
      title: string;
      objective: string;
      description: string | null;
      status: string;
      estimatedMinutes: number | null;
      priority: string | null;
      executionMode: string;
      dependsOn?: string[];
    }>;
    edges: Array<{
      id: string;
      fromNodeId: string;
      toNodeId: string;
      type: string;
    }>;
  } | null;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  enablePatchTools?: boolean;
}

export interface TaskWorkspaceChatResponse {
  assistantMessage: string;
  proposal?: TaskWorkspaceUpdateProposal;
}
