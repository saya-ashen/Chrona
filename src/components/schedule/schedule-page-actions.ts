import {
  acceptScheduleProposal,
  applySchedule,
  createTaskFromSchedule,
  rejectScheduleProposal,
  updateTaskConfigFromSchedule,
} from "@/app/actions/task-actions";
import {
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
  type SchedulePageCopy,
} from "@/components/schedule/schedule-page-copy";
import type {
  QuickCreateDraft,
  SchedulePageData,
  ScheduleSuggestion,
  ScheduleViewMode,
  ScheduledItem,
  TimelineCreateInput,
  TimelineDragItem,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import type { TaskPlanGraphResponse } from "@/modules/ai/types";
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
  toTimestamp,
} from "@/components/schedule/schedule-page-utils";
import type { TaskConfigFormInput } from "@/components/schedule/task-config-form";

export function getQuickCreateDefaults(data: SchedulePageData) {
  const selectedAdapter =
    data.runtimeAdapters.find(
      (adapter) => adapter.key === data.defaultRuntimeAdapterKey,
    ) ??
    data.runtimeAdapters[0] ??
    null;

  return {
    runtimeAdapterKey: selectedAdapter?.key ?? data.defaultRuntimeAdapterKey,
    runtimeInputVersion:
      selectedAdapter?.spec.version ?? `${data.defaultRuntimeAdapterKey}-v1`,
  };
}

