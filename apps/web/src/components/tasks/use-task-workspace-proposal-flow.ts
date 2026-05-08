import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/rpc-client";
import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";
import {
  createProposalPreviewState,
  failProposalApply,
  getCurrentProposalFromFlow,
  resetProposalFlow,
  settleProposalApply,
  startProposalApply,
  type ProposalFlowState,
} from "./task-workspace-proposal-flow-machine";
import type { CurrentProposalState, EditableTask, TaskData } from "./task-workspace-types";

type UseTaskWorkspaceProposalFlowInput = {
  task: TaskData;
  plan: TaskData["savedPlan"] | null;
  draftEditableTask: EditableTask;
  setTask: (value: React.SetStateAction<TaskData>) => void;
  setSaveError: (value: string | null) => void;
  fetchPlan: () => Promise<void>;
};

export function useTaskWorkspaceProposalFlow({
  task,
  plan,
  draftEditableTask,
  setTask,
  setSaveError,
  fetchPlan,
}: UseTaskWorkspaceProposalFlowInput) {
  const [proposalFlow, setProposalFlow] = useState<ProposalFlowState>({ status: "idle" });

  const applyProposalMutation = useMutation({
    mutationFn: async (proposal: TaskWorkspaceUpdateProposal) => {
      const errors: string[] = [];

      if (proposal.taskPatch) {
        try {
          const body: Record<string, unknown> = {};
          const patch = proposal.taskPatch;
          if (patch.title !== undefined) body.title = patch.title;
          if (patch.description !== undefined) body.description = patch.description;
          if (patch.priority !== undefined) body.priority = patch.priority;
          if (patch.dueAt !== undefined) body.dueAt = patch.dueAt ?? undefined;
          if (patch.scheduledStartAt !== undefined) body.scheduledStartAt = patch.scheduledStartAt ?? undefined;
          if (patch.scheduledEndAt !== undefined) body.scheduledEndAt = patch.scheduledEndAt ?? undefined;
          if (patch.runtimeModel !== undefined) body.runtimeModel = patch.runtimeModel ?? undefined;
          if (patch.prompt !== undefined) body.prompt = patch.prompt ?? undefined;
          if (patch.runtimeConfig !== undefined) body.runtimeConfig = patch.runtimeConfig ?? undefined;

          const response = await api.tasks[":taskId"].$patch({
            param: { taskId: task.id },
            json: body,
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({ error: "Failed to apply task patch" }));
            errors.push(`Task update failed: ${(err as { error?: string }).error ?? "Unknown error"}`);
          } else {
            await response.json();
            const patchedFields: Partial<EditableTask> = {};
            if (patch.title !== undefined) patchedFields.title = patch.title;
            if (patch.description !== undefined) patchedFields.description = patch.description;
            if (patch.priority !== undefined) patchedFields.priority = patch.priority;
            if (patch.dueAt !== undefined) patchedFields.dueAt = patch.dueAt;
            if (patch.scheduledStartAt !== undefined) patchedFields.scheduledStartAt = patch.scheduledStartAt;
            if (patch.scheduledEndAt !== undefined) patchedFields.scheduledEndAt = patch.scheduledEndAt;
            if (patch.runtimeModel !== undefined) patchedFields.runtimeModel = patch.runtimeModel;
            if (patch.prompt !== undefined) patchedFields.prompt = patch.prompt;
            if (patch.runtimeConfig !== undefined) patchedFields.runtimeConfig = patch.runtimeConfig;
            setTask((prev) => ({ ...prev, ...patchedFields }));
          }
        } catch (cause) {
          errors.push(`Task update error: ${cause instanceof Error ? cause.message : "Unknown"}`);
        }
      }

      if (proposal.planPatch && plan) {
        try {
          const response = await api.tasks[":taskId"].plan.$post({
            param: { taskId: task.id },
            json: {
              operation: "batch",
              operations: proposal.planPatch.operations.map((op) => JSON.stringify(op)),
            },
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({ error: "Failed to apply plan patch" }));
            errors.push(`Plan patch failed: ${(err as { error?: string }).error ?? "Unknown error"}`);
          }
        } catch (cause) {
          errors.push(`Plan update error: ${cause instanceof Error ? cause.message : "Unknown"}`);
        }
      }

      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }
    },
    onSuccess: async () => {
      setProposalFlow(settleProposalApply());
      await fetchPlan();
      setProposalFlow(resetProposalFlow());
    },
    onError: (cause) => {
      const message = cause instanceof Error ? cause.message : "Failed to apply proposal";
      setSaveError(message);
      setProposalFlow((current) => failProposalApply(current, message));
    },
  });

  const currentProposal = getCurrentProposalFromFlow(proposalFlow);

  const handleApplyProposal = useCallback(async (proposal: TaskWorkspaceUpdateProposal) => {
    setSaveError(null);
    setProposalFlow((current) => {
      if (
        (current.status === "previewing" || current.status === "failed") &&
        current.currentProposal.proposal === proposal
      ) {
        return startProposalApply(current);
      }

      return startProposalApply(createProposalPreviewState(proposal, draftEditableTask));
    });
    await applyProposalMutation.mutateAsync(proposal);
  }, [applyProposalMutation, draftEditableTask, setSaveError]);

  const handleProposal = useCallback((proposal: TaskWorkspaceUpdateProposal) => {
    setSaveError(null);
    setProposalFlow(createProposalPreviewState(proposal, draftEditableTask));
  }, [draftEditableTask, setSaveError]);

  const handleCancelProposal = useCallback(() => {
    setProposalFlow(resetProposalFlow());
  }, []);

  const setCurrentProposal = useCallback((value: React.SetStateAction<CurrentProposalState | null>) => {
    setProposalFlow((current) => {
      const resolved = typeof value === "function"
        ? value(getCurrentProposalFromFlow(current))
        : value;

      if (!resolved) {
        return resetProposalFlow();
      }

      return {
        status: "previewing",
        currentProposal: resolved,
      };
    });
  }, []);

  return {
    proposalFlowStatus: proposalFlow.status,
    currentProposal,
    setCurrentProposal,
    isApplying: applyProposalMutation.isPending,
    handleApplyProposal,
    handleProposal,
    handleCancelProposal,
  };
}
