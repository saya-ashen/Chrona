import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiJson } from "@shared/http";

type UseTaskWorkspaceDeleteFlowInput = {
  taskId: string;
  setSaveError: (value: string | null) => void;
};

export function useTaskWorkspaceDeleteFlow({ taskId, setSaveError }: UseTaskWorkspaceDeleteFlowInput) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  const handleDelete = useCallback(async () => {
    setSaveError(null);
    await deleteTaskMutation.mutateAsync();
  }, [deleteTaskMutation, setSaveError]);

  return {
    showDeleteConfirm,
    setShowDeleteConfirm,
    isDeleting: deleteTaskMutation.isPending,
    handleDelete,
  };
}
