import { useCallback, useState } from "react";
import { localizeHref, useLocale } from "@chrona/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiJson } from "@shared/http";
import type { TaskDeleteImpact } from "@chrona/contracts";

type UseTaskWorkspaceDeleteFlowInput = {
  taskId: string;
  workspaceId: string;
  goalId?: string | null;
  setSaveError: (value: string | null) => void;
};

export function useTaskWorkspaceDeleteFlow({ taskId, workspaceId, goalId, setSaveError }: UseTaskWorkspaceDeleteFlowInput) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const locale = useLocale();
  const deleteImpactQuery = useQuery({
    queryKey: ["task-delete-impact", taskId, workspaceId],
    queryFn: () => apiJson<TaskDeleteImpact>(
      `/api/tasks/${encodeURIComponent(taskId)}/delete-impact?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),
    enabled: showDeleteConfirm,
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async () => {
      if (!deleteImpactQuery.data) throw new Error("Deletion impact is not available");
      await apiJson(`/api/tasks/${encodeURIComponent(taskId)}?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "DELETE",
        body: JSON.stringify({
          expectedTaskIds: deleteImpactQuery.data.taskIds,
          expectedAssetIds: deleteImpactQuery.data.assets.map((asset) => asset.id),
        }),
      });
    },
    onSuccess: () => {
      window.location.href = goalId
        ? localizeHref(locale, `/goals/${goalId}?section=workbench`)
        : localizeHref(locale, "/schedule");
    },
    onError: (cause) => {
      setSaveError(cause instanceof Error ? cause.message : "Failed to delete task");
      setShowDeleteConfirm(false);
    },
  });
  const rebuildTaskMutation = useMutation({
    mutationFn: async () => apiJson<{ taskId: string }>(
      `/api/tasks/${encodeURIComponent(taskId)}/actions/rebuild-with-latest-goal-assets`,
      { method: "POST" },
    ),
    onSuccess: ({ taskId: rebuiltTaskId }) => {
      window.location.href = localizeHref(locale, `/tasks/${rebuiltTaskId}`);
    },
    onError: (cause) => {
      setSaveError(cause instanceof Error ? cause.message : "Failed to rebuild task");
      setShowRebuildConfirm(false);
    },
  });


  const handleDelete = useCallback(async () => {
    setSaveError(null);
    await deleteTaskMutation.mutateAsync();
  }, [deleteTaskMutation, setSaveError]);

  const handleRebuild = useCallback(async () => {
    setSaveError(null);
    await rebuildTaskMutation.mutateAsync();
  }, [rebuildTaskMutation, setSaveError]);

  return {
    showDeleteConfirm,
    deleteImpact: deleteImpactQuery.data ?? null,
    isLoadingDeleteImpact: deleteImpactQuery.isLoading,
    deleteImpactError: deleteImpactQuery.error instanceof Error ? deleteImpactQuery.error.message : null,
    setShowDeleteConfirm,
    showRebuildConfirm,
    setShowRebuildConfirm,
    isRebuilding: rebuildTaskMutation.isPending,
    handleRebuild,
    isDeleting: deleteTaskMutation.isPending,
    handleDelete,
  };
}
