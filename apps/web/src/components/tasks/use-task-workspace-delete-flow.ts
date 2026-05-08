import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/rpc-client";

type UseTaskWorkspaceDeleteFlowInput = {
  taskId: string;
  setSaveError: (value: string | null) => void;
};

export function useTaskWorkspaceDeleteFlow({ taskId, setSaveError }: UseTaskWorkspaceDeleteFlowInput) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const deleteTaskMutation = useMutation({
    mutationFn: async () => {
      const response = await api.tasks[":taskId"].$delete({ param: { taskId }, query: {} });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to delete task" }));
        throw new Error((err as { error?: string }).error ?? "Failed to delete task");
      }
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
