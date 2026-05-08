"use client";

import { useMemo } from "react";
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
    data,
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

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-[30px] border border-border/55 bg-white/60 p-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm">
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

      <div className="mt-3 grid min-h-0 flex-1 grid-cols-[minmax(220px,0.8fr)_minmax(0,1.45fr)_minmax(260px,1fr)] gap-4 overflow-hidden rounded-[24px] bg-slate-50/55 p-3">
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
