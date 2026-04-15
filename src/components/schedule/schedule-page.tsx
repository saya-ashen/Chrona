"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  acceptScheduleProposal,
  applySchedule,
  createTaskFromSchedule,
  rejectScheduleProposal,
  updateTaskConfigFromSchedule,
} from "@/app/actions/task-actions";
import { PlanningHeader } from "@/components/schedule/planning-header";
import {
  EmptyState,
  ProposalCard,
  QueueCard,
  RiskCard,
  SelectedBlockSheet,
  TodayFocusCard,
} from "@/components/schedule/schedule-page-panels";
import {
  getSchedulePageCopy,
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
} from "@/components/schedule/schedule-page-copy";
import { ScheduleActionRail } from "@/components/schedule/schedule-action-rail";
import { ScheduleCommandBar } from "@/components/schedule/schedule-command-bar";
import { ScheduleTaskList } from "@/components/schedule/schedule-task-list";
import { DayTimeline, WeekStrip } from "@/components/schedule/schedule-page-timeline";
import type {
  SchedulePageData,
  SchedulePageProps,
  SecondaryPlanningView,
  QuickCreateDraft,
  ScheduledItem,
  TimelineCreateInput,
  TimelineDragItem,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import {
  addDays,
  applyScheduleToListItem,
  applyTaskConfigToItem,
  buildScheduleHref,
  buildScheduleViewHref,
  buildTodayFocusItems,
  buildWeekGroups,
  createListItemFromScheduledItem,
  createScheduledItemFromCreateInput,
  createScheduledItemFromQueueItem,
  formatDateKey,
  formatDayHeading,
  formatTime,
  getBlockDurationMinutes,
  getTodayKey,
  normalizeScheduleView,
  parseDayKey,
  sortScheduledItems,
  startOfDay,
} from "@/components/schedule/schedule-page-utils";
import type { TaskConfigFormInput } from "@/components/schedule/task-config-form";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { useI18n, useLocale } from "@/i18n/client";
import { localizeHref } from "@/i18n/routing";

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
  const router = useRouter();
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = useMemo(
    () => getSchedulePageCopy(messages.components?.schedulePage),
    [messages.components?.schedulePage],
  );
  const [viewData, setViewData] = useState<SchedulePageData>(data);
  const [draggedTask, setDraggedTask] = useState<{
    kind: TimelineDragItem["kind"];
    taskId: string;
  } | null>(null);
  const [expandedQueueTaskIds, setExpandedQueueTaskIds] = useState<string[]>([]);
  const [localSelectedTaskId, setLocalSelectedTaskId] = useState<string | undefined>(selectedTaskId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [secondaryView, setSecondaryView] = useState<SecondaryPlanningView>("queue");
  const refreshRequestIdRef = useRef(0);
  const activeView = normalizeScheduleView(selectedView);

  const refreshProjection = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;

    try {
      const response = await fetch(`/api/schedule/projection?workspaceId=${workspaceId}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed",
        );
      }

      const next = (await response.json()) as SchedulePageData;

      if (requestId !== refreshRequestIdRef.current) {
        return;
      }

      startTransition(() => setViewData(next));
    } catch (error) {
      router.refresh();
      throw error instanceof Error
        ? error
        : new Error(
            messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed",
          );
    }
  }, [messages.components?.scheduleEditorForm?.actionFailed, router, workspaceId]);

  useEffect(() => {
    setViewData(data);
  }, [data]);

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
      if (viewData.risks.length > 0) {
        return "risks";
      }
      if (viewData.unscheduled.length > 0) {
        return "queue";
      }
      if (viewData.proposals.length > 0) {
        return "proposals";
      }
      return "queue";
    });
  }, [viewData.proposals.length, viewData.risks.length, viewData.unscheduled.length]);

  const scheduledGroups = useMemo(
    () =>
      buildWeekGroups(
        viewData.scheduled,
        viewData.proposals,
        viewData.risks,
        selectedDay,
        locale,
        copy,
      ),
    [copy, locale, selectedDay, viewData.proposals, viewData.risks, viewData.scheduled],
  );

  const todayKey = getTodayKey();
  const tomorrowKey = formatDateKey(
    addDays(parseDayKey(todayKey) ?? startOfDay(new Date()), 1),
  );
  const selectedGroupKey = scheduledGroups.find((group) => group.key === selectedDay)?.key;
  const todayGroupKey = scheduledGroups.find((group) => group.key === todayKey)?.key;
  const todayGroup = scheduledGroups.find((group) => group.key === todayGroupKey) ?? null;
  const firstPopulatedGroup =
    scheduledGroups.find(
      (group) =>
        group.items.length > 0 ||
        group.proposalCount > 0 ||
        group.riskCount > 0,
    )?.key ?? null;
  const activeDay =
    selectedGroupKey ??
    (todayGroup &&
    (todayGroup.items.length > 0 ||
      todayGroup.proposalCount > 0 ||
      todayGroup.riskCount > 0)
      ? todayGroup.key
      : null) ??
    firstPopulatedGroup ??
    scheduledGroups[0]?.key ??
    todayKey;
  const activeGroup = scheduledGroups.find((group) => group.key === activeDay) ?? null;
  const activeSelectedTaskId = localSelectedTaskId ?? selectedTaskId;
  const selectedItem =
    activeGroup?.items.find((item) => item.taskId === activeSelectedTaskId) ?? null;
  const todayFocusItems = useMemo(
    () => buildTodayFocusItems(viewData, activeGroup, copy),
    [activeGroup, copy, viewData],
  );
  const activeRailLabel =
    secondaryView === "risks"
      ? copy.conflictsTitle
      : secondaryView === "proposals"
        ? copy.aiProposalsTitle
        : copy.unscheduledQueue;

  function patchScheduledWindow(taskId: string, startAt: Date, endAt: Date, dueAt?: Date | null) {
    setViewData((current) => ({
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
        item.taskId === taskId ? applyScheduleToListItem(item, startAt, endAt) : item,
      ),
    }));
  }

  const draggedQueueItem =
    draggedTask?.kind === "queue"
      ? (viewData.unscheduled.find((item) => item.taskId === draggedTask.taskId) ?? null)
      : null;
  const draggedScheduledItem =
    draggedTask?.kind === "scheduled"
      ? (activeGroup?.items.find((item) => item.taskId === draggedTask.taskId) ?? null)
      : null;
  const draggedItem: TimelineDragItem | null = draggedQueueItem
    ? {
        kind: "queue",
        taskId: draggedQueueItem.taskId,
        title: draggedQueueItem.title,
        dueAt: draggedQueueItem.dueAt,
        durationMinutes: DEFAULT_SCHEDULE_BLOCK_MINUTES,
      }
    : draggedScheduledItem
      ? {
          kind: "scheduled",
          taskId: draggedScheduledItem.taskId,
          title: draggedScheduledItem.title,
          dueAt: draggedScheduledItem.dueAt,
          durationMinutes: getBlockDurationMinutes(draggedScheduledItem),
        }
      : null;

  async function runAction(action: () => Promise<void>) {
    try {
      setIsPending(true);
      setErrorMessage(null);
      await action();
      await refreshProjection();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : (messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed"),
      );
    } finally {
      setIsPending(false);
    }
  }

  function handleQueueDragStart(item: UnscheduledItem, event: DragEvent<HTMLElement>) {
    if (isPending) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.taskId);
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
    setAnnouncement(
      `Picked up scheduled block ${item.title}. Drop it on a new slot to move the block.`,
    );
  }

  async function handleScheduleDrop(
    item: TimelineDragItem,
    startAt: Date,
    endAt: Date,
  ) {
    setAnnouncement(
      `Dropped ${item.title} on ${formatDayHeading(startAt, locale, copy)} at ${formatTime(startAt, locale)}.`,
    );

    try {
      setIsPending(true);
      setErrorMessage(null);

      if (item.kind === "queue" && draggedQueueItem) {
        setViewData((current) => ({
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
        setExpandedQueueTaskIds((current) =>
          current.filter((taskId) => taskId !== draggedQueueItem.taskId),
        );
      }

      if (item.kind === "scheduled") {
        patchScheduledWindow(item.taskId, startAt, endAt, item.dueAt);
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
        error instanceof Error
          ? error.message
          : (messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed"),
      );
      setViewData(data);
    } finally {
      setIsPending(false);
      setDraggedTask(null);
    }
  }

  async function handleCreateTaskBlock(input: TimelineCreateInput) {
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

      setViewData((current) => ({
        ...current,
        summary: {
          ...current.summary,
          scheduledCount: current.summary.scheduledCount + 1,
        },
        scheduled: sortScheduledItems([...current.scheduled, createdItem]),
        listItems: [...current.listItems, createListItemFromScheduledItem(createdItem)],
      }));
      setLocalSelectedTaskId(created.taskId);
      router.push(
        localizeHref(locale, buildScheduleViewHref(activeDay, activeView, created.taskId)),
      );
      await refreshProjection();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : (messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed"),
      );
      setViewData(data);
    } finally {
      setIsPending(false);
    }
  }

  async function handleQuickCreate(draft: QuickCreateDraft) {
    const selectedAdapter =
      data.runtimeAdapters.find((adapter) => adapter.key === data.defaultRuntimeAdapterKey) ??
      data.runtimeAdapters[0] ??
      null;

    const input: TimelineCreateInput = {
      title: draft.title,
      description: "",
      priority: draft.priority,
      dueAt: draft.dueAt,
      runtimeAdapterKey: selectedAdapter?.key ?? data.defaultRuntimeAdapterKey,
      runtimeInput: {},
      runtimeInputVersion:
        selectedAdapter?.spec.version ?? `${data.defaultRuntimeAdapterKey}-v1`,
      runtimeModel: null,
      prompt: null,
      runtimeConfig: null,
      scheduledStartAt: draft.scheduledStartAt ?? new Date(),
      scheduledEndAt:
        draft.scheduledEndAt ??
        new Date(
          (draft.scheduledStartAt ?? new Date()).getTime() +
            DEFAULT_SCHEDULE_BLOCK_MINUTES * 60 * 1000,
        ),
    };

    await handleCreateTaskBlock(input);
  }

  async function handleAcceptProposal(proposalId: string) {
    await runAction(async () => {
      await acceptScheduleProposal(proposalId, "Accepted on schedule page");
    });
  }

  async function handleRejectProposal(proposalId: string) {
    await runAction(async () => {
      await rejectScheduleProposal(proposalId, "Rejected on schedule page");
    });
  }

  function toggleQueueCard(taskId: string) {
    setExpandedQueueTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );
  }

  async function handleTaskConfigSave(taskId: string, input: TaskConfigFormInput) {
    try {
      setIsPending(true);
      setErrorMessage(null);

      setViewData((current) => ({
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
        error instanceof Error
          ? error.message
          : (messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed"),
      );
      setViewData(data);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-8">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <PlanningHeader
        ariaLabel={copy.pageTitle}
        title={copy.pageTitle}
        activeDayLabel={activeGroup?.label ?? activeDay}
        dateSwitcherLabel={copy.dateSwitcher}
        dayLinks={[
          {
            label: copy.today,
            href: buildScheduleViewHref(todayKey, activeView),
            current: activeDay === todayKey,
          },
          {
            label: copy.tomorrow,
            href: buildScheduleViewHref(tomorrowKey, activeView),
            current: activeDay === tomorrowKey,
          },
          {
            label: copy.currentPlanButton,
            href: buildScheduleViewHref(activeDay, activeView),
            current: activeDay !== todayKey && activeDay !== tomorrowKey,
          },
        ]}
        activeView={activeView}
        timelineHref={buildScheduleViewHref(activeDay, "timeline", activeSelectedTaskId)}
        listHref={buildScheduleViewHref(activeDay, "list", activeSelectedTaskId)}
        timelineLabel={copy.timeline}
        listLabel={copy.list}
        metrics={[
          { label: copy.todayBlocks, value: activeGroup?.items.length ?? 0 },
          {
            label: copy.queueReady,
            value: viewData.summary.unscheduledCount,
            tone: viewData.summary.unscheduledCount > 0 ? "info" : undefined,
          },
          {
            label: copy.needsAttention,
            value: viewData.summary.riskCount,
            tone: viewData.summary.riskCount > 0 ? "critical" : undefined,
          },
          {
            label: copy.aiProposalsMetric,
            value: viewData.summary.proposalCount,
            tone: viewData.summary.proposalCount > 0 ? "info" : undefined,
          },
        ]}
      />

      {errorMessage ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="space-y-4 xl:min-h-[calc(100vh-16rem)]">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_360px] xl:items-start">
          <div className="space-y-4">
            <TodayFocusCard
              items={todayFocusItems}
              emptyMessage={copy.todayFocusEmpty}
              copy={copy}
            />

            <SurfaceCard variant="highlight">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SurfaceCardHeader>
                  <SurfaceCardTitle>{copy.scheduledTimeline}</SurfaceCardTitle>
                </SurfaceCardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  {draggedItem ? <StatusBadge tone="info">{copy.dropMode}</StatusBadge> : null}
                  <StatusBadge>{copy.planningSurface}</StatusBadge>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {activeView === "timeline" ? (
                  activeGroup ? (
                    <>
                      <ScheduleCommandBar
                        selectedDay={activeGroup.key}
                        isPending={isPending}
                        onSubmit={handleQuickCreate}
                      />
                      <DayTimeline
                        items={activeGroup.items}
                        dayDate={activeGroup.date}
                        selectedDay={activeGroup.key}
                        selectedTaskId={activeSelectedTaskId}
                        draggedItem={draggedItem}
                        runtimeAdapters={data.runtimeAdapters}
                        defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
                        isPending={isPending}
                        onScheduleDrop={handleScheduleDrop}
                        onCreateTaskBlock={handleCreateTaskBlock}
                        onScheduledDragStart={handleScheduledDragStart}
                        onDragEnd={handleQueueDragEnd}
                      />
                    </>
                  ) : (
                    <EmptyState>{copy.noTimelineDay}</EmptyState>
                  )
                ) : (
                  <ScheduleTaskList
                    items={viewData.listItems}
                    runtimeAdapters={data.runtimeAdapters}
                    defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
                    onSaveTaskConfigAction={handleTaskConfigSave}
                    isPending={isPending}
                  />
                )}
              </div>
            </SurfaceCard>
          </div>

          <ScheduleActionRail
            ariaLabel={activeRailLabel}
            tablistAriaLabel={activeRailLabel}
            activeTab={secondaryView}
            onTabChange={setSecondaryView}
            sections={[
              {
                value: "queue",
                label: copy.unscheduledQueue,
                title: copy.unscheduledQueue,
                description: copy.unscheduledQueueDescription,
                body:
                  viewData.unscheduled.length === 0 ? (
                    <EmptyState>{copy.noUnscheduledWork}</EmptyState>
                  ) : (
                    viewData.unscheduled.map((item) => (
                      <QueueCard
                        key={item.taskId}
                        item={item}
                        runtimeAdapters={data.runtimeAdapters}
                        defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
                        isPending={isPending}
                        isDragging={
                          draggedTask?.kind === "queue" && draggedTask.taskId === item.taskId
                        }
                        isExpanded={expandedQueueTaskIds.includes(item.taskId)}
                        onToggle={() => toggleQueueCard(item.taskId)}
                        onMutatedAction={refreshProjection}
                        onSaveTaskConfigAction={handleTaskConfigSave}
                        onDragStart={handleQueueDragStart}
                        onDragEnd={handleQueueDragEnd}
                      />
                    ))
                  ),
              },
              {
                value: "risks",
                label: copy.conflictsTitle,
                title: copy.conflictsTitle,
                body:
                  viewData.risks.length === 0 ? (
                    <EmptyState>{copy.noScheduleRisks}</EmptyState>
                  ) : (
                    viewData.risks
                      .slice(0, 2)
                      .map((item) => <RiskCard key={item.taskId} item={item} />)
                  ),
              },
              {
                value: "proposals",
                label: copy.aiProposalsTitle,
                title: copy.aiProposalsTitle,
                body:
                  viewData.proposals.length === 0 ? (
                    <EmptyState>{copy.aiProposalsCompactEmpty}</EmptyState>
                  ) : (
                    viewData.proposals.slice(0, 2).map((proposal) => (
                      <ProposalCard
                        key={proposal.proposalId}
                        proposal={proposal}
                        isPending={isPending}
                        onAccept={handleAcceptProposal}
                        onReject={handleRejectProposal}
                      />
                    ))
                  ),
              },
            ]}
          />
        </div>

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>{copy.weekOverview}</SurfaceCardTitle>
          </SurfaceCardHeader>
          <div className="px-6 pb-6">
            <WeekStrip groups={scheduledGroups} selectedDay={activeDay} />
          </div>
        </SurfaceCard>
      </div>

      {activeView === "timeline" && selectedItem && activeDay ? (
        <SelectedBlockSheet
          item={selectedItem}
          selectedDay={activeDay}
          runtimeAdapters={data.runtimeAdapters}
          defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
          isPending={isPending}
          onSaveTaskConfigAction={handleTaskConfigSave}
          onMutatedAction={refreshProjection}
          buildScheduleHref={buildScheduleHref}
        />
      ) : null}
    </div>
  );
}
