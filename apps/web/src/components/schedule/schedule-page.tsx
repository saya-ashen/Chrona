"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import type {
  SchedulePageData,
  SchedulePageProps,
  SecondaryPlanningView,
  QuickCreateDraft,
  ScheduledItem,
  TimelineCreateInput,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
// Note: SecondaryPlanningView still used by view model
import {
  buildScheduleHref,
  buildScheduleViewHref,
  hydrateSchedulePageData,
  normalizeScheduleView,
} from "@/components/schedule/schedule-page-utils";
import {
  getQuickCreateDefaults,
  handleApplyDecompositionFromDialogAction,
  handleApplySuggestionAction,
  handleCreateTaskBlockAction,
  handleQueueQuickCreateAction,
  handleScheduleDropAction,
  handleTaskConfigSaveAction,
  handleQuickCreateAction,
  refreshScheduleProjection,
  runSchedulePageAction,
  buildDraggedItem,
} from "@/components/schedule/schedule-page-actions";
import { buildSchedulePageViewModel } from "@/components/schedule/schedule-page-view-model";
import { SchedulePageHeader } from "@/components/schedule/schedule-page-main-panel";
import { SchedulePageMainPanel } from "@/components/schedule/schedule-page-main-panel";
import { ScheduleLeftSidebar, ScheduleRightSidebar } from "@/components/schedule/schedule-page-sidebar";
import { SchedulePageDialogs } from "@/components/schedule/schedule-page-dialogs";
import { SelectedBlockSheet } from "@/components/schedule/schedule-page-panels";
import { getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { TaskConfigFormInput } from "@/components/schedule/task-config-form";
import { getRuntimeAdapterDefinition } from "@chrona/runtime/modules/task-execution/registry";
import { useI18n, useLocale } from "@/i18n/client";
import { localizeHref } from "@/i18n/routing";
import { useAppRouter } from "@/lib/router";

type SchedulePageRouteProps = SchedulePageProps & {
  selectedDay?: string;
  selectedTaskId?: string;
  selectedView?: string;
};

export function SchedulePage({
  workspaceId,
  data,
  selectedDay,
  selectedTaskId,
  selectedView,
}: SchedulePageRouteProps) {
  const router = useAppRouter();
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = useMemo(
    () => getSchedulePageCopy(messages.components?.schedulePage),
    [messages.components?.schedulePage],
  );
  const hydratedData = useMemo(() => hydrateSchedulePageData(data), [data]);
  const [viewData, setViewData] = useState<SchedulePageData>(() => hydratedData);
  const [draggedTask, setDraggedTask] = useState<{
    kind: "queue" | "scheduled";
    taskId: string;
  } | null>(null);
  const [expandedQueueTaskIds, setExpandedQueueTaskIds] = useState<string[]>(
    [],
  );
  const [localSelectedTaskId, setLocalSelectedTaskId] = useState<
    string | undefined
  >(selectedTaskId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [secondaryView, setSecondaryView] =
    useState<SecondaryPlanningView>("queue");
  const [showQuickAddDialog, setShowQuickAddDialog] = useState(false);
  const refreshRequestIdRef = useRef(0);
  const activeView = normalizeScheduleView(selectedView);

  const canBackendAutoRun = useCallback((taskId: string) => {
    const item = viewData.listItems.find((entry) => entry.taskId === taskId)
      ?? viewData.scheduled.find((entry) => entry.taskId === taskId)
      ?? viewData.unscheduled.find((entry) => entry.taskId === taskId)
      ?? null;
    const runtimeKey =
      item?.runtimeAdapterKey
      ?? (typeof (item?.runtimeInput as { adapterKey?: unknown } | undefined)?.adapterKey === "string"
        ? String((item?.runtimeInput as { adapterKey?: unknown }).adapterKey)
        : null);
    if (!runtimeKey) {
      return false;
    }

    try {
      return getRuntimeAdapterDefinition(runtimeKey).key === "openclaw";
    } catch {
      return false;
    }
  }, [viewData.listItems, viewData.scheduled, viewData.unscheduled]);
  const actionFailedMessage =
    messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed";

  const refreshProjection = useCallback(async () => {
    await refreshScheduleProjection({
      workspaceId,
      setViewData: (next) => startTransition(() => setViewData(next)),
      routerRefresh: router.refresh,
      actionFailedMessage,
      requestIdRef: refreshRequestIdRef,
    });
  }, [actionFailedMessage, router, workspaceId]);

  useEffect(() => {
    setViewData(hydratedData);
  }, [hydratedData]);

  useEffect(() => {
    setLocalSelectedTaskId(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    setSecondaryView((current) => {
      if (current === "queue" && viewData.unscheduled.length > 0) {
        return current;
      }
      if (current === "risks" && viewData.risks.length > 0) {
        return current;
      }
      if (current === "proposals" && viewData.proposals.length > 0) {
        return current;
      }
      if (current === "conflicts" && viewData.conflicts.length > 0) {
        return current;
      }
      if (viewData.risks.length > 0) {
        return "risks";
      }
      if (viewData.unscheduled.length > 0) {
        return "queue";
      }
      if (viewData.proposals.length > 0) {
        return "proposals";
      }
      if (viewData.conflicts.length > 0) {
        return "conflicts";
      }
      return "queue";
    });
  }, [
    viewData.conflicts.length,
    viewData.proposals.length,
    viewData.risks.length,
    viewData.unscheduled.length,
  ]);

  const viewModel = useMemo(
    () =>
      buildSchedulePageViewModel({
        viewData,
        selectedDay,
        selectedTaskId,
        localSelectedTaskId,
        activeView,
        secondaryView,
        locale,
        copy,
      }),
    [
      activeView,
      copy,
      locale,
      localSelectedTaskId,
      secondaryView,
      selectedDay,
      selectedTaskId,
      viewData,
    ],
  );

  const draggedQueueItem =
    draggedTask?.kind === "queue"
      ? (viewData.unscheduled.find(
          (item) => item.taskId === draggedTask.taskId,
        ) ?? null)
      : null;
  const draggedItem = useMemo(
    () =>
      buildDraggedItem({
        draggedTask,
        unscheduled: viewData.unscheduled,
        activeGroupItems: viewModel.activeGroup?.items ?? [],
      }),
    [draggedTask, viewData.unscheduled, viewModel.activeGroup?.items],
  );

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
    item: NonNullable<typeof draggedItem>,
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
      removeExpandedQueueTask: (taskId) =>
        setExpandedQueueTaskIds((current) =>
          current.filter((value) => value !== taskId),
        ),
      setLocalSelectedTaskId,
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
      activeDay: viewModel.activeDay,
      activeView,
      locale,
      copy,
      applyOptimisticViewData: (updater) => setViewData(updater),
      setLocalSelectedTaskId,
      pushRoute: router.push,
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

  async function handleQuickCreate(draft: QuickCreateDraft) {
    await handleQuickCreateAction({
      draft,
      data,
      handleCreateTaskBlock,
    });
  }

  async function handleQueueQuickCreate(
    draft: QuickCreateDraft & { durationMinutes: number },
  ) {
    await handleQueueQuickCreateAction({
      draft,
      workspaceId,
      data,
      setAnnouncement,
      setIsPending,
      setErrorMessage,
      refreshProjection,
      resetViewData: () => setViewData(hydratedData),
      actionFailedMessage,
    });
  }

  async function handleAcceptProposal(proposalId: string) {
    await runSchedulePageAction({
      action: async () => {
        const response = await fetch("/api/schedule/proposals/decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposalId,
            decision: "Accepted",
            resolutionNote: "Accepted on schedule page",
          }),
        });

        if (!response.ok) {
          throw new Error(actionFailedMessage);
        }
      },
      setIsPending,
      setErrorMessage,
      refreshProjection,
      actionFailedMessage,
    });
  }

  async function handleRejectProposal(proposalId: string) {
    await runSchedulePageAction({
      action: async () => {
        const response = await fetch("/api/schedule/proposals/decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposalId,
            decision: "Rejected",
            resolutionNote: "Rejected on schedule page",
          }),
        });

        if (!response.ok) {
          throw new Error(actionFailedMessage);
        }
      },
      setIsPending,
      setErrorMessage,
      refreshProjection,
      actionFailedMessage,
    });
  }

  async function handleApplySuggestion(
    suggestion: (typeof viewData.suggestions)[number],
  ) {
    await handleApplySuggestionAction({
      suggestion,
      workspaceId,
      setIsPending,
      setErrorMessage,
      refreshProjection,
      actionFailedMessage,
    });
  }

  function toggleQueueCard(taskId: string) {
    setExpandedQueueTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );
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

  async function handleRunAutomationCandidate(taskId: string) {
    await runSchedulePageAction({
      action: async () => {
        if (!canBackendAutoRun(taskId)) {
          throw new Error(copy.automationUnsupportedRuntime);
        }
        const response = await fetch(`/api/tasks/${taskId}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          throw new Error(actionFailedMessage);
        }
      },
      setIsPending,
      setErrorMessage,
      refreshProjection,
      actionFailedMessage,
    });
  }

  async function handleDeleteTask(taskId: string) {
    await runSchedulePageAction({
      action: async () => {
        const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
        if (!response.ok) {
          throw new Error(actionFailedMessage);
        }
      },
      setIsPending,
      setErrorMessage,
      refreshProjection,
      actionFailedMessage,
    });
  }

  const dialogDefaults = getQuickCreateDefaults(data);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <SchedulePageHeader
        copy={copy}
        locale={locale}
        activeView={activeView}
        viewData={viewData}
        viewModel={viewModel}
        onOpenQuickAdd={() => setShowQuickAddDialog(true)}
        localizeHref={localizeHref}
        buildScheduleViewHref={buildScheduleViewHref}
      />

      {errorMessage ? (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Error: {errorMessage}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-4 pb-4 pt-3">
        <ScheduleLeftSidebar
          locale={locale}
          activeView={activeView}
          viewModel={viewModel}
          localizeHref={localizeHref}
          buildScheduleViewHref={buildScheduleViewHref}
        />

        <SchedulePageMainPanel
          copy={copy}
          activeView={activeView}
          draggedItem={draggedItem}
          activeGroup={viewModel.activeGroup}
          activeSelectedTaskId={viewModel.activeSelectedTaskId}
          conflictTaskIds={viewModel.conflictTaskIds}
          listItems={viewData.listItems}
          runtimeAdapters={data.runtimeAdapters}
          defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
          isPending={isPending}
          onScheduleDrop={handleScheduleDrop}
          onCreateTaskBlock={handleCreateTaskBlock}
          onScheduledDragStart={handleScheduledDragStart}
          onDragEnd={handleQueueDragEnd}
          onSaveTaskConfigAction={handleTaskConfigSave}
        />

        <ScheduleRightSidebar
          copy={copy}
          viewData={viewData}
          data={data}
          draggedTask={draggedTask}
          expandedQueueTaskIds={expandedQueueTaskIds}
          isPending={isPending}
          refreshProjection={refreshProjection}
          toggleQueueCard={toggleQueueCard}
          handleTaskConfigSave={handleTaskConfigSave}
          handleQueueDragStart={handleQueueDragStart}
          handleQueueDragEnd={handleQueueDragEnd}
          onDeleteTask={handleDeleteTask}
        />
      </div>

      {activeView === "timeline" &&
      viewModel.selectedItem &&
      viewModel.activeDay ? (
        <SelectedBlockSheet
          item={viewModel.selectedItem}
          selectedDay={viewModel.activeDay}
          runtimeAdapters={data.runtimeAdapters}
          defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
          isPending={isPending}
          onSaveTaskConfigAction={handleTaskConfigSave}
          onMutatedAction={refreshProjection}
          buildScheduleHref={buildScheduleHref}
        />
      ) : null}

      <SchedulePageDialogs
        showQuickAddDialog={showQuickAddDialog}
        isPending={isPending}
        dialogDefaults={dialogDefaults}
        data={data}
        viewModel={viewModel}
        activeView={activeView}
        workspaceId={workspaceId}
        routerPush={router.push}
        locale={locale}
        localizeHref={localizeHref}
        buildScheduleViewHref={buildScheduleViewHref}
        actionFailedMessage={actionFailedMessage}
        onCloseQuickAdd={() => setShowQuickAddDialog(false)}
        handleCreateTaskBlock={handleCreateTaskBlock}
        handleApplyDecompositionFromDialog={async ({
          result,
          title,
          description,
          priority,
          dueAt,
        }) => {
          await handleApplyDecompositionFromDialogAction({
            workspaceId,
            title,
            description,
            priority,
            dueAt,
            defaultRuntimeAdapterKey: data.defaultRuntimeAdapterKey,
            result,
            activeDay: viewModel.activeDay,
            activeView,
            locale,
            pushRoute: router.push,
            localizeHref,
            buildScheduleViewHref,
            setShowQuickAddDialog,
            setLocalSelectedTaskId,
            setIsPending,
            setErrorMessage,
            refreshProjection,
            actionFailedMessage,
          });
        }}
      />
    </div>
  );
}
