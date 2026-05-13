import type { TaskPlanState } from "./task-workspace-query";
import type { TaskData, TaskPlanGenerationStatus } from "./task-workspace-types";

type BasePlanFlowState = {
  savedPlan: TaskData["savedPlan"] | null;
};

export type TaskWorkspacePlanFlowState =
  | (BasePlanFlowState & { status: "idle" })
  | (BasePlanFlowState & { status: "generating" })
  | (BasePlanFlowState & { status: "waiting_acceptance" })
  | (BasePlanFlowState & { status: "accepting"; planId: string })
  | (BasePlanFlowState & { status: "accepted" })
  | (BasePlanFlowState & { status: "failed"; planId: string; error: string });

export function createPlanFlowFromSnapshot(planState: TaskPlanState): TaskWorkspacePlanFlowState {
  return {
    status: planState.aiPlanGenerationStatus,
    savedPlan: planState.savedPlan ?? null,
  };
}

export function startPlanAccept(
  state: TaskWorkspacePlanFlowState,
  planId: string,
): TaskWorkspacePlanFlowState {
  return {
    status: "accepting",
    planId,
    savedPlan: state.savedPlan ?? null,
  };
}

export function completePlanAccept(
  savedPlan: TaskData["savedPlan"] | null,
): TaskWorkspacePlanFlowState {
  return {
    status: "accepted",
    savedPlan,
  };
}

export function failPlanAccept(
  state: TaskWorkspacePlanFlowState,
  planId: string,
  error: string,
): TaskWorkspacePlanFlowState {
  return {
    status: "failed",
    planId,
    error,
    savedPlan: state.savedPlan ?? null,
  };
}

export function clearPlanFlowError(state: TaskWorkspacePlanFlowState): TaskWorkspacePlanFlowState {
  if (state.status !== "failed") {
    return state;
  }

  return {
    status: state.savedPlan?.id ? "waiting_acceptance" : "idle",
    savedPlan: state.savedPlan ?? null,
  };
}

export function getPlanGenerationStatusFromFlow(
  state: TaskWorkspacePlanFlowState,
): TaskPlanGenerationStatus {
  switch (state.status) {
    case "accepting":
    case "failed":
      return state.savedPlan?.id ? "waiting_acceptance" : "idle";
    default:
      return state.status;
  }
}

export function canAcceptPlanFromFlow(state: TaskWorkspacePlanFlowState): boolean {
  return (state.status === "waiting_acceptance" || state.status === "failed") && Boolean(state.savedPlan?.id);
}

export function isAcceptingPlanFromFlow(state: TaskWorkspacePlanFlowState): boolean {
  return state.status === "accepting";
}

export function getAcceptPlanErrorFromFlow(state: TaskWorkspacePlanFlowState): string | null {
  return state.status === "failed" ? state.error : null;
}
