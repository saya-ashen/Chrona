import { useCallback, useMemo, useState, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskConfigDraftState, TaskConfigFormInput } from "@/components/schedule/task-config-form";
import { api } from "@/lib/rpc-client";
import {
  dateToIsoStringOrNull,
  editableTaskToEditSummary,
  editableTaskToPlanningDraft,
  taskConfigInputToEditableTask,
  taskToEditableTask,
  taskToTaskConfigInitialValues,
} from "./mappers/task-workspace-editor-view-model";
import { fetchTaskWorkspaceTask, taskWorkspaceQueryKeys } from "./task-workspace-query";
import type { TaskData } from "./task-workspace-types";

export function useTaskWorkspaceEditorState(initialTask: TaskData) {
  const queryClient = useQueryClient();
  const taskQuery = useQuery({
    queryKey: taskWorkspaceQueryKeys.detail(initialTask.id),
    queryFn: () => fetchTaskWorkspaceTask(initialTask.id),
    initialData: initialTask,
  });
  const task = taskQuery.data ?? initialTask;
  const [taskConfigDraft, setTaskConfigDraft] = useState<TaskConfigFormInput | null>(null);
  const [hasUnsavedConfigChanges, setHasUnsavedConfigChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isEditExpanded, setIsEditExpanded] = useState(
    () => !(["Ready", "Completed", "Done"].includes(initialTask.status) || initialTask.aiPlanGenerationStatus === "accepted"),
  );

  const setTask = useCallback((value: SetStateAction<TaskData>) => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.detail(initialTask.id), (current: TaskData | undefined) => {
      const previous = current ?? initialTask;
      return typeof value === "function" ? (value as (prevState: TaskData) => TaskData)(previous) : value;
    });
  }, [initialTask, queryClient]);

  const taskConfigInitialValues = useMemo(() => taskToTaskConfigInitialValues(task), [
    task.title,
    task.description,
    task.priority,
    task.dueAt,
    task.scheduledStartAt,
    task.scheduledEndAt,
    task.runtimeAdapterKey,
    task.runtimeInput,
    task.runtimeInputVersion,
    task.runtimeModel,
    task.prompt,
    task.runtimeConfig,
  ]);
  const originalEditableTask = useMemo(() => taskToEditableTask(task), [task]);
  const draftEditableTask = useMemo(
    () => taskConfigDraft
      ? taskConfigInputToEditableTask(taskConfigDraft, task.scheduleStatus)
      : originalEditableTask,
    [originalEditableTask, task.scheduleStatus, taskConfigDraft],
  );
  const editSummary = useMemo(() => editableTaskToEditSummary(draftEditableTask), [draftEditableTask]);
  const planningTaskDraft = useMemo(
    () => taskConfigDraft
      ? {
          title: taskConfigDraft.title,
          description: taskConfigDraft.description,
          priority: taskConfigDraft.priority,
          dueAt: taskConfigDraft.dueAt,
          scheduledStartAt: taskConfigDraft.scheduledStartAt,
          scheduledEndAt: taskConfigDraft.scheduledEndAt,
        }
      : editableTaskToPlanningDraft(originalEditableTask),
    [originalEditableTask, taskConfigDraft],
  );
  const assistantBuildCurrentTask = useCallback(() => ({
    title: draftEditableTask.title,
    description: draftEditableTask.description,
    priority: draftEditableTask.priority,
    dueAt: draftEditableTask.dueAt,
    scheduledStartAt: draftEditableTask.scheduledStartAt,
    scheduledEndAt: draftEditableTask.scheduledEndAt,
    scheduleStatus: draftEditableTask.scheduleStatus,
    runtimeModel: draftEditableTask.runtimeModel,
    prompt: draftEditableTask.prompt,
    runtimeConfig: draftEditableTask.runtimeConfig,
    status: task.status,
  }), [draftEditableTask, task.status]);

  const handleTaskConfigDraftStateChange = useCallback((state: TaskConfigDraftState) => {
    setTaskConfigDraft(state.values);
    setHasUnsavedConfigChanges(state.isDirty);
    setSaveSuccess(false);
  }, []);

  const saveTaskMutation = useMutation({
    mutationFn: async (input: TaskConfigFormInput) => {
      const body: Record<string, unknown> = {
        title: input.title,
        description: input.description || undefined,
        priority: input.priority,
        dueAt: input.dueAt?.toISOString() ?? undefined,
        scheduledStartAt: input.scheduledStartAt?.toISOString() ?? undefined,
        scheduledEndAt: input.scheduledEndAt?.toISOString() ?? undefined,
        runtimeAdapterKey: input.runtimeAdapterKey,
        runtimeInput: input.runtimeInput,
        runtimeInputVersion: input.runtimeInputVersion,
        runtimeModel: input.runtimeModel ?? undefined,
        prompt: input.prompt ?? undefined,
        runtimeConfig: input.runtimeConfig ?? undefined,
      };

      const response = await api.tasks[":taskId"].$patch({
        param: { taskId: task.id },
        json: body,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to save" }));
        throw new Error((err as { error?: string }).error ?? "Failed to save task");
      }

      await response.json();
      return input;
    },
  });

  const persistTaskConfig = useCallback(async (input: TaskConfigFormInput) => {
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await saveTaskMutation.mutateAsync(input);
      setTask((prev) => ({
        ...prev,
        title: input.title,
        description: input.description || null,
        priority: input.priority,
          dueAt: dateToIsoStringOrNull(input.dueAt),
          scheduledStartAt: dateToIsoStringOrNull(input.scheduledStartAt),
          scheduledEndAt: dateToIsoStringOrNull(input.scheduledEndAt),
        scheduleStatus: prev.scheduleStatus,
        runtimeAdapterKey: input.runtimeAdapterKey,
        runtimeInput: input.runtimeInput,
        runtimeInputVersion: input.runtimeInputVersion,
        runtimeModel: input.runtimeModel,
        prompt: input.prompt,
        runtimeConfig: input.runtimeConfig ?? null,
      }));
      setTaskConfigDraft(input);
      setHasUnsavedConfigChanges(false);
      setSaveSuccess(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Failed to save task");
    }
  }, [saveTaskMutation, setTask]);

  const handleSaveCurrentDraft = useCallback(async () => {
    if (!taskConfigDraft) return;
    await persistTaskConfig(taskConfigDraft);
  }, [persistTaskConfig, taskConfigDraft]);

  return {
    task,
    setTask,
    taskConfigDraft,
    hasUnsavedConfigChanges,
    isSaving: saveTaskMutation.isPending,
    saveError,
    setSaveError,
    saveSuccess,
    setSaveSuccess,
    isEditExpanded,
    setIsEditExpanded,
    taskConfigInitialValues,
    draftEditableTask,
    editSummary,
    planningTaskDraft,
    assistantBuildCurrentTask,
    handleTaskConfigDraftStateChange,
    persistTaskConfig,
    handleSaveCurrentDraft,
  };
}