export function getSuggestedDurationMinutes(
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
          draggedQueueItem.runtimeConfig as {
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

export function patchScheduledWindow(
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
    const response = await fetch(
      `/api/schedule/projection?workspaceId=${workspaceId}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(actionFailedMessage);
    }

    const next = hydrateSchedulePageData(
      (await response.json()) as SchedulePageData,
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
  setLocalSelectedTaskId,
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
  applyOptimisticViewData: (updater: (current: SchedulePageData) => SchedulePageData) => void;
  removeExpandedQueueTask: (taskId: string) => void;
  setLocalSelectedTaskId: (taskId: string) => void;
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
      applyOptimisticViewData((current) =>
        patchScheduledWindow(current, item.taskId, startAt, endAt, item.dueAt),
      );
      setLocalSelectedTaskId(item.taskId);
    }

    await applySchedule({
      taskId: item.taskId,
      dueAt: item.dueAt ?? null,
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
      scheduleSource: "human",
    });

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

export async function handleCreateTaskBlockAction({
  input,
  workspaceId,
  data,
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
}: {
  input: TimelineCreateInput;
  workspaceId: string;
  data: SchedulePageData;
  activeDay: string;
  activeView: ScheduleViewMode;
  locale: string;
  copy: SchedulePageCopy;
  applyOptimisticViewData: (updater: (current: SchedulePageData) => SchedulePageData) => void;
  setLocalSelectedTaskId: (taskId: string) => void;
  pushRoute: (href: string) => void;
  localizeHref: (locale: any, href: string) => string;
  buildScheduleViewHref: (...args: any[]) => string;
  setAnnouncement: (value: string) => void;
  setIsPending: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  refreshProjection: () => Promise<void>;
  resetViewData: () => void;
  actionFailedMessage: string;
}) {
  setAnnouncement(
    `Creating ${input.title} on ${formatDayHeading(input.scheduledStartAt, locale, copy)} at ${formatTime(input.scheduledStartAt, locale)}.`,
  );

  try {
    setIsPending(true);
    setErrorMessage(null);

    const created = await createTaskFromSchedule({
      workspaceId,
      title: input.title,
      description: input.description || null,
      priority: input.priority,
      dueAt: input.dueAt,
      runtimeAdapterKey: input.runtimeAdapterKey,
      runtimeInput: input.runtimeInput,
      runtimeInputVersion: input.runtimeInputVersion,
      runtimeModel: input.runtimeModel,
      prompt: input.prompt,
      runtimeConfig: input.runtimeConfig ?? null,
    });

    const createdItem = createScheduledItemFromCreateInput(
      created.taskId,
      workspaceId,
      data.defaultRuntimeAdapterKey,
      input,
    );

    await applySchedule({
      taskId: created.taskId,
      dueAt: input.dueAt,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      scheduleSource: "human",
    });

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

export async function handleQuickCreateAction({
  draft,
  data,
  handleCreateTaskBlock,
}: {
  draft: QuickCreateDraft;
  data: SchedulePageData;
  handleCreateTaskBlock: (input: TimelineCreateInput) => Promise<void>;
}) {
  const defaults = getQuickCreateDefaults(data);

  const input: TimelineCreateInput = {
    title: draft.title,
    description: "",
    priority: draft.priority,
    dueAt: draft.dueAt,
    runtimeAdapterKey: defaults.runtimeAdapterKey,
    runtimeInput: {},
    runtimeInputVersion: defaults.runtimeInputVersion,
    runtimeModel: null,
    prompt: null,
    runtimeConfig: null,
    scheduledStartAt: draft.scheduledStartAt ?? new Date(),
    scheduledEndAt:
      draft.scheduledEndAt ??
      new Date(
        (toTimestamp(draft.scheduledStartAt) ?? Date.now()) +
          DEFAULT_SCHEDULE_BLOCK_MINUTES * 60 * 1000,
      ),
  };

  await handleCreateTaskBlock(input);
}

export async function handleQueueQuickCreateAction({
  draft,
  workspaceId,
  data,
  setAnnouncement,
  setIsPending,
  setErrorMessage,
  refreshProjection,
  resetViewData,
  actionFailedMessage,
}: {
  draft: QuickCreateDraft & { durationMinutes: number };
  workspaceId: string;
  data: SchedulePageData;
  setAnnouncement: (value: string) => void;
  setIsPending: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  refreshProjection: () => Promise<void>;
  resetViewData: () => void;
  actionFailedMessage: string;
}) {
  const defaults = getQuickCreateDefaults(data);

  setAnnouncement(`Adding ${draft.title} to the queue.`);

  try {
    setIsPending(true);
    setErrorMessage(null);

    await createTaskFromSchedule({
      workspaceId,
      title: draft.title,
      description: null,
      priority: draft.priority,
      dueAt: draft.dueAt,
      runtimeAdapterKey: defaults.runtimeAdapterKey,
      runtimeInput: {},
      runtimeInputVersion: defaults.runtimeInputVersion,
      runtimeModel: null,
      prompt: null,
      runtimeConfig: {
        suggestedDurationMinutes: draft.durationMinutes,
      },
    });

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

export async function handleApplySuggestionAction({
  suggestion,
  workspaceId,
  setIsPending,
  setErrorMessage,
  refreshProjection,
  actionFailedMessage,
}: {
  suggestion: ScheduleSuggestion;
  workspaceId: string;
  setIsPending: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  refreshProjection: () => Promise<void>;
  actionFailedMessage: string;
}) {
  try {
    setIsPending(true);
    setErrorMessage(null);

    const response = await fetch("/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestionId: suggestion.id,
        changes: suggestion.changes,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to apply suggestion");
    }

    await refreshProjection();
  } catch (error) {
    setErrorMessage(
      error instanceof Error ? error.message : actionFailedMessage,
    );
  } finally {
    setIsPending(false);
  }
}

export async function handleTaskConfigSaveAction({
  taskId,
  input,
  applyOptimisticViewData,
  setIsPending,
  setErrorMessage,
  refreshProjection,
  resetViewData,
  actionFailedMessage,
}: {
  taskId: string;
  input: TaskConfigFormInput;
  applyOptimisticViewData: (updater: (current: SchedulePageData) => SchedulePageData) => void;
  setIsPending: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  refreshProjection: () => Promise<void>;
  resetViewData: () => void;
  actionFailedMessage: string;
}) {
  try {
    setIsPending(true);
    setErrorMessage(null);

    applyOptimisticViewData((current) => ({
      ...current,
      scheduled: current.scheduled.map((item) =>
        item.taskId === taskId ? applyTaskConfigToItem(item, input) : item,
      ),
      unscheduled: current.unscheduled.map((item) =>
        item.taskId === taskId ? applyTaskConfigToItem(item, input) : item,
      ),
      risks: current.risks.map((item) =>
        item.taskId === taskId ? applyTaskConfigToItem(item, input) : item,
      ),
      listItems: current.listItems.map((item) =>
        item.taskId === taskId ? applyTaskConfigToItem(item, input) : item,
      ),
    }));

    await updateTaskConfigFromSchedule({
      taskId,
      title: input.title,
      description: input.description || null,
      priority: input.priority,
      dueAt: input.dueAt,
      runtimeAdapterKey: input.runtimeAdapterKey,
      runtimeInput: input.runtimeInput,
      runtimeInputVersion: input.runtimeInputVersion,
      runtimeModel: input.runtimeModel,
      prompt: input.prompt,
      runtimeConfig: input.runtimeConfig ?? null,
    });

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

function planGraphResponseToProvidedSubtasks(result: TaskPlanGraphResponse) {
  const edgesByToNode = new Set(
    result.planGraph.edges
      .filter((edge) => edge.type === "sequential")
      .map((edge) => edge.toNodeId),
  );

  return [...result.planGraph.nodes]
    .sort((left, right) => {
      const leftOrder =
        typeof left.metadata?.order === "number"
          ? left.metadata.order
          : Number.MAX_SAFE_INTEGER;
      const rightOrder =
        typeof right.metadata?.order === "number"
          ? right.metadata.order
          : Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.title.localeCompare(right.title);
    })
    .map((node, index) => ({
      title: node.title,
      description: node.description ?? undefined,
      priority: node.priority ?? "Medium",
      estimatedMinutes: node.estimatedMinutes ?? 30,
      order:
        typeof node.metadata?.order === "number"
          ? node.metadata.order
          : index + 1,
      dependsOnPrevious: edgesByToNode.has(node.id),
    }));
}

export async function handleApplyDecompositionFromDialogAction({
  workspaceId,
  title,
  description,
  priority,
  dueAt,
  defaultRuntimeAdapterKey,
  result,
  activeDay,
  activeView,
  locale,
  pushRoute,
  localizeHref,
  buildScheduleViewHref,
  setShowQuickAddDialog,
  setLocalSelectedTaskId,
  setIsPending,
  setErrorMessage,
  refreshProjection,
  actionFailedMessage,
}: {
  workspaceId: string;
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  dueAt: Date | null;
  defaultRuntimeAdapterKey: string;
  result: TaskPlanGraphResponse;
  activeDay: string;
  activeView: ScheduleViewMode;
  locale: string;
  pushRoute: (href: string) => void;
  localizeHref: (locale: any, href: string) => string;
  buildScheduleViewHref: (...args: any[]) => string;
  setShowQuickAddDialog: (value: boolean) => void;
  setLocalSelectedTaskId: (taskId: string) => void;
  setIsPending: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  refreshProjection: () => Promise<void>;
  actionFailedMessage: string;
}) {
  setIsPending(true);
  setErrorMessage(null);

  try {
    const created = await createTaskFromSchedule({
      workspaceId,
      title,
      description: description || null,
      priority,
      dueAt,
      runtimeAdapterKey: defaultRuntimeAdapterKey,
      runtimeInput: {},
      runtimeInputVersion: `${defaultRuntimeAdapterKey}-v1`,
      runtimeModel: null,
      prompt: null,
      runtimeConfig: null,
    });

    const response = await fetch("/api/ai/batch-decompose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: created.taskId,
        replaceExisting: true,
        subtasks: planGraphResponseToProvidedSubtasks(result),
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to apply decomposition");
    }

    setShowQuickAddDialog(false);
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
  } finally {
    setIsPending(false);
  }
}
