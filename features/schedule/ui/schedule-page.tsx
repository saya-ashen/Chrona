"use client";

import { useEffect, useMemo, useState } from "react";
import { projectPlanningBusyBlocks, type PlanningBusyBlock } from "@chrona/domain";
import { useAssistantSurface } from "@/components/assistant-surface/assistant-surface-provider";
import type {
  SchedulePageProps,
} from "./schedule-page-types";
import {
  buildScheduleHref,
  buildScheduleViewHref,
} from "./schedule-page-utils";
import { getQuickCreateDefaults } from "./schedule-page-actions";
import { buildSchedulePageViewModel } from "./schedule-page-view-model";
import { SchedulePageHeader } from "./schedule-page-main-panel";
import { SchedulePageMainPanel } from "./schedule-page-main-panel";
import { SchedulePageDialogs } from "./dialogs/schedule-page-dialogs";
import { CalendarSourceSetup, listExternalCalendarEvents } from "../../external-calendar";
import { SelectedBlockSheet } from "./panels/schedule-page-panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ScheduleRightSidebar } from "./panels/schedule-page-sidebar";
import { getSchedulePageCopy } from "./schedule-page-copy";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { localizeHref } from "@chrona/i18n";
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
    () => getSchedulePageCopy(messages.components.schedulePage),
    [messages.components.schedulePage],
  );
  const [externalEvents, setExternalEvents] = useState<PlanningBusyBlock[]>([]);
  const [externalEventsRefreshKey, setExternalEventsRefreshKey] = useState(0);

  const actionFailedMessage = messages.components.scheduleEditorForm.actionFailed;
  const {
    hydratedData,
    viewData,
    setViewData,
    draggedTask,
    setDraggedTask,
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

  useEffect(() => {
    let cancelled = false;
    const start = new Date(`${viewModel.activeDay}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    listExternalCalendarEvents(workspaceId, start.toISOString(), end.toISOString())
      .then(({ events }) => {
        if (cancelled) return;
        setExternalEvents(projectPlanningBusyBlocks({
          events,
          scheduledBlocks: (viewModel.activeGroup?.items ?? [])
            .filter((item) => item.scheduledStartAt && item.scheduledEndAt)
            .map((item) => ({
              id: item.taskId,
              startsAt: item.scheduledStartAt as Date,
              endsAt: item.scheduledEndAt as Date,
            })),
        }));
      })
      .catch(() => {
        if (!cancelled) setExternalEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [externalEventsRefreshKey, viewModel.activeDay, viewModel.activeGroup?.items, workspaceId]);

  useEffect(() => {
    function refreshExternalEvents() {
      setExternalEventsRefreshKey((key) => key + 1);
    }

    window.addEventListener("chrona:external-calendar-source-created", refreshExternalEvents);
    return () => {
      window.removeEventListener("chrona:external-calendar-source-created", refreshExternalEvents);
    };
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-x-hidden overflow-y-auto rounded-[2rem] border border-border bg-surface-soft/80 p-3 sm:p-4">
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
        onScheduleTask={() => setShowNewTaskDialog(true)}
      />


      {errorMessage ? (
        <div className="mx-2 mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-sm">
          {copy.errorPrefix}: {errorMessage}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-3 overflow-visible rounded-[1.75rem] bg-card p-3 lg:gap-4 lg:p-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.42fr)] xl:overflow-hidden">

        <SchedulePageMainPanel
          locale={locale}
          copy={copy}
          activeView={activeView}
          draggedItem={draggedItem}
          activeGroup={viewModel.activeGroup}
          activeSelectedTaskId={viewModel.activeSelectedTaskId}
          conflictTaskIds={viewModel.conflictTaskIds}
          ghostPreview={pendingProposal?.kind === "schedule" ? pendingProposal.schedulePreview ?? null : null}
          externalEvents={externalEvents}
          executionRuntimes={data.executionRuntimes}
          defaultExecutionRuntime={data.defaultExecutionRuntime}
          readyCount={viewModel.display.planningDrawer.readyCount}
          onScheduleTask={() => setShowNewTaskDialog(true)}
          availableAiClients={data.availableAiClients}
          isPending={isPending}
          onScheduleDrop={handleScheduleDrop}
          onCreateTaskBlock={handleCreateTaskBlock}
          onScheduledDragStart={handleScheduledDragStart}
          onDragEnd={handleQueueDragEnd}
          onSelectTask={setLocalSelectedTaskId}
        />

        <div className="min-h-0 overflow-visible xl:overflow-hidden">
          <Tabs defaultValue="planning" className="h-full min-h-0">
            <TabsList className="grid w-full grid-cols-2 xl:hidden">
              <TabsTrigger value="planning">{copy.readyToSchedule}</TabsTrigger>
              <TabsTrigger value="calendar">{copy.calendarTab}</TabsTrigger>
            </TabsList>
            <TabsContent value="planning" className="min-h-0 overflow-visible xl:mt-0 xl:overflow-y-auto">
              <ScheduleRightSidebar
                copy={copy}
                viewData={viewData}
                draggedTask={draggedTask}
                isPending={isPending}
                handleQueueDragStart={handleQueueDragStart}
                handleQueueDragEnd={handleQueueDragEnd}
                onOpenTaskDetails={setLocalSelectedTaskId}
                onScheduleTask={setLocalSelectedTaskId}
              />
            </TabsContent>
            <TabsContent value="calendar" className="min-h-0 overflow-visible xl:hidden">
              <CalendarSourceSetup workspaceId={workspaceId} />
            </TabsContent>
          </Tabs>
          <div className="mt-4 hidden xl:block">
            <CalendarSourceSetup workspaceId={workspaceId} />
          </div>
        </div>

      </div>

      {viewModel.selectedItem && viewModel.activeDay ? (
        <SelectedBlockSheet
          item={viewModel.selectedItem}
          selectedDay={viewModel.activeDay}
          executionRuntimes={data.executionRuntimes}
          defaultExecutionRuntime={data.defaultExecutionRuntime}
          availableAiClients={data.availableAiClients}
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
        availableAiClients={data.availableAiClients}
      />
    </div>
  );
}
