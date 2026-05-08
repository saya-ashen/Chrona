"use client";

import type { Dispatch, DragEvent, SetStateAction } from "react";
import type {
  SchedulePageData,
  SchedulePageProps,
  ScheduleViewMode,
  ScheduledItem,
  TimelineCreateInput,
  TimelineDragItem,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import { buildScheduleViewHref } from "@/components/schedule/schedule-page-utils";
import {
  buildDraggedItem,
  handleCreateTaskBlockAction,
  handleScheduleDropAction,
  handleTaskConfigSaveAction,
  runSchedulePageAction,
} from "@/components/schedule/schedule-page-actions";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { TaskConfigFormInput } from "@/components/schedule/task-config-form";
import { api } from "@/lib/rpc-client";

type DraggedTask = {
  kind: "queue" | "scheduled";
  taskId: string;
} | null;

type UseSchedulePageActionsArgs = {
  workspaceId: string;
  data: SchedulePageProps["data"];
  hydratedData: SchedulePageData;
  viewData: SchedulePageData;
  activeView: ScheduleViewMode;
  activeDay: string;
  locale: string;
  copy: SchedulePageCopy;
  draggedTask: DraggedTask;
  setDraggedTask: Dispatch<SetStateAction<DraggedTask>>;
  setViewData: Dispatch<SetStateAction<SchedulePageData>>;
  setExpandedQueueTaskIds: Dispatch<SetStateAction<string[]>>;
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
  data,
  hydratedData,
  viewData,
  activeView,
  activeDay,
  locale,
  copy,
  draggedTask,
  setDraggedTask,
  setViewData,
  setExpandedQueueTaskIds,
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
      ? (viewData.unscheduled.find((item) => item.taskId === draggedTask.taskId) ?? null)
      : null;

  const draggedItem = buildDraggedItem({
    draggedTask,
    unscheduled: viewData.unscheduled,
    activeGroupItems,
  });

  function handleQueueDragStart(item: UnscheduledItem, event: DragEvent<HTMLElement>) {
    if (isPending) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.taskId);
    event.dataTransfer.setDragImage(document.createElement("img"), 0, 0);
    setDraggedTask({ kind: "queue", taskId: item.taskId });
    setErrorMessage(null);
    setAnnouncement(`Picked up ${item.title}. Move it to the timeline to create a block.`);
  }

  function handleQueueDragEnd() {
    setDraggedTask(null);
  }

  function handleScheduledDragStart(item: ScheduledItem) {
    setDraggedTask({ kind: "scheduled", taskId: item.taskId });
    setErrorMessage(null);
    setAnnouncement(`Picked up scheduled block ${item.title}. Drop it on a new slot to move the block.`);
  }

  async function handleScheduleDrop(item: NonNullable<TimelineDragItem>, startAt: Date, endAt: Date) {
    await handleScheduleDropAction({
      item,
      startAt,
      endAt,
      draggedQueueItem,
      locale,
      copy,
      applyOptimisticViewData: (updater) => setViewData(updater),
      removeExpandedQueueTask: (taskId) =>
        setExpandedQueueTaskIds((current) => current.filter((value) => value !== taskId)),
      _setLocalSelectedTaskId: setLocalSelectedTaskId as (taskId: string) => void,
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
      data,
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
    });
  }

  function toggleQueueCard(taskId: string) {
    setExpandedQueueTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
  }

  async function handleTaskConfigSave(taskId: string, input: TaskConfigFormInput) {
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
        const res = await api.tasks[":taskId"].$delete({ param: { taskId }, query: {} });
        if (!res.ok) {
          throw new Error(actionFailedMessage);
        }
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
    toggleQueueCard,
    handleTaskConfigSave,
    handleDeleteTask,
  };
}
