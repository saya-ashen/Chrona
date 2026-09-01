import { useCallback, useMemo, useState, type SetStateAction } from "react";
import { useMutation } from "@tanstack/react-query";
import type { TaskConfigFormInput } from "@features/schedule/ui";
import { apiJson } from "@shared/http";
import {
	dateToIsoStringOrNull,
	editableTaskToPlanningDraft,
	taskConfigInputToEditableTask,
	taskToEditableTask,
	taskToTaskConfigInitialValues,
} from "../model/task-workspace-editor-view-model";
import type { TaskData } from "../model/task-workspace-types";

type TaskConfigDraftState = {
	isDirty: boolean;
	values: TaskConfigFormInput;
};

export function useTaskWorkspaceEditorState(
	task: TaskData,
	setTask: (value: SetStateAction<TaskData>) => void,
) {
	const [taskConfigDraft, setTaskConfigDraft] =
		useState<TaskConfigFormInput | null>(null);
	const [hasUnsavedConfigChanges, setHasUnsavedConfigChanges] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saveSuccess, setSaveSuccess] = useState(false);

	const taskConfigInitialValues = useMemo(
		() => taskToTaskConfigInitialValues(task),
		[
			task.title,
			task.description,
			task.priority,
			task.dueAt,
			task.scheduledStartAt,
			task.scheduledEndAt,
			task.executionConfig,
			task.autoPlanGeneration,
			task.autoExecute,
			task.recurrenceRule,
			task.aiClientId,
		],
	);
	const originalEditableTask = useMemo(() => taskToEditableTask(task), [task]);
	const draftEditableTask = useMemo(
		() =>
			taskConfigDraft
				? taskConfigInputToEditableTask(taskConfigDraft, task.scheduleStatus)
				: originalEditableTask,
		[originalEditableTask, task.scheduleStatus, taskConfigDraft],
	);
	const planningTaskDraft = useMemo(
		() =>
			taskConfigDraft
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
	const assistantBuildCurrentTask = useCallback(
		() => ({
			title: draftEditableTask.title,
			description: draftEditableTask.description,
			priority: draftEditableTask.priority,
			dueAt: draftEditableTask.dueAt,
			scheduledStartAt: draftEditableTask.scheduledStartAt,
			scheduledEndAt: draftEditableTask.scheduledEndAt,
			scheduleStatus: draftEditableTask.scheduleStatus,
			executionConfig: draftEditableTask.executionConfig,
			status: task.status,
		}),
		[draftEditableTask, task.status],
	);

	const handleTaskConfigDraftStateChange = useCallback(
		(state: TaskConfigDraftState) => {
			setTaskConfigDraft(state.isDirty ? state.values : null);
			setHasUnsavedConfigChanges(state.isDirty);
			setSaveSuccess(false);
		},
		[],
	);

	const saveTaskMutation = useMutation({
		mutationFn: async (input: TaskConfigFormInput) => {
			const taskBody: Record<string, unknown> = {
				title: input.title,
				description: input.description || undefined,
				priority: input.priority,
				executionConfig: input.executionConfig,
				aiClientId: input.aiClientId,
				autoPlanGeneration: input.autoPlanGeneration,
				autoExecute: input.autoExecute,
				recurrenceRule: input.recurrenceRule,
				recurrenceAnchorStartAt:
					input.recurrenceAnchorStartAt?.toISOString() ?? null,
				recurrenceAnchorEndAt:
					input.recurrenceAnchorEndAt?.toISOString() ?? null,
			};
			await apiJson(`/api/tasks/${encodeURIComponent(task.id)}`, {
				method: "PATCH",
				body: JSON.stringify(taskBody),
			});

			if (input.scheduledStartAt && input.scheduledEndAt) {
				await apiJson(`/api/tasks/${encodeURIComponent(task.id)}/schedule`, {
					method: "PUT",
					body: JSON.stringify({
						dueAt: input.dueAt?.toISOString() ?? null,
						scheduledStartAt: input.scheduledStartAt.toISOString(),
						scheduledEndAt: input.scheduledEndAt.toISOString(),
						scheduleSource: "human",
					}),
				});
			}

			return input;
		},
	});

	const persistTaskConfig = useCallback(
		async (input: TaskConfigFormInput) => {
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
					executionConfig: input.executionConfig,
					aiClientId: input.aiClientId,
					autoPlanGeneration: input.autoPlanGeneration,
					autoExecute: input.autoExecute,
					recurrenceRule: input.recurrenceRule,
				}));
				setTaskConfigDraft(input);
				setHasUnsavedConfigChanges(false);
				setSaveSuccess(true);
			} catch (cause) {
				setSaveError(
					cause instanceof Error ? cause.message : "Failed to save task",
				);
			}
		},
		[saveTaskMutation, setTask],
	);

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
		taskConfigInitialValues,
		draftEditableTask,
		planningTaskDraft,
		assistantBuildCurrentTask,
		handleTaskConfigDraftStateChange,
		persistTaskConfig,
		handleSaveCurrentDraft,
	};
}
