"use client";

import type { Locale } from "@chrona/i18n";
import type { Dispatch, DragEvent, SetStateAction } from "react";
import type {
	SchedulePageData,
	ScheduleViewMode,
	ScheduledItem,
	TimelineCreateInput,
	TimelineDragItem,
	UnscheduledItem,
} from "./schedule-page-types";
import { buildScheduleViewHref } from "./schedule-page-utils";
import {
	buildDraggedItem,
	handleCreateTaskBlockAction,
	handleScheduleDropAction,
	handleTaskConfigSaveAction,
	runSchedulePageAction,
} from "./schedule-page-actions";
import type { SchedulePageCopy } from "./schedule-page-copy";
import type { TaskConfigFormInput } from "./forms/task-config-form";
import { deleteTask } from "@features/task-workspace/public/workspace-integration";

type DraggedTask = {
	kind: "queue" | "scheduled";
	taskId: string;
} | null;

type UseSchedulePageActionsArgs = {
	workspaceId: string;
	hydratedData: SchedulePageData;
	viewData: SchedulePageData;
	activeView: ScheduleViewMode;
	activeDay: string;
	locale: Locale;
	copy: SchedulePageCopy;
	draggedTask: DraggedTask;
	setDraggedTask: Dispatch<SetStateAction<DraggedTask>>;
	setViewData: Dispatch<SetStateAction<SchedulePageData>>;
	setLocalSelectedTaskId: Dispatch<SetStateAction<string | undefined>>;
	setErrorMessage: Dispatch<SetStateAction<string | null>>;
	setAnnouncement: Dispatch<SetStateAction<string>>;
	setIsPending: Dispatch<SetStateAction<boolean>>;
	refreshProjection: () => Promise<void>;
	pushRoute: (href: string) => void;
	localizeHref: (locale: "en" | "zh" | undefined, href: string) => string;
	actionFailedMessage: string;
	isPending: boolean;
	activeGroupItems: ScheduledItem[];
};

export function useSchedulePageActions({
	workspaceId,
	hydratedData,
	viewData,
	activeView,
	activeDay,
	locale,
	copy,
	draggedTask,
	setDraggedTask,
	setViewData,
	setLocalSelectedTaskId,
	setErrorMessage,
	setAnnouncement,
	setIsPending,
	refreshProjection,
	pushRoute,
	localizeHref,
	actionFailedMessage,
	isPending,
	activeGroupItems,
}: UseSchedulePageActionsArgs) {
	const draggedQueueItem =
		draggedTask?.kind === "queue"
			? (viewData.unscheduled.find(
					(item) => item.taskId === draggedTask.taskId,
				) ?? null)
			: null;

	const draggedItem = buildDraggedItem({
		draggedTask,
		unscheduled: viewData.unscheduled,
		activeGroupItems,
	});

	function handleQueueDragStart(
		item: UnscheduledItem,
		event: DragEvent<HTMLElement>,
	) {
		if (isPending) {
			event.preventDefault();
			return;
		}

		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", item.taskId);
		event.dataTransfer.setDragImage(document.createElement("img"), 0, 0);
		setDraggedTask({ kind: "queue", taskId: item.taskId });
		setErrorMessage(null);
		setAnnouncement(
			`Picked up ${item.title}. Move it to the timeline to create a block.`,
		);
	}

	function handleQueueDragEnd() {
		setDraggedTask(null);
	}

	function handleScheduledDragStart(item: ScheduledItem) {
		setDraggedTask({ kind: "scheduled", taskId: item.taskId });
		setErrorMessage(null);
		setAnnouncement(
			`Picked up scheduled block ${item.title}. Drop it on a new slot to move the block.`,
		);
	}

	async function handleScheduleDrop(
		item: NonNullable<TimelineDragItem>,
		startAt: Date,
		endAt: Date,
	) {
		await handleScheduleDropAction({
			item,
			startAt,
			endAt,
			draggedQueueItem,
			locale,
			copy,
			applyOptimisticViewData: (updater) => setViewData(updater),
			removeExpandedQueueTask: () => undefined,
			_setLocalSelectedTaskId: setLocalSelectedTaskId as (
				taskId: string,
			) => void,
			setAnnouncement,
			setIsPending,
			setErrorMessage,
			refreshProjection,
			resetViewData: () => setViewData(hydratedData),
			clearDraggedTask: () => setDraggedTask(null),
			actionFailedMessage,
		});
	}

	async function handleCreateTaskBlock(input: TimelineCreateInput) {
		await handleCreateTaskBlockAction({
			input,
			workspaceId,
			activeDay,
			activeView,
			locale,
			copy,
			applyOptimisticViewData: (updater) => setViewData(updater),
			setLocalSelectedTaskId,
			pushRoute,
			localizeHref,
			buildScheduleViewHref,
			setAnnouncement,
			setIsPending,
			setErrorMessage,
			refreshProjection,
			resetViewData: () => setViewData(hydratedData),
			actionFailedMessage,
			autoPlanGenerationEnabled: input.autoPlanGenerationEnabled,
		});
	}

	async function handleTaskConfigSave(
		taskId: string,
		input: TaskConfigFormInput,
	) {
		await handleTaskConfigSaveAction({
			taskId,
			input,
			applyOptimisticViewData: (updater) => setViewData(updater),
			setIsPending,
			setErrorMessage,
			refreshProjection,
			resetViewData: () => setViewData(hydratedData),
			actionFailedMessage,
		});
	}

	async function handleDeleteTask(taskId: string) {
		await runSchedulePageAction({
			action: async () => {
				await deleteTask({ taskId, workspaceId });
			},
			setIsPending,
			setErrorMessage,
			refreshProjection,
			actionFailedMessage,
		});
	}

	return {
		draggedItem,
		handleQueueDragStart,
		handleQueueDragEnd,
		handleScheduledDragStart,
		handleScheduleDrop,
		handleCreateTaskBlock,
		handleTaskConfigSave,
		handleDeleteTask,
	};
}
