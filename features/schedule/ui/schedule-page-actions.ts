import {
  applySchedule,
  clearSchedule,
  createScheduledTask,
  moveWorkBlock,
  updateTaskConfigFromSchedule,
} from "./schedule-actions";
import {
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
  type SchedulePageCopy,
} from "./schedule-page-copy";
import type {
  SchedulePageData,
  ScheduleViewMode,
  ScheduledItem,
  TimelineCreateInput,
  TimelineDragItem,
  UnscheduledItem,
} from "./schedule-page-types";
import {
  applyScheduleToListItem,
  applyTaskConfigToItem,
  createListItemFromScheduledItem,
  createScheduledItemFromCreateInput,
  createScheduledItemFromQueueItem,
  formatDayHeading,
  formatTime,
  getBlockDurationMinutes,
  hydrateSchedulePageData,
  sortScheduledItems,
} from "./schedule-page-utils";
import type { Locale } from "@chrona/i18n";
import { apiJson } from "@shared/http";
import {
  buildScheduleTaskConfigSaveRequest,
  type ScheduleTaskConfigSaveContext,
} from "./forms/task-config-save";
import type { TaskConfigFormInput } from "./forms/task-config-form";

function getSuggestedDurationMinutes(
  value: unknown,
  fallback = DEFAULT_SCHEDULE_BLOCK_MINUTES,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(15, Math.round(value / 15) * 15);
}

export function buildDraggedItem({
  draggedTask,
  unscheduled,
  activeGroupItems,
}: {
  draggedTask: { kind: TimelineDragItem["kind"]; taskId: string } | null;
  unscheduled: UnscheduledItem[];
  activeGroupItems: ScheduledItem[];
}): TimelineDragItem | null {
  const draggedQueueItem =
    draggedTask?.kind === "queue"
      ? (unscheduled.find((item) => item.taskId === draggedTask.taskId) ?? null)
      : null;
  const draggedScheduledItem =
    draggedTask?.kind === "scheduled"
      ? (activeGroupItems.find((item) => item.taskId === draggedTask.taskId) ??
        null)
      : null;

  if (draggedQueueItem) {
    return {
      kind: "queue",
      taskId: draggedQueueItem.taskId,
      title: draggedQueueItem.title,
      dueAt: draggedQueueItem.dueAt,
      durationMinutes: getSuggestedDurationMinutes(
        (
          draggedQueueItem.executionConfig as {
            suggestedDurationMinutes?: unknown;
          } | null
        )?.suggestedDurationMinutes,
      ),
    };
  }

  if (draggedScheduledItem) {
    return {
      kind: "scheduled",
      taskId: draggedScheduledItem.taskId,
      title: draggedScheduledItem.title,
      dueAt: draggedScheduledItem.dueAt,
      durationMinutes: getBlockDurationMinutes(draggedScheduledItem),
    };
  }

  return null;
}

function patchScheduledWindow(
  current: SchedulePageData,
  taskId: string,
  startAt: Date,
  endAt: Date,
  dueAt?: Date | null,
): SchedulePageData {
  return {
    ...current,
    scheduled: sortScheduledItems(
      current.scheduled.map((item) =>
        item.taskId === taskId
          ? {
              ...item,
              dueAt: dueAt ?? item.dueAt,
              scheduledStartAt: startAt,
              scheduledEndAt: endAt,
              scheduleStatus: "Scheduled",
              scheduleSource: "human",
            }
          : item,
      ),
    ),
    listItems: current.listItems.map((item) =>
      item.taskId === taskId
        ? applyScheduleToListItem(item, startAt, endAt)
        : item,
    ),
  };
}

function patchWorkBlockWindow(
  current: SchedulePageData,
  workBlockId: string,
  startAt: Date,
  endAt: Date,
): SchedulePageData {
  return {
    ...current,
    scheduled: sortScheduledItems(
      current.scheduled.map((item) =>
        item.workBlockId === workBlockId
          ? {
              ...item,
              scheduledStartAt: startAt,
              scheduledEndAt: endAt,
            }
          : item,
      ),
    ),
  };
}

export async function refreshScheduleProjection({
  workspaceId,
  setViewData,
  routerRefresh,
  actionFailedMessage,
  requestIdRef,
}: {
  workspaceId: string;
  setViewData: (next: SchedulePageData) => void;
  routerRefresh: () => void;
  actionFailedMessage: string;
  requestIdRef: { current: number };
}) {
  const requestId = ++requestIdRef.current;

  try {
    const next = hydrateSchedulePageData(
      await apiJson<SchedulePageData>(
        `/api/schedule?${new URLSearchParams({ workspaceId })}`,
      ),
    );


    if (requestId !== requestIdRef.current) {
      return;
    }

    setViewData(next);
  } catch (error) {
    routerRefresh();
    throw error instanceof Error ? error : new Error(actionFailedMessage);
  }
}

