import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { deleteTask } from "@/lib/task-actions-client";

type UseTaskWorkspaceDeleteFlowInput = {
  taskId: string;
  setSaveError: (value: string | null) => void;
};

export function useTaskWorkspaceDeleteFlow({ taskId, setSaveError }: UseTaskWorkspaceDeleteFlowInput) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const deleteTaskMutation = useMutation({
    mutationFn: async () => {
      await deleteTask({ taskId });
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
