import { beforeEach, describe, expect, it, vi } from "vitest";

const moveWorkBlock = vi.fn();
const applySchedule = vi.fn();
const updateTaskConfigFromSchedule = vi.fn();

vi.mock("./schedule-actions", () => ({
	applySchedule: (...args: unknown[]) => applySchedule(...args),
	createScheduledTask: vi.fn(),
	moveWorkBlock: (...args: unknown[]) => moveWorkBlock(...args),
	updateTaskConfigFromSchedule: (...args: unknown[]) =>
		updateTaskConfigFromSchedule(...args),
}));

import {
	handleScheduleDropAction,
	handleTaskConfigSaveAction,
} from "./schedule-page-actions";
import { DEFAULT_SCHEDULE_PAGE_COPY } from "./schedule-page-copy";

const item = {
	kind: "scheduled" as const,
	taskId: "task-1",
	workBlockId: "block-1",
	title: "Keyboard task",
	dueAt: null,
	durationMinutes: 60,
};

function harness() {
	return {
		applyOptimisticViewData: vi.fn(),
		removeExpandedQueueTask: vi.fn(),
		_setLocalSelectedTaskId: vi.fn(),
		setAnnouncement: vi.fn(),
		setIsPending: vi.fn(),
		setErrorMessage: vi.fn(),
		refreshProjection: vi.fn().mockResolvedValue(undefined),
		resetViewData: vi.fn(),
		clearDraggedTask: vi.fn(),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	moveWorkBlock.mockResolvedValue(undefined);
	applySchedule.mockResolvedValue(undefined);
	updateTaskConfigFromSchedule.mockResolvedValue(undefined);
});

describe("handleScheduleDropAction", () => {
	it("[SCHED-004] schedules and removes an unscheduled queue task after drop", async () => {
		const callbacks = harness();
		const startAt = new Date("2026-04-15T09:30:00.000Z");
		const endAt = new Date("2026-04-15T10:30:00.000Z");
		const queueItem = {
			taskId: "queue-task-1",
			workspaceId: "workspace-1",
			parentTaskId: null,
			title: "Queue task",
			description: null,
			priority: "Medium",
			persistedStatus: "Ready",
			displayState: null,
			actionRequired: null,
			approvalPendingCount: 0,
			scheduleStatus: "Unscheduled",
			scheduleSource: null,
			dueAt: null,
			scheduledStartAt: null,
			scheduledEndAt: null,
			latestRunStatus: null,
			scheduleProposalCount: 0,
			lastActivityAt: null,
			executionConfig: {},
			autoPlanGeneration: false,
			autoExecute: false,
			autoPlanGenerationTiming: "at_start",
			autoExecuteTiming: "at_start",
			isRunnable: true,
			runnabilityState: "ready_to_run",
			runnabilitySummary: "Ready to run",
		};

		await handleScheduleDropAction({
			item: {
				kind: "queue",
				taskId: queueItem.taskId,
				title: queueItem.title,
				dueAt: null,
				durationMinutes: 60,
			},
			startAt,
			endAt,
			draggedQueueItem: queueItem,
			locale: "en",
			copy: DEFAULT_SCHEDULE_PAGE_COPY,
			actionFailedMessage: "Schedule action failed",
			...callbacks,
		});

		expect(callbacks.applyOptimisticViewData).toHaveBeenCalledOnce();
		expect(callbacks.removeExpandedQueueTask).toHaveBeenCalledWith(
			"queue-task-1",
		);
		expect(applySchedule).toHaveBeenCalledWith({
			taskId: "queue-task-1",
			dueAt: null,
			scheduledStartAt: startAt,
			scheduledEndAt: endAt,
			scheduleSource: "human",
		});
		expect(callbacks.refreshProjection).toHaveBeenCalledOnce();
		expect(callbacks.clearDraggedTask).toHaveBeenCalledOnce();
	});

	it("[SCHED-007] announces and persists a keyboard-compatible block move", async () => {
		const callbacks = harness();
		const startAt = new Date("2026-04-15T09:30:00.000Z");
		const endAt = new Date("2026-04-15T10:30:00.000Z");

		await handleScheduleDropAction({
			item,
			startAt,
			endAt,
			draggedQueueItem: null,
			locale: "en",
			copy: DEFAULT_SCHEDULE_PAGE_COPY,
			actionFailedMessage: "Schedule action failed",
			...callbacks,
		});

		expect(callbacks.setAnnouncement).toHaveBeenCalledWith(
			expect.stringMatching(/Dropped Keyboard task/),
		);
		expect(moveWorkBlock).toHaveBeenCalledWith({
			workBlockId: "block-1",
			scheduledStartAt: startAt,
			scheduledEndAt: endAt,
		});
		expect(callbacks.refreshProjection).toHaveBeenCalledOnce();
	});

	it("[SCHED-008] saves selected-block task config and refreshes canonical projection", async () => {
		const callbacks = harness();
		const scheduledStartAt = new Date("2026-04-15T11:00:00.000Z");
		const scheduledEndAt = new Date("2026-04-15T12:00:00.000Z");

		await handleTaskConfigSaveAction({
			taskId: "task-1",
			input: {
				title: "Updated task",
				description: "Updated description",
				priority: "High",
				dueAt: null,
				scheduledStartAt,
				scheduledEndAt,
				executionConfig: {},
				aiClientId: null,
				autoPlanGeneration: false,
				autoExecute: false,
				autoPlanGenerationTiming: "at_start",
				autoExecuteTiming: "at_start",
				recurrenceRule: null,
				recurrenceAnchorStartAt: null,
				recurrenceAnchorEndAt: null,
			},
			applyOptimisticViewData: callbacks.applyOptimisticViewData,
			setIsPending: callbacks.setIsPending,
			setErrorMessage: callbacks.setErrorMessage,
			refreshProjection: callbacks.refreshProjection,
			resetViewData: callbacks.resetViewData,
			actionFailedMessage: "Schedule action failed",
		});

		expect(updateTaskConfigFromSchedule).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "task-1", title: "Updated task" }),
		);
		expect(applySchedule).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				scheduledStartAt,
				scheduledEndAt,
			}),
		);
		expect(callbacks.applyOptimisticViewData).toHaveBeenCalledOnce();
		expect(callbacks.refreshProjection).toHaveBeenCalledOnce();
	});

	it("[SCHED-012] resets optimistic state and reports an API failure", async () => {
		const callbacks = harness();
		moveWorkBlock.mockRejectedValueOnce(new Error("Move rejected"));

		await handleScheduleDropAction({
			item,
			startAt: new Date("2026-04-15T09:30:00.000Z"),
			endAt: new Date("2026-04-15T10:30:00.000Z"),
			draggedQueueItem: null,
			locale: "en",
			copy: DEFAULT_SCHEDULE_PAGE_COPY,
			actionFailedMessage: "Schedule action failed",
			...callbacks,
		});

		expect(callbacks.setErrorMessage).toHaveBeenCalledWith("Move rejected");
		expect(callbacks.resetViewData).toHaveBeenCalledOnce();
		expect(callbacks.refreshProjection).not.toHaveBeenCalled();
		expect(callbacks.clearDraggedTask).toHaveBeenCalledOnce();
		expect(callbacks.setIsPending).toHaveBeenLastCalledWith(false);
	});
});