export async function runSchedulePageAction({
  action,
  setIsPending,
  setErrorMessage,
  refreshProjection,
  actionFailedMessage,
}: {
  action: () => Promise<void>;
  setIsPending: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  refreshProjection: () => Promise<void>;
  actionFailedMessage: string;
}) {
  try {
    setIsPending(true);
    setErrorMessage(null);
    await action();
    await refreshProjection();
  } catch (error) {
    setErrorMessage(
      error instanceof Error ? error.message : actionFailedMessage,
    );
  } finally {
    setIsPending(false);
  }
}

export async function handleScheduleDropAction({
  item,
  startAt,
  endAt,
  draggedQueueItem,
  locale,
  copy,
  applyOptimisticViewData,
  removeExpandedQueueTask,
  _setLocalSelectedTaskId,
  setAnnouncement,
  setIsPending,
  setErrorMessage,
  refreshProjection,
  resetViewData,
  clearDraggedTask,
  actionFailedMessage,
}: {
  item: TimelineDragItem;
  startAt: Date;
  endAt: Date;
  draggedQueueItem: UnscheduledItem | null;
  locale: string;
  copy: SchedulePageCopy;
  applyOptimisticViewData: (
    updater: (current: SchedulePageData) => SchedulePageData,
  ) => void;
  removeExpandedQueueTask: (taskId: string) => void;
  _setLocalSelectedTaskId: (taskId: string) => void;
  setAnnouncement: (value: string) => void;
  setIsPending: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  refreshProjection: () => Promise<void>;
  resetViewData: () => void;
  clearDraggedTask: () => void;
  actionFailedMessage: string;
}) {
  setAnnouncement(
    `Dropped ${item.title} on ${formatDayHeading(startAt, locale, copy)} at ${formatTime(startAt, locale)}.`,
  );

  try {
    setIsPending(true);
    setErrorMessage(null);

    if (item.kind === "queue" && draggedQueueItem) {
      applyOptimisticViewData((current) => ({
        ...current,
        summary: {
          ...current.summary,
          scheduledCount: current.summary.scheduledCount + 1,
          unscheduledCount: Math.max(0, current.summary.unscheduledCount - 1),
        },
        scheduled: sortScheduledItems([
          ...current.scheduled,
          createScheduledItemFromQueueItem(draggedQueueItem, startAt, endAt),
        ]),
        unscheduled: current.unscheduled.filter(
          (queueItem) => queueItem.taskId !== draggedQueueItem.taskId,
        ),
        listItems: current.listItems.map((listItem) =>
          listItem.taskId === draggedQueueItem.taskId
            ? applyScheduleToListItem(listItem, startAt, endAt)
            : listItem,
        ),
      }));
      removeExpandedQueueTask(draggedQueueItem.taskId);
    }

    if (item.kind === "scheduled") {
      if (item.workBlockId) {
        applyOptimisticViewData((current) =>
          patchWorkBlockWindow(current, item.workBlockId!, startAt, endAt),
        );
      } else {
        applyOptimisticViewData((current) =>
          patchScheduledWindow(current, item.taskId, startAt, endAt, item.dueAt),
        );
      }
    }

    if (item.kind === "scheduled" && item.workBlockId) {
      await moveWorkBlock({
        workBlockId: item.workBlockId,
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
      });
    } else {
      await applySchedule({
        taskId: item.taskId,
        dueAt: item.dueAt ?? null,
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        scheduleSource: "human",
      });
    }

    await refreshProjection();
  } catch (error) {
    setErrorMessage(
      error instanceof Error ? error.message : actionFailedMessage,
    );
    resetViewData();
  } finally {
    setIsPending(false);
    clearDraggedTask();
  }
}

type ScheduleViewHrefBuilder = (
  day: string,
  view: ScheduleViewMode,
  taskId?: string,
) => string;

