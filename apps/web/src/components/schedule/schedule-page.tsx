"use client";

import { useEffect, useMemo, useState } from "react";
import { projectPlanningBusyBlocks, type PlanningBusyBlock } from "@chrona/domain";
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
import { CalendarSourceSetup } from "@/components/schedule/calendar-source-setup";
import { SelectedBlockSheet } from "@/components/schedule/panels/schedule-page-panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

import { ScheduleLeftSidebar, ScheduleRightSidebar } from "@/components/schedule/panels/schedule-page-sidebar";
import { getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { localizeHref } from "@chrona/i18n";
import { useAppRouter } from "@/lib/router";
import { listExternalCalendarEvents } from "@/lib/external-calendar-client";
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
  const [externalEvents, setExternalEvents] = useState<PlanningBusyBlock[]>([]);
  const [externalEventsRefreshKey, setExternalEventsRefreshKey] = useState(0);

  const actionFailedMessage =
    messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed";
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
  const isEmptyWorkspace =
    viewData.scheduled.length === 0 &&
    viewData.unscheduled.length === 0 &&
    viewData.listItems.length === 0 &&
    viewData.proposals.length === 0;

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
    <div className="relative flex h-full flex-col overflow-x-hidden overflow-y-auto rounded-3xl border border-border/60 bg-card/70 p-2 shadow-sm backdrop-blur-sm sm:p-3">
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

      {isEmptyWorkspace ? (
        <section className="mx-1 mt-3 rounded-3xl border border-primary/20 bg-primary-soft/70 p-4 text-sm shadow-sm sm:mx-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-2">
              <h2 className="text-base font-semibold text-foreground">
                {copy.firstRunTitle}
              </h2>
              <p className="max-w-3xl text-muted-foreground">
                {copy.firstRunDescription}
              </p>
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <span>{copy.firstRunStepConnectAi}</span>
                <span>{copy.firstRunStepCreateTask}</span>
                <span>{copy.firstRunStepReviewPlan}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                size="default"
                onClick={() => router.push(localizeHref(locale, "/settings?panel=ai-clients"))}
              >
                {copy.firstRunConnectAi}
              </Button>

            </div>
          </div>
        </section>
      ) : null}

      {errorMessage ? (
        <div className="mx-2 mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-sm">
          {copy.errorPrefix}: {errorMessage}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-3 overflow-visible rounded-3xl bg-muted/40 p-2 lg:gap-4 lg:p-3 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(210px,0.72fr)_minmax(0,1.85fr)_minmax(220px,0.62fr)] xl:overflow-hidden">
        <ScheduleLeftSidebar
          copy={copy}
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
          externalEvents={externalEvents}
          executionRuntimes={data.executionRuntimes}
          defaultExecutionRuntime={data.defaultExecutionRuntime}
          isPending={isPending}
          onScheduleDrop={handleScheduleDrop}
          onCreateTaskBlock={handleCreateTaskBlock}
          onScheduledDragStart={handleScheduledDragStart}
          onDragEnd={handleQueueDragEnd}
          onSelectTask={setLocalSelectedTaskId}
          onSaveTaskConfigAction={handleTaskConfigSave}
        />

        <div className="min-h-0 overflow-visible xl:overflow-hidden xl:pl-1">
          <Tabs defaultValue="queue" className="h-full min-h-0">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="queue">{copy.queueTab}</TabsTrigger>
              <TabsTrigger value="calendar">{copy.calendarTab}</TabsTrigger>
            </TabsList>
            <TabsContent value="queue" className="min-h-0 overflow-visible xl:overflow-y-auto">
              <ScheduleRightSidebar
                copy={copy}
                viewData={viewData}
                draggedTask={draggedTask}
                isPending={isPending}
                handleQueueDragStart={handleQueueDragStart}
                handleQueueDragEnd={handleQueueDragEnd}
                onOpenTaskDetails={setLocalSelectedTaskId}
              />
            </TabsContent>
            <TabsContent value="calendar" className="min-h-0 overflow-visible xl:overflow-y-auto">
              <CalendarSourceSetup workspaceId={workspaceId} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {viewModel.selectedItem && viewModel.activeDay ? (
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
