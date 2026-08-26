import { useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useMutation } from "@tanstack/react-query";
import { apiJson } from "@shared/http";
import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts"
import {
  createProposalPreviewState,
  failProposalApply,
  getCurrentProposalFromFlow,
  resetProposalFlow,
  settleProposalApply,
  startProposalApply,
  type ProposalFlowState,
} from "../model/task-workspace-proposal-flow-machine";
import type { CurrentProposalState, EditableTask, TaskData } from "../model/task-workspace-types";

type UseTaskWorkspaceProposalFlowInput = {
  task: TaskData;
  plan: TaskData["savedPlan"] | null;
  planHeadStateVersion: number | null;
  draftEditableTask: EditableTask;
  setTask: (value: React.SetStateAction<TaskData>) => void;
  setSaveError: (value: string | null) => void;
  fetchPlan: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
};

export function useTaskWorkspaceProposalFlow({
  task,
  plan,
  planHeadStateVersion,
  draftEditableTask,
  setTask,
  setSaveError,
  fetchPlan,
  refreshWorkspace,
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
          if (patch.executionConfig !== undefined) body.executionConfig = patch.executionConfig ?? undefined;

          await apiJson(`/api/tasks/${encodeURIComponent(task.id)}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          });
          const patchedFields: Partial<EditableTask> = {};
          if (patch.title !== undefined) patchedFields.title = patch.title;
          if (patch.description !== undefined) patchedFields.description = patch.description;
          if (patch.priority !== undefined) patchedFields.priority = patch.priority;
          if (patch.dueAt !== undefined) patchedFields.dueAt = patch.dueAt;
          if (patch.scheduledStartAt !== undefined) patchedFields.scheduledStartAt = patch.scheduledStartAt;
          if (patch.scheduledEndAt !== undefined) patchedFields.scheduledEndAt = patch.scheduledEndAt;
          if (patch.executionConfig !== undefined) patchedFields.executionConfig = patch.executionConfig;
          setTask((prev) => ({ ...prev, ...patchedFields }));
        } catch (cause) {
          errors.push(`Task update error: ${cause instanceof Error ? cause.message : "Unknown"}`);
        }
      }

      if (proposal.planPatch && plan) {
        try {
          if (planHeadStateVersion === null) {
            throw new Error("Plan generation version is unavailable. Refresh before applying the proposal.");
          }
          let expectedHeadStateVersion = planHeadStateVersion;
          for (const operation of proposal.planPatch.operations) {
            const patch = (() => {
              switch (operation.op) {
                case "add_node":
                  return { operation: "add_node", nodes: [operation.node] };
                case "update_node":
                  return { operation: "update_node", nodePatches: [{ id: operation.nodeId, ...operation.patch }] };
                case "delete_node":
                  return { operation: "delete_node", deletedNodeIds: [operation.nodeId] };
                case "add_edge":
                  return { operation: "update_dependencies", edges: [{ fromNodeId: operation.edge.from, toNodeId: operation.edge.to }] };
                case "update_plan":
                case "delete_edge":
                case "replace_subgraph":
                  throw new Error(`Unsupported plan proposal operation: ${operation.op}`);
              }
            })();
            await apiJson(`/api/tasks/${encodeURIComponent(task.id)}/plan`, {
              method: "POST",
              body: JSON.stringify({
                ...patch,
                expectedHeadStateVersion,
                idempotencyKey: uuidv4(),
                summary: proposal.planPatch.rationale ?? `Apply ${operation.op}`,
              }),
            });
            expectedHeadStateVersion += 1;
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
      await Promise.all([fetchPlan(), refreshWorkspace()]);
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
