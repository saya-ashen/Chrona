import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";
import type { CurrentProposalState, EditableTask } from "./task-workspace-types";

export type ProposalFlowState =
  | { status: "idle" }
  | { status: "previewing"; currentProposal: CurrentProposalState }
  | { status: "applying"; currentProposal: CurrentProposalState }
  | { status: "failed"; currentProposal: CurrentProposalState; error: string }
  | { status: "settled" };

export function createProposalPreviewState(
  proposal: TaskWorkspaceUpdateProposal,
  originalTask: EditableTask,
): ProposalFlowState {
  return {
    status: "previewing",
    currentProposal: {
      proposal,
      originalTask,
    },
  };
}

export function startProposalApply(state: ProposalFlowState): ProposalFlowState {
  if (state.status !== "previewing" && state.status !== "failed") {
    return state;
  }

  return {
    status: "applying",
    currentProposal: state.currentProposal,
  };
}

export function failProposalApply(state: ProposalFlowState, error: string): ProposalFlowState {
  if (state.status !== "applying") {
    return state;
  }

  return {
    status: "failed",
    currentProposal: state.currentProposal,
    error,
  };
}

export function settleProposalApply(): ProposalFlowState {
  return { status: "settled" };
}

export function resetProposalFlow(): ProposalFlowState {
  return { status: "idle" };
}

export function getCurrentProposalFromFlow(state: ProposalFlowState): CurrentProposalState | null {
  if (state.status === "previewing" || state.status === "applying" || state.status === "failed") {
    return state.currentProposal;
  }

  return null;
}
