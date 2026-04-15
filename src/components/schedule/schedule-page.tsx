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
import { CompactTodayFocus, ScheduleMiniCalendar } from "@/components/schedule/schedule-mini-calendar";
import {
  EmptyState,
  ProposalCard,
  QueueCard,
  RiskCard,
  SelectedBlockSheet,
} from "@/components/schedule/schedule-page-panels";
import { ConflictCard } from "@/components/schedule/conflict-card";
import {
  getSchedulePageCopy,
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
} from "@/components/schedule/schedule-page-copy";
import { ScheduleInlineQuickCreate } from "@/components/schedule/schedule-inline-quick-create";
import { TaskCreateDialog } from "@/components/schedule/task-create-dialog";
import { ScheduleActionRail } from "@/components/schedule/schedule-action-rail";
import { ScheduleTaskList } from "@/components/schedule/schedule-task-list";
import { DayTimeline } from "@/components/schedule/schedule-page-timeline";
import type {
  SchedulePageData,
  SchedulePageProps,
  SecondaryPlanningView,
  QuickCreateDraft,
  ScheduledItem,
  TimelineCreateInput,
  TimelineDragItem,
  UnscheduledItem,
  ScheduleSuggestion,
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
  formatDurationMinutes,
  formatTime,
  formatWeekdayShort,
  getBlockDurationMinutes,
  getTodayKey,
  normalizeScheduleView,
  parseDayKey,
  sortScheduledItems,
  startOfDay,
  startOfWeek,
} from "@/components/schedule/schedule-page-utils";
import type { TaskConfigFormInput } from "@/components/schedule/task-config-form";
import { SurfaceCard } from "@/components/ui/surface-card";
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
  const [showQuickAddDialog, setShowQuickAddDialog] = useState(false);
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
  const activeDayDate = parseDayKey(activeDay) ?? startOfDay(new Date());
  const calendarMonthDate = startOfDay(new Date(activeDayDate.getFullYear(), activeDayDate.getMonth(), 1));
  const calendarGridStart = startOfWeek(calendarMonthDate);
  const calendarDays = Array.from({ length: 35 }, (_, index) => {
    const date = addDays(calendarGridStart, index);
    const dayKey = formatDateKey(date);
    const dayGroup = scheduledGroups.find((group) => group.key === dayKey);

    return {
      key: dayKey,
      label: formatDayHeading(date, locale, copy),
      shortLabel: formatWeekdayShort(date, locale),
      dateNumber: String(date.getDate()),
      href: localizeHref(locale, buildScheduleViewHref(dayKey, activeView, activeSelectedTaskId)),
      isCurrentMonth: date.getMonth() === activeDayDate.getMonth(),
      isToday: dayKey === todayKey,
      isSelected: dayKey === activeDay,
      scheduledCount: dayGroup?.items.length ?? 0,
      riskCount: dayGroup?.riskCount ?? 0,
    };
  });
  const calendarMonthLabel = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "long",
    year: "numeric",
  }).format(activeDayDate);
  const conflictTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const conflict of viewData.conflicts) {
      for (const taskId of conflict.taskIds) {
        ids.add(taskId);
      }
    }
    return ids;
  }, [viewData.conflicts]);

  const cockpitSummary = copy.cockpitSummaryTemplate
    .replace("{scheduled}", formatDurationMinutes(viewData.planningSummary.todayLoadMinutes))
    .replace("{queue}", String(viewData.planningSummary.readyToScheduleCount))
    .replace("{risks}", String(viewData.planningSummary.riskCount))
    .replace("{automation}", String(viewData.automationCandidates.length));

  function getQuickCreateDefaults() {
    const selectedAdapter =
      data.runtimeAdapters.find((adapter) => adapter.key === data.defaultRuntimeAdapterKey) ??
      data.runtimeAdapters[0] ??
      null;

    return {
      runtimeAdapterKey: selectedAdapter?.key ?? data.defaultRuntimeAdapterKey,
      runtimeInputVersion:
        selectedAdapter?.spec.version ?? `${data.defaultRuntimeAdapterKey}-v1`,
    };
  }

  function getSuggestedDurationMinutes(
    value: unknown,
    fallback = DEFAULT_SCHEDULE_BLOCK_MINUTES,
  ) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(15, Math.round(value / 15) * 15);
  }

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
        durationMinutes: getSuggestedDurationMinutes(
          (draggedQueueItem.runtimeConfig as { suggestedDurationMinutes?: unknown } | null)
            ?.suggestedDurationMinutes,
        ),
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
    const defaults = getQuickCreateDefaults();

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
          (draft.scheduledStartAt ?? new Date()).getTime() +
            DEFAULT_SCHEDULE_BLOCK_MINUTES * 60 * 1000,
        ),
    };

    await handleCreateTaskBlock(input);
  }

  async function handleQueueQuickCreate(
    draft: QuickCreateDraft & { durationMinutes: number },
  ) {
    const defaults = getQuickCreateDefaults();

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
        error instanceof Error
          ? error.message
          : (messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed"),
      );
      setViewData(data);
    } finally {
      setIsPending(false);
    }
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

  async function handleApplySuggestion(suggestion: ScheduleSuggestion) {
    try {
      setIsPending(true);
      setErrorMessage(null);

      // 调用 API 应用建议
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

      // 刷新数据
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
    <div className="flex h-full flex-col overflow-hidden">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <PlanningHeader
        ariaLabel={copy.pageTitle}
        title={copy.pageTitle}
        activeDayLabel={activeGroup?.label ?? activeDay}
        summary={cockpitSummary}
        dateSwitcherLabel={copy.dateSwitcher}
        dayLinks={[
          {
            label: copy.today,
            href: localizeHref(locale, buildScheduleViewHref(todayKey, activeView)),
            current: activeDay === todayKey,
          },
          {
            label: copy.tomorrow,
            href: localizeHref(locale, buildScheduleViewHref(tomorrowKey, activeView)),
            current: activeDay === tomorrowKey,
          },
        ]}
        activeView={activeView}
        timelineHref={localizeHref(locale, buildScheduleViewHref(activeDay, "timeline", activeSelectedTaskId))}
        listHref={localizeHref(locale, buildScheduleViewHref(activeDay, "list", activeSelectedTaskId))}
        timelineLabel={copy.timeline}
        listLabel={copy.list}
        metrics={[
          {
            label: copy.cockpitTodayLoad,
            value: formatDurationMinutes(viewData.planningSummary.todayLoadMinutes),
            hint: copy.cockpitTodayLoadHint,
          },
          {
            label: copy.queueMetric,
            value: String(viewData.planningSummary.readyToScheduleCount),
            hint: copy.cockpitQueueHint,
            tone: viewData.summary.unscheduledCount > 0 ? "info" : undefined,
          },
          {
            label: copy.risksMetric,
            value: String(viewData.summary.riskCount),
            hint: copy.cockpitRisksHint,
            tone: viewData.summary.riskCount > 0 ? "critical" : undefined,
          },
          {
            label: copy.cockpitSuggestions,
            value: String(viewData.summary.proposalCount + viewData.automationCandidates.length),
            hint: copy.cockpitSuggestionsHint,
            tone:
              viewData.summary.proposalCount > 0 || viewData.automationCandidates.length > 0
                ? "info"
                : undefined,
          },
        ]}
        actions={[
          {
            label: copy.cockpitQuickAdd,
            onClick: () => setShowQuickAddDialog(true),
            description: copy.cockpitQuickAddHint,
          },
          {
            label: copy.cockpitReviewSuggestions,
            href: "#schedule-cockpit-sidebar",
            description: copy.cockpitReviewSuggestionsHint,
          },
          {
            label: copy.cockpitAutoArrange,
            description: copy.cockpitAutoArrangeHint,
            disabled: true,
          },
          {
            label: copy.cockpitPlanWithAi,
            description: copy.cockpitPlanWithAiHint,
            disabled: true,
          },
        ]}
      />

      {errorMessage ? (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <div className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto">
          <ScheduleMiniCalendar monthLabel={calendarMonthLabel} days={calendarDays} />

          <CompactTodayFocus
            title={copy.todayFocus}
            items={todayFocusItems}
            emptyMessage={copy.todayFocusEmpty}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <SurfaceCard variant="highlight" className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{copy.scheduledTimeline}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {draggedItem ? (
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                    {copy.dropMode}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
              {activeView === "timeline" ? (
                activeGroup ? (
                  <DayTimeline
                    items={activeGroup.items}
                    dayDate={activeGroup.date}
                    selectedDay={activeGroup.key}
                    selectedTaskId={activeSelectedTaskId}
                    conflictTaskIds={conflictTaskIds}
                    draggedItem={draggedItem}
                    runtimeAdapters={data.runtimeAdapters}
                    defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
                    isPending={isPending}
                    onScheduleDrop={handleScheduleDrop}
                    onCreateTaskBlock={handleCreateTaskBlock}
                    onScheduledDragStart={handleScheduledDragStart}
                    onDragEnd={handleQueueDragEnd}
                  />
                ) : (
                  <EmptyState>{copy.noTimelineDay}</EmptyState>
                )
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ScheduleTaskList
                    items={viewData.listItems}
                    runtimeAdapters={data.runtimeAdapters}
                    defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
                    onSaveTaskConfigAction={handleTaskConfigSave}
                    isPending={isPending}
                  />
                </div>
              )}
            </div>
          </SurfaceCard>
        </div>

        <div className="w-[340px] shrink-0 overflow-y-auto">
          <ScheduleActionRail
            id="schedule-cockpit-sidebar"
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
                body: (
                  <div className="space-y-3">
                    <ScheduleInlineQuickCreate
                      mode="queue"
                      selectedDay={activeDay}
                      isPending={isPending}
                      submitLabel={copy.quickCreateQueueSubmit}
                      hint={copy.quickCreateQueueHint}
                      compact
                      onSubmit={handleQueueQuickCreate}
                    />
                    {viewData.unscheduled.length === 0 ? (
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
                    )}
                  </div>
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
                value: "conflicts",
                label: "AI 冲突检测",
                title: "AI 冲突检测",
                body:
                  viewData.conflicts.length === 0 ? (
                    <EmptyState>未检测到冲突</EmptyState>
                  ) : (
                    <div className="space-y-3">
                      {viewData.conflicts.slice(0, 3).map((conflict) => (
                        <ConflictCard
                          key={conflict.id}
                          conflict={conflict}
                          suggestions={viewData.suggestions}
                          onApplySuggestion={handleApplySuggestion}
                          isPending={isPending}
                        />
                      ))}
                    </div>
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

      {showQuickAddDialog ? (
        <TaskCreateDialog
          isOpen={showQuickAddDialog}
          initialStartAt={new Date(new Date().setHours(9, 0, 0, 0))}
          initialEndAt={new Date(new Date().setHours(10, 0, 0, 0))}
          isPending={isPending}
          onClose={() => setShowQuickAddDialog(false)}
          onSubmit={async (input) => {
            await handleCreateTaskBlock({
              title: input.title,
              description: input.description,
              priority: input.priority,
              dueAt: input.dueAt,
              runtimeAdapterKey: data.defaultRuntimeAdapterKey,
              runtimeInput: {},
              runtimeInputVersion: `${data.defaultRuntimeAdapterKey}-v1`,
              runtimeModel: null,
              prompt: null,
              runtimeConfig: null,
              scheduledStartAt: input.scheduledStartAt,
              scheduledEndAt: input.scheduledEndAt,
            });
            setShowQuickAddDialog(false);
          }}
        />
      ) : null}
    </div>
  );
}
