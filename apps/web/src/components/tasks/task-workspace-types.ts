import type { TaskConfigExecutionRuntime } from "@/components/schedule/forms/task-config-form";
import type { TaskPlanReadModel, TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";

export type TaskPlanGenerationStatus = "idle" | "generating" | "waiting_acceptance" | "accepted";

export type TaskData = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  executionRuntime: string;
  executionConfig: unknown;
  status: string;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  scheduleSource: string | null;
  isRunnable: boolean;
  runnabilitySummary: string;
  runnabilityState?: string;
  savedPlan?: TaskPlanReadModel | null;
  aiPlanGenerationStatus?: TaskPlanGenerationStatus;
  blockReason: {
    blockType?: string;
    actionRequired?: string;
    scope?: string;
    since?: string;
  } | null;
  dependencies: Array<{
    id: string;
    dependencyType: string;
    dependsOnTask: {
      id: string;
      title: string;
      status: string;
    };
  }>;
};

export type TaskPageData = {
  defaultExecutionRuntime: string;
  executionRuntimes: TaskConfigExecutionRuntime[];
  task: TaskData;
  latestRunSummary: {
    id: string;
    status: string;
    startedAt: string | null;
    syncStatus: string;
  } | null;
  scheduleProposals: Array<{
    id: string;
    source: string;
    proposedBy: string;
    summary: string;
    status: string;
    dueAt: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
  }>;
  approvals: Array<{
    id: string;
    title: string;
    status: string;
    riskLevel?: string;
    requestedAt?: string;
  }>;
  artifacts: Array<{
    id: string;
    title: string;
    type: string;
    uri?: string;
  }>;
};

export type EditableTask = {
  title: string;
  description: string | null;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  executionRuntime: string;
  executionConfig: unknown;
};

export type CurrentProposalState = {
  proposal: TaskWorkspaceUpdateProposal;
  originalTask: EditableTask;
};
