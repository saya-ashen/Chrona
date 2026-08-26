import type { ReactNode } from "react";
import type {
  ExecutionActionInput,
  PublicPlanExecutionResult,
  SubmitCheckpointActionInput,
  TaskPlanReadModel,
} from "@chrona/contracts";
import type { CommandCenterCopy } from "@features/execution-monitoring/ui";
import type { TaskPlanGraphPlan } from "../plan/task-plan-graph/types";
import type { PlanGenerationRequest, WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { TaskExecutionDispatchResult } from "../model/task-workspace-query";
import type { TaskPageData, TaskPlanGenerationStatus, WorkspaceActivityItem } from "../model/task-workspace-types";
import type { PendingWorkspaceCommand } from "../model/task-workspace-settlement";

export type TaskWorkspacePlanSectionProps = {
  label: string;
  commandCenterCopy?: Partial<CommandCenterCopy>;
  graphPlan: TaskPlanGraphPlan | null;
  isGraphPlanPending: boolean;
  pageData: TaskPageData;
  plan: TaskPlanReadModel | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  canAcceptPlan?: boolean;
  acceptPlanError: string | null;
  runtimeEvents: WorkspaceRuntimeEvent[];
  commandCenter?: NonNullable<TaskPageData["commandCenter"]> | null;
  liveActivity?: WorkspaceActivityItem[];
  currentExecution?: PublicPlanExecutionResult | null;
  generationUserInstruction?: string | null;
  onGeneratePlan: (request?: PlanGenerationRequest) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
  onDispatchExecutionAction: (action: ExecutionActionInput) => Promise<TaskExecutionDispatchResult>;
  onSubmitCheckpointAction?: (action: SubmitCheckpointActionInput) => Promise<TaskExecutionDispatchResult>;
  onAcceptResult?: () => Promise<void> | void;
  isAcceptingResult?: boolean;
  acceptResultError?: string | null;
  onRetryFinalization?: () => Promise<void> | void;
  isRetryingFinalization?: boolean;
  finalizationRetryError?: string | null;
  pendingCommand?: PendingWorkspaceCommand | null;
  createGoalAction?: ReactNode;
  onEditBrief?: () => void;
};
