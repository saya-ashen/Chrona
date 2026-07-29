import { useCallback, useState } from "react";
import { localizeHref, useLocale } from "@chrona/i18n";
import { useMutation } from "@tanstack/react-query";
import { apiJson } from "@shared/http";

type UseTaskWorkspaceDeleteFlowInput = {
  taskId: string;
  setSaveError: (value: string | null) => void;
};

export function useTaskWorkspaceDeleteFlow({ taskId, setSaveError }: UseTaskWorkspaceDeleteFlowInput) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const locale = useLocale();

  const deleteTaskMutation = useMutation({
    mutationFn: async () => {
      await apiJson(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      window.location.href = "/schedule";
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
    setShowDeleteConfirm,
    showRebuildConfirm,
    setShowRebuildConfirm,
    isRebuilding: rebuildTaskMutation.isPending,
    handleRebuild,
    isDeleting: deleteTaskMutation.isPending,
    handleDelete,
  };
}