export async function handleCreateTaskBlockAction({
  input,
  workspaceId,
  activeDay,
  activeView,
  locale,
  copy,
  applyOptimisticViewData,
  setLocalSelectedTaskId,
  pushRoute,
  localizeHref,
  buildScheduleViewHref,
  setAnnouncement,
  setIsPending,
  setErrorMessage,
  refreshProjection,
  resetViewData,
  actionFailedMessage,
  autoPlanGenerationEnabled,
}: {
  input: TimelineCreateInput;
  workspaceId: string;
  activeDay: string;
  activeView: ScheduleViewMode;
  locale: Locale;
  copy: SchedulePageCopy;
  applyOptimisticViewData: (
    updater: (current: SchedulePageData) => SchedulePageData,
  ) => void;
  setLocalSelectedTaskId: (taskId: string) => void;
  pushRoute: (href: string) => void;
  localizeHref: (locale: Locale | undefined, href: string) => string;
  buildScheduleViewHref: ScheduleViewHrefBuilder;
  setAnnouncement: (value: string) => void;
  setIsPending: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  refreshProjection: () => Promise<void>;
  resetViewData: () => void;
  actionFailedMessage: string;
  autoPlanGenerationEnabled: boolean;
}) {
  setAnnouncement(
    `Creating ${input.title} on ${formatDayHeading(input.scheduledStartAt, locale, copy)} at ${formatTime(input.scheduledStartAt, locale)}.`,
  );

  try {
    setIsPending(true);
    setErrorMessage(null);

    const created = await createScheduledTask({
      workspaceId,
      title: input.title,
      description: input.description || null,
      priority: input.priority,
      taskExecutionMode: input.taskExecutionMode,
      autoPlanGeneration: autoPlanGenerationEnabled || input.autoExecute,
      autoExecute: input.autoExecute,
      autoPlanGenerationTiming: input.autoPlanGenerationTiming,
      autoExecuteTiming: input.autoExecuteTiming,
      executionConfig: input.taskExecutionMode === "manual" ? undefined : input.executionConfig,
      aiClientId: input.aiClientId,
      dueAt: input.dueAt,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      recurrenceRule: input.taskExecutionMode === "manual" ? null : input.recurrenceRule ?? null,
      recurrenceAnchorStartAt: input.taskExecutionMode === "manual" ? null : input.recurrenceAnchorStartAt ?? null,
      recurrenceAnchorEndAt: input.taskExecutionMode === "manual" ? null : input.recurrenceAnchorEndAt ?? null,
    });

    const createdItem = createScheduledItemFromCreateInput(
      created.taskId,
      workspaceId,
      input,
    );

    applyOptimisticViewData((current) => ({
      ...current,
      summary: {
        ...current.summary,
        scheduledCount: current.summary.scheduledCount + 1,
      },
      scheduled: sortScheduledItems([...current.scheduled, createdItem]),
      listItems: [
        ...current.listItems,
        createListItemFromScheduledItem(createdItem),
      ],
    }));
    setLocalSelectedTaskId(created.taskId);
    pushRoute(
      localizeHref(
        locale,
        buildScheduleViewHref(activeDay, activeView, created.taskId),
      ),
    );
    await refreshProjection();
  } catch (error) {
    setErrorMessage(
      error instanceof Error ? error.message : actionFailedMessage,
    );
    resetViewData();
  } finally {
    setIsPending(false);
  }
}

export async function handleTaskConfigSaveAction({
  task,
  input,
  applyOptimisticViewData,
  setIsPending,
  setErrorMessage,
  refreshProjection,
  resetViewData,
  actionFailedMessage,
}: {
  task: ScheduleTaskConfigSaveContext & { taskId: string };
  input: TaskConfigFormInput;
  applyOptimisticViewData: (
    updater: (current: SchedulePageData) => SchedulePageData,
  ) => void;
  setIsPending: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  refreshProjection: () => Promise<void>;
  resetViewData: () => void;
  actionFailedMessage: string;
}) {
  try {
    setIsPending(true);
    setErrorMessage(null);
    const save = buildScheduleTaskConfigSaveRequest(task, input);

    applyOptimisticViewData((current) => ({
      ...current,
      scheduled: current.scheduled.map((item) =>
        item.taskId === task.taskId ? applyTaskConfigToItem(item, input) : item,
      ),
      unscheduled: current.unscheduled.map((item) =>
        item.taskId === task.taskId ? applyTaskConfigToItem(item, input) : item,
      ),
      risks: current.risks.map((item) =>
        item.taskId === task.taskId ? applyTaskConfigToItem(item, input) : item,
      ),
      listItems: current.listItems.map((item) =>
        item.taskId === task.taskId ? applyTaskConfigToItem(item, input) : item,
      ),
    }));

    await updateTaskConfigFromSchedule({ taskId: task.taskId, ...save.taskBody });
    for (const command of save.scheduleCommands) {
      if (command.type === "clear") {
        await clearSchedule({ taskId: task.taskId });
      } else {
        await applySchedule({
          taskId: task.taskId,
          dueAt: command.dueAt,
          scheduledStartAt: command.scheduledStartAt,
          scheduledEndAt: command.scheduledEndAt,
          scheduleSource: "human",
        });
      }
    }

    await refreshProjection();
  } catch (error) {
    const message = error instanceof Error ? error.message : actionFailedMessage;
    setErrorMessage(message);
    resetViewData();
    // Let the shared form retain the editor and render its validation error.
    throw error instanceof Error ? error : new Error(message);
  } finally {
    setIsPending(false);
  }
}
