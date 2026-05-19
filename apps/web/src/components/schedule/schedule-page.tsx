"use client";

import { useEffect, useMemo } from "react";
import { useAssistantSurface } from "@/components/assistant-surface/assistant-surface-provider";
import type {
  SchedulePageProps,
} from "@/components/schedule/schedule-page-types";
import {
  buildScheduleHref,
  buildScheduleViewHref,
} from "@/components/schedule/schedule-page-utils";
import { getQuickCreateDefaults } from "@/components/schedule/schedule-page-actions";
import { buildSchedulePageViewModel } from "@/components/schedule/schedule-page-view-model";
import { SchedulePageHeader } from "@/components/schedule/schedule-page-main-panel";
import { SchedulePageMainPanel } from "@/components/schedule/schedule-page-main-panel";
import { SchedulePageDialogs } from "@/components/schedule/dialogs/schedule-page-dialogs";
import { SelectedBlockSheet } from "@/components/schedule/panels/schedule-page-panels";

import { ScheduleLeftSidebar, ScheduleRightSidebar } from "@/components/schedule/panels/schedule-page-sidebar";
import { getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import { useI18n, useLocale } from "@/i18n/client";
import { localizeHref } from "@/i18n/routing";
import { useAppRouter } from "@/lib/router";
import { useSchedulePageActions } from "./use-schedule-page-actions";
import { useSchedulePageState } from "./use-schedule-page-state";
import { createScheduleAiSidebarContext } from "./adapters/schedule-ai-sidebar-adapter";

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
  showNewTask,
}: SchedulePageRouteProps) {
  const { pendingProposal, registerHandlers, setPageContext } = useAssistantSurface();
  const router = useAppRouter();
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = useMemo(
    () => getSchedulePageCopy(messages.components?.schedulePage),
    [messages.components?.schedulePage],
  );

  const actionFailedMessage =
    messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed";
  const {
    hydratedData,
    viewData,
    setViewData,
    draggedTask,
    setDraggedTask,
    expandedQueueTaskIds,
    setExpandedQueueTaskIds,
    localSelectedTaskId,
    setLocalSelectedTaskId,
    errorMessage,
    setErrorMessage,
    announcement,
    setAnnouncement,
    isPending,
    setIsPending,
    secondaryView,
    showNewTaskDialog,
    setShowNewTaskDialog,
    activeView,
    refreshProjection,
  } = useSchedulePageState({
    workspaceId,
    data,
    selectedTaskId,
    selectedView,
    showNewTask,
    actionFailedMessage,
    routerRefresh: router.refresh,
  });

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
  const {
    draggedItem,
    handleQueueDragStart,
    handleQueueDragEnd,
    handleScheduledDragStart,
    handleScheduleDrop,
    handleCreateTaskBlock,
    toggleQueueCard,
    handleTaskConfigSave,
    handleDeleteTask,
  } = useSchedulePageActions({
    workspaceId,
    hydratedData,
    viewData,
    activeView,
    activeDay: viewModel.activeDay,
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
    pushRoute: router.push,
    localizeHref,
    actionFailedMessage,
    isPending,
    activeGroupItems: viewModel.activeGroup?.items ?? [],
  });

  const dialogDefaults = getQuickCreateDefaults(data);

  useEffect(() => {
    const { context, actions } = createScheduleAiSidebarContext({
      workspaceId,
      data: viewData,
      selectedDate: viewModel.activeDay,
      activeView,
    });
    setPageContext(context, actions);
    return registerHandlers({
      onConfirmProposal: refreshProjection,
    });
  }, [activeView, refreshProjection, registerHandlers, setPageContext, viewData, viewModel.activeDay, workspaceId]);

  return (
    <div className="relative flex h-full flex-col overflow-x-hidden overflow-y-auto rounded-[30px] border border-border/55 bg-white/70 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:p-3">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <SchedulePageHeader
        copy={copy}
        locale={locale}
        activeView={activeView}
        viewData={viewData}
        viewModel={viewModel}
        onNavigate={(href) => router.push(href)}
        localizeHref={localizeHref}
        buildScheduleViewHref={buildScheduleViewHref}
      />

      {errorMessage ? (
        <div className="mx-2 mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shadow-sm">
          Error: {errorMessage}
        </div>
      ) : null}

      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-visible rounded-[24px] bg-slate-50/70 p-2 lg:gap-4 lg:p-3 xl:grid-cols-[minmax(210px,0.72fr)_minmax(0,1.7fr)_minmax(260px,0.9fr)] xl:overflow-hidden">
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
          ghostPreview={pendingProposal?.kind === "schedule" ? pendingProposal.schedulePreview ?? null : null}
          executionRuntimes={data.executionRuntimes}
          defaultExecutionRuntime={data.defaultExecutionRuntime}
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
          executionRuntimes={data.executionRuntimes}
          defaultExecutionRuntime={data.defaultExecutionRuntime}
          isPending={isPending}
          onClose={() => {
            setLocalSelectedTaskId(undefined);
            router.push(
              localizeHref(
                locale,
                buildScheduleViewHref(viewModel.activeDay, activeView),
              ),
            );
          }}
          onSaveTaskConfigAction={handleTaskConfigSave}
          onDeleteTask={handleDeleteTask}
          onMutatedAction={refreshProjection}
          buildScheduleHref={buildScheduleHref}
        />
      ) : null}

      <SchedulePageDialogs
        showQuickAddDialog={showNewTaskDialog}
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
        onCloseQuickAdd={() => setShowNewTaskDialog(false)}
        handleCreateTaskBlock={handleCreateTaskBlock}
      />
    </div>
  );
}
