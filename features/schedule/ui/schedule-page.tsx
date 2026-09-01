"use client";

import { useEffect, useMemo, useState } from "react";
import {
  projectPlanningBusyBlocks,
  type PlanningBusyBlock,
} from "@chrona/domain";
import { useAssistantSurface } from "@features/assistant-surface";
import type { SchedulePageProps } from "./schedule-page-types";
import {
  buildScheduleHref,
  buildScheduleViewHref,
} from "./schedule-page-utils";
import { buildSchedulePageViewModel } from "./schedule-page-view-model";
import { SchedulePageHeader } from "./schedule-page-main-panel";
import { SchedulePageMainPanel } from "./schedule-page-main-panel";
import { SchedulePageDialogs } from "./dialogs/schedule-page-dialogs";
import {
  CalendarSourceSetup,
  listExternalCalendarEvents,
} from "../../external-calendar";
import { SelectedBlockSheet } from "./panels/schedule-page-panels";
import { PageFrame, Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/ui";

import { ScheduleRightSidebar } from "./panels/schedule-page-sidebar";
import { getSchedulePageCopy } from "./schedule-page-copy";
import { useI18n, useLocale } from "@chrona/i18n"
import { localizeHref } from "@chrona/i18n";
import { useNavigate, useRevalidator } from "react-router-dom";
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
  const { pendingProposal, registerHandlers, setPageContext } =
    useAssistantSurface();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = useMemo(
    () => getSchedulePageCopy(messages.components.schedulePage),
    [messages.components.schedulePage],
  );
  const [externalEvents, setExternalEvents] = useState<PlanningBusyBlock[]>([]);
  const [externalEventsRefreshKey, setExternalEventsRefreshKey] = useState(0);

  const actionFailedMessage =
    messages.components.scheduleEditorForm.actionFailed;
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
    routerRefresh: revalidator.revalidate,
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
    pushRoute: (href) => void navigate(href),
    localizeHref,
    actionFailedMessage,
    isPending,
    activeGroupItems: viewModel.activeGroup?.items ?? [],
  });

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
  }, [
    activeView,
    refreshProjection,
    registerHandlers,
    setPageContext,
    viewData,
    viewModel.activeDay,
    workspaceId,
  ]);

  useEffect(() => {
    let cancelled = false;
    const start = new Date(`${viewModel.activeDay}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    listExternalCalendarEvents(
      workspaceId,
      start.toISOString(),
      end.toISOString(),
    )
      .then(({ events }) => {
        if (cancelled) return;
        setExternalEvents(
          projectPlanningBusyBlocks({
            events,
            scheduledBlocks: (viewModel.activeGroup?.items ?? [])
              .filter((item) => item.scheduledStartAt && item.scheduledEndAt)
              .map((item) => ({
                id: item.taskId,
                startsAt: item.scheduledStartAt as Date,
                endsAt: item.scheduledEndAt as Date,
              })),
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setExternalEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [
    externalEventsRefreshKey,
    viewModel.activeDay,
    viewModel.activeGroup?.items,
    workspaceId,
  ]);

  useEffect(() => {
    function refreshExternalEvents() {
      setExternalEventsRefreshKey((key) => key + 1);
    }

    window.addEventListener(
      "chrona:external-calendar-source-created",
      refreshExternalEvents,
    );
    return () => {
      window.removeEventListener(
        "chrona:external-calendar-source-created",
        refreshExternalEvents,
      );
    };
  }, []);

  return (
    <PageFrame mode="main" data-domain="schedule" className="p-1 sm:p-2">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <SchedulePageHeader
        copy={copy}
        locale={locale}
        activeView={activeView}
        viewData={viewData}
        viewModel={viewModel}
        onNavigate={(href) => void navigate(href)}
        localizeHref={localizeHref}
        buildScheduleViewHref={buildScheduleViewHref}
        onScheduleTask={() => setShowNewTaskDialog(true)}
      />

      {errorMessage ? (
        <div className="mx-1 mt-3 rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {copy.errorPrefix}: {errorMessage}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-3 overflow-visible lg:gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_22rem] xl:overflow-hidden">
        <SchedulePageMainPanel
          locale={locale}
          copy={copy}
          activeView={activeView}
          draggedItem={draggedItem}
          activeGroup={viewModel.activeGroup}
          activeSelectedTaskId={viewModel.activeSelectedTaskId}
          conflictTaskIds={viewModel.conflictTaskIds}
          ghostPreview={
            pendingProposal?.kind === "schedule"
              ? (pendingProposal.schedulePreview ?? null)
              : null
          }
          externalEvents={externalEvents}
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

        <aside className="min-h-0 overflow-visible border-t border-border pt-3 xl:overflow-hidden xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
          <Tabs defaultValue="planning" className="h-full min-h-0">
            <TabsList className="grid w-full grid-cols-2 rounded-md">
              <TabsTrigger value="planning">{copy.readyToSchedule}</TabsTrigger>
              <TabsTrigger value="calendar">{copy.calendarTab}</TabsTrigger>
            </TabsList>
            <TabsContent
              value="planning"
              className="min-h-0 overflow-visible xl:mt-0 xl:overflow-y-auto"
            >
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
            <TabsContent
              value="calendar"
              className="min-h-0 overflow-visible xl:overflow-y-auto"
            >
              <CalendarSourceSetup workspaceId={workspaceId} />
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      {viewModel.selectedItem && viewModel.activeDay ? (
        <SelectedBlockSheet
          item={viewModel.selectedItem}
          selectedDay={viewModel.activeDay}
          availableAiClients={data.availableAiClients}
          isPending={isPending}
          onClose={() => {
            setLocalSelectedTaskId(undefined);
            void navigate(
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
        data={data}
        viewModel={viewModel}
        activeView={activeView}
        workspaceId={workspaceId}
        routerPush={(href) => void navigate(href)}
        locale={locale}
        localizeHref={localizeHref}
        buildScheduleViewHref={buildScheduleViewHref}
        actionFailedMessage={actionFailedMessage}
        onCloseQuickAdd={() => setShowNewTaskDialog(false)}
        handleCreateTaskBlock={handleCreateTaskBlock}
        availableAiClients={data.availableAiClients}
      />
    </PageFrame>
  );
}
