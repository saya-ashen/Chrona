"use client";

import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, {
  type DateClickArg,
  type EventResizeDoneArg,
} from "@fullcalendar/interaction";
import type {
  DatesSetArg,
  DateSelectArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  AllowFunc,
} from "@fullcalendar/core";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
  getAutoStartReasonCopy,
  getSchedulePageCopy,
  TIMELINE_SLOT_MINUTES,
} from "../schedule-page-copy";
import { TaskCreateDialog } from "../dialogs/task-create-dialog";
import { DayTimelineSummary } from "../panels/schedule-page-panels";
import { TimelinePlacementCard } from "./schedule-timeline-primitives";
import { ScheduleGhostBlockLayer } from "@/components/global-ai-sidebar/schedule-ghost-block-layer";
import { ExternalCalendarEventBlock } from "../../../external-calendar";
import type { ScheduleGhostBlockPreview } from "@chrona/contracts";
import type { PlanningBusyBlock } from "@chrona/domain";
import type {
  ScheduledItem,
  TimelineCreateInput,
  TimelineDragItem,
  TimelinePlacementPreview,
} from "../schedule-page-types";
import {
  buildScheduleHref,
  buildTimelinePlacementPreview,
  clampScheduledEndMinute,
  clampScheduledStartMinute,
  formatDayHeading,
  formatTimeRange,
  getBlockDurationMinutes,
  getPriorityAccent,
  getTodayKey,
  snapMinuteToGrid,
} from "../schedule-page-utils";
import { type TaskConfigAiClient, type TaskConfigExecutionRuntime } from "../forms/task-config-form";
import { CalendarDays } from "lucide-react";
import { Badge } from "shared/ui/badge";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { externalCalendarMessages } from "@chrona/i18n/external-calendar"
import { cn } from "@/lib/utils"

const TIMELINE_HOUR_HEIGHT = 56;
const WORKDAY_START_HOUR = 8;
const DEFAULT_TIMELINE_PIXELS_PER_MINUTE = TIMELINE_HOUR_HEIGHT / 60;

function minutesFromDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function dateForMinute(dayDate: Date, minute: number) {
  const nextDate = new Date(dayDate);
  nextDate.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return nextDate;
}

function fullCalendarTime(hour: number, minute = 0) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function AutoStartReasonNote({ item, copy }: { item: ScheduledItem; copy: ReturnType<typeof getSchedulePageCopy> }) {
  // `not_due` is the normal steady state, so it stays in the data but is
  // suppressed from the card surface.
  const reasonCopy =
    item.autoStartEligible === false && item.autoStartReason !== "not_due"
      ? getAutoStartReasonCopy(copy, item.autoStartReason)
      : null;

  if (!reasonCopy) {
    return null;
  }

  return (
    <p
      className="truncate text-[10px] text-muted-foreground"
      title={`${copy.autoStartReasonLabel}: ${reasonCopy}`}
    >
      {reasonCopy}
    </p>
  );
}

function buildDragItem(item: ScheduledItem, startAt: Date, endAt: Date): TimelineDragItem {
  return {
    kind: "scheduled",
    taskId: item.taskId,
    workBlockId: item.workBlockId,
    title: item.title,
    dueAt: item.dueAt,
    durationMinutes: Math.max(
      getBlockDurationMinutes({ scheduledStartAt: startAt, scheduledEndAt: endAt }),
      TIMELINE_SLOT_MINUTES,
    ),
  };
}

function TimelineComposer({
  draft,
  defaultExecutionRuntime,
  availableAiClients,
  isPending,
  onClose,
  onCreate,
}: {
  draft: TimelinePlacementPreview;
  defaultExecutionRuntime: string;
  availableAiClients?: TaskConfigAiClient[];
  isPending: boolean;
  onClose: () => void;
  onCreate: (input: TimelineCreateInput) => Promise<void>;
}) {
  return (
    <TaskCreateDialog
      isOpen={true}
      initialStartAt={draft.startAt}
      initialEndAt={draft.endAt}
      isPending={isPending}
      availableAiClients={availableAiClients}
      onClose={onClose}
      onSubmit={async (input) => {
        await onCreate({
          title: input.title,
          description: input.description,
          priority: input.priority,
          autoExecute: input.autoExecute,
          autoPlanGenerationEnabled: input.autoPlanGenerationEnabled,
          autoPlanGenerationTiming: input.autoPlanGenerationTiming,
          autoExecuteTiming: input.autoExecuteTiming,
          dueAt: input.dueAt,
          executionRuntime: defaultExecutionRuntime,
          executionConfig: {},
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt,
          recurrenceRule: input.recurrenceRule,
          recurrenceAnchorStartAt: input.recurrenceAnchorStartAt,
          recurrenceAnchorEndAt: input.recurrenceAnchorEndAt,
          aiClientId: input.aiClientId,
        });
      }}
    />
  );
}

export function DayTimeline({
  items,
  dayDate,
  selectedDay,
  selectedTaskId,
  conflictTaskIds,
  ghostPreview = null,
  draggedItem,
  externalEvents = [],
  executionRuntimes: _executionRuntimes,
  defaultExecutionRuntime,
  availableAiClients,
  isPending,
  onScheduleDrop,
  onCreateTaskBlock,
  onScheduledDragStart,
  onDragEnd,
  onSelectTask = () => {},
}: {
  items: ScheduledItem[];
  dayDate: Date;
  selectedDay: string;
  selectedTaskId?: string;
  conflictTaskIds?: Set<string>;
  ghostPreview?: ScheduleGhostBlockPreview | null;
  draggedItem: TimelineDragItem | null;
  externalEvents?: PlanningBusyBlock[];
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  availableAiClients?: TaskConfigAiClient[];
  isPending: boolean;
  onScheduleDrop: (
    item: TimelineDragItem,
    startAt: Date,
    endAt: Date,
  ) => Promise<void>;
  onCreateTaskBlock: (input: TimelineCreateInput) => Promise<void>;
  onScheduledDragStart: (item: ScheduledItem) => void;
  onDragEnd: () => void;
  onSelectTask?: (taskId: string) => void;
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components.schedulePage);
  const selectedItemById = useMemo(
    () => new Map(items.map((item) => [item.workBlockId ?? item.taskId, item])),
    [items],
  );
  const calendarRef = useRef<FullCalendar | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const [composerDraft, setComposerDraft] = useState<TimelinePlacementPreview | null>(null);
  const [dragPreview, setDragPreview] = useState<TimelinePlacementPreview | null>(null);
  const [hiddenTaskId, setHiddenTaskId] = useState<string | null>(null);
  const [timelineScrollTop, setTimelineScrollTop] = useState(0);
  const [timelinePixelsPerMinute, setTimelinePixelsPerMinute] = useState(
    DEFAULT_TIMELINE_PIXELS_PER_MINUTE,
  );

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;

    api.gotoDate(dayDate);
  }, [dayDate]);

  const mapMinuteToY = (minute: number) => {
    const clamped = Math.min(Math.max(minute, 0), 24 * 60);
    return clamped * timelinePixelsPerMinute;
  };

  const buildPlacementPreview = (
    startMinute: number,
    endMinute: number,
    source: TimelinePlacementPreview["source"],
    taskId?: string,
  ) => buildTimelinePlacementPreview({
    selectedDay,
    startMinute,
    endMinute,
    compressedTimeline: { mapMinuteToY },
    items,
    taskId,
    source,
  });

  const calendarEvents = useMemo<EventInput[]>(() => [
    ...items.map((item) => {
    const start = item.scheduledStartAt ?? dateForMinute(dayDate, 9 * 60);
    const end = item.scheduledEndAt ?? dateForMinute(
      dayDate,
      minutesFromDate(start) + DEFAULT_SCHEDULE_BLOCK_MINUTES,
    );
    const isCurrent = selectedDay === getTodayKey() && start.getTime() <= Date.now() && end.getTime() >= Date.now();
    const isPast = selectedDay === getTodayKey() && end.getTime() < Date.now();
    const hasConflict = conflictTaskIds?.has(item.taskId) ?? false;

    return {
      id: item.workBlockId ?? item.taskId,
      title: item.title,
      start,
      end,
      editable: !isPending,
      durationEditable: !isPending,
      startEditable: !isPending,
      classNames: [
        "chrona-calendar-event",
        selectedTaskId === (item.workBlockId ?? item.taskId) || selectedTaskId === item.taskId ? "chrona-calendar-event-selected" : "",
        isCurrent ? "chrona-calendar-event-current" : "",
        isPast ? "chrona-calendar-event-past" : "",
        hasConflict ? "chrona-calendar-event-conflict" : "",
        hiddenTaskId === item.taskId ? "chrona-calendar-event-hidden" : "",
      ].filter(Boolean),
      extendedProps: { item, hasConflict, isCurrent },
    };
    }),
    ...externalEvents.map((event) => ({
      id: `external-${event.id}`,
      title: event.title,
      start: event.startsAt,
      end: event.endsAt,
      allDay: false,
      editable: false,
      durationEditable: false,
      startEditable: false,
      classNames: [
        "chrona-calendar-external-event",
        event.overlapsScheduledTask ? "chrona-calendar-external-event-overlap" : "",
      ].filter(Boolean),
      extendedProps: { externalEvent: event },
    })),
  ], [conflictTaskIds, externalEvents, dayDate, hiddenTaskId, isPending, items, selectedDay, selectedTaskId]);

  function closeComposer() {
    setComposerDraft(null);
  }

  function getDragPreviewFromDate(date: Date) {
    if (!draggedItem) {
      return null;
    }

    const snappedStartMinute = clampScheduledStartMinute(
      snapMinuteToGrid(minutesFromDate(date)),
    );
    const endMinute = Math.min(
      snappedStartMinute + (draggedItem.durationMinutes ?? DEFAULT_SCHEDULE_BLOCK_MINUTES),
      24 * 60,
    );

    return buildPlacementPreview(
      snappedStartMinute,
      endMinute,
      "drag",
      draggedItem.kind === "scheduled" ? draggedItem.taskId : undefined,
    );
  }

  function getDragDateFromClientY(clientY: number) {
    const api = calendarRef.current?.getApi();
    const zone = dropZoneRef.current;
    const slats = zone?.querySelector(".fc-timegrid-slots");

    if (!api || !slats) {
      return dateForMinute(dayDate, 9 * 60);
    }

    const rect = slats.getBoundingClientRect();
    if (rect.height <= 0) {
      return dateForMinute(dayDate, 9 * 60);
    }

    const minute = (Math.min(Math.max(clientY - rect.top, 0), rect.height) / rect.height) * 24 * 60;
    return dateForMinute(dayDate, minute);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!draggedItem || isPending) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragPreview(getDragPreviewFromDate(getDragDateFromClientY(event.clientY)));
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!draggedItem || isPending) {
      return;
    }

    event.preventDefault();
    const preview = getDragPreviewFromDate(getDragDateFromClientY(event.clientY)) ?? dragPreview;
    setDragPreview(null);

    if (!preview || preview.hasConflict) {
      return;
    }

    await onScheduleDrop(draggedItem, preview.startAt, preview.endAt);
  }

  function handleDateClick(info: DateClickArg) {
    if (draggedItem || isPending) {
      return;
    }

    const startMinute = clampScheduledStartMinute(snapMinuteToGrid(minutesFromDate(info.date)));
    const endMinute = Math.min(startMinute + DEFAULT_SCHEDULE_BLOCK_MINUTES, 24 * 60);
    setComposerDraft(buildPlacementPreview(startMinute, endMinute, "create"));
  }

  function handleDateSelect(info: DateSelectArg) {
    if (draggedItem || isPending) {
      return;
    }

    const calendarApi = calendarRef.current?.getApi();
    const startMinute = clampScheduledStartMinute(snapMinuteToGrid(minutesFromDate(info.start)));
    const rawEndMinute = minutesFromDate(info.end);
    const endMinute = clampScheduledEndMinute(
      startMinute,
      snapMinuteToGrid(rawEndMinute),
    );

    calendarApi?.unselect();
    setComposerDraft(buildPlacementPreview(startMinute, endMinute, "create"));
  }

  async function handleKeyboardAdjust(item: ScheduledItem, key: "ArrowUp" | "ArrowDown") {
    if (!item.scheduledStartAt || isPending || draggedItem) {
      return;
    }

    const step = key === "ArrowUp" ? -TIMELINE_SLOT_MINUTES : TIMELINE_SLOT_MINUTES;
    const currentStartMinute = minutesFromDate(item.scheduledStartAt);
    const currentEndMinute = item.scheduledEndAt
      ? minutesFromDate(item.scheduledEndAt)
      : currentStartMinute + DEFAULT_SCHEDULE_BLOCK_MINUTES;
    const duration = Math.max(currentEndMinute - currentStartMinute, TIMELINE_SLOT_MINUTES);
    const nextStartMinute = clampScheduledStartMinute(currentStartMinute + step);
    const nextEndMinute = clampScheduledEndMinute(
      nextStartMinute,
      nextStartMinute + duration,
    );
    const preview = buildPlacementPreview(nextStartMinute, nextEndMinute, "resize", item.taskId);

    if (preview.hasConflict) {
      return;
    }

    await onScheduleDrop(
      {
        kind: "scheduled",
        taskId: item.taskId,
        workBlockId: item.workBlockId,
        title: item.title,
        dueAt: item.dueAt,
        durationMinutes: preview.endMinute - preview.startMinute,
      },
      preview.startAt,
      preview.endAt,
    );
  }

  function handleAccessibleResizeStart(item: ScheduledItem) {
    if (!item.scheduledStartAt || isPending || draggedItem) {
      return;
    }

    const startMinute = minutesFromDate(item.scheduledStartAt);
    const currentEndMinute = item.scheduledEndAt
      ? minutesFromDate(item.scheduledEndAt)
      : startMinute + DEFAULT_SCHEDULE_BLOCK_MINUTES;

    window.addEventListener(
      "mouseup",
      () => {
        const nextEndMinute = clampScheduledEndMinute(
          startMinute,
          currentEndMinute - TIMELINE_SLOT_MINUTES,
        );
        const preview = buildPlacementPreview(startMinute, nextEndMinute, "resize", item.taskId);

        if (preview.hasConflict) {
          return;
        }

        void onScheduleDrop(
          {
            kind: "scheduled",
            taskId: item.taskId,
            workBlockId: item.workBlockId,
            title: item.title,
            dueAt: item.dueAt,
            durationMinutes: preview.endMinute - preview.startMinute,
          },
          preview.startAt,
          preview.endAt,
        );
      },
      { once: true },
    );
  }

  async function commitScheduledMove(
    item: ScheduledItem,
    startAt: Date | null,
    endAt: Date | null,
    revert: () => void,
  ) {
    if (!startAt || isPending) {
      revert();
      return;
    }

    const safeEndAt = endAt ?? dateForMinute(
      startAt,
      minutesFromDate(startAt) + getBlockDurationMinutes(item),
    );
    const preview = buildPlacementPreview(
      minutesFromDate(startAt),
      minutesFromDate(safeEndAt),
      "resize",
      item.taskId,
    );

    if (preview.hasConflict) {
      revert();
      return;
    }

    await onScheduleDrop(buildDragItem(item, startAt, safeEndAt), startAt, safeEndAt);
  }

  async function handleEventDrop(info: EventDropArg) {
    const item = selectedItemById.get(info.event.id);
    if (!item) {
      info.revert();
      return;
    }

    await commitScheduledMove(item, info.event.start, info.event.end, info.revert);
  }

  async function handleEventResize(info: EventResizeDoneArg) {
    const item = selectedItemById.get(info.event.id);
    if (!item) {
      info.revert();
      return;
    }

    await commitScheduledMove(item, info.event.start, info.event.end, info.revert);
  }

  const handleEventAllow: AllowFunc = (span, movingEvent) => {
    const taskId = movingEvent?.id;
    const item = taskId ? selectedItemById.get(taskId) : null;

    if (!taskId || !item || isPending) {
      return false;
    }

    const startMinute = minutesFromDate(span.start);
    const endMinute = minutesFromDate(span.end);
    const preview = buildPlacementPreview(startMinute, endMinute, "drag", taskId);
    setDragPreview(preview);
    return !preview.hasConflict;
  };

  function syncTimelineScrollTop() {
    const calendarScroller = dropZoneRef.current?.querySelector(".fc-scroller") as HTMLElement | null;
    const slats = dropZoneRef.current?.querySelector(".fc-timegrid-slots") as HTMLElement | null;
    const slatsHeight = slats?.getBoundingClientRect().height ?? 0;

    if (slatsHeight > 0) {
      setTimelinePixelsPerMinute(slatsHeight / (24 * 60));
    }

    setTimelineScrollTop(calendarScroller?.scrollTop ?? 0);
  }

  function handleDatesSet(_info: DatesSetArg) {
    window.requestAnimationFrame(() => {
      const calendarScroller = dropZoneRef.current?.querySelector(".fc-scroller") as HTMLElement | null;
      const slats = dropZoneRef.current?.querySelector(".fc-timegrid-slots") as HTMLElement | null;
      const slatsHeight = slats?.getBoundingClientRect().height ?? 0;
      const pixelsPerMinute = slatsHeight > 0
        ? slatsHeight / (24 * 60)
        : DEFAULT_TIMELINE_PIXELS_PER_MINUTE;

      if (slatsHeight > 0) {
        setTimelinePixelsPerMinute(pixelsPerMinute);
      }

      if (calendarScroller && calendarScroller.scrollTop < WORKDAY_START_HOUR * 60 * pixelsPerMinute * 0.75) {
        calendarScroller.scrollTop = WORKDAY_START_HOUR * 60 * pixelsPerMinute;
      }

      setTimelineScrollTop(calendarScroller?.scrollTop ?? 0);
    });
  }

  function renderEventContent(info: EventContentArg) {
    const externalEvent = info.event.extendedProps.externalEvent as PlanningBusyBlock | undefined;
    if (externalEvent) {
      return (
        <ExternalCalendarEventBlock
          event={externalEvent}
          timeRange={formatTimeRange(info.event.start, info.event.end, locale, copy)}
        />
      );
    }

    const item = info.event.extendedProps.item as ScheduledItem | undefined;
    if (!item) {
      return <span>{info.event.title}</span>;
    }

    const hasConflict = Boolean(info.event.extendedProps.hasConflict);
    const isCurrent = Boolean(info.event.extendedProps.isCurrent);
    const sourceManaged = item.sourceManaged ?? null;
    const sourceStyle = sourceManaged
      ? {
          borderColor: sourceManaged.sourceColor,
          backgroundColor: `${sourceManaged.sourceColor}18`,
        }
      : undefined;
    const autoStartReasonCopy = item.autoStartEligible === false && item.autoStartReason !== "not_due"
      ? getAutoStartReasonCopy(copy, item.autoStartReason)
      : null;
    const autoStartReasonTitle = autoStartReasonCopy ? `${copy.autoStartReasonLabel}: ${autoStartReasonCopy}` : undefined;

    return (
      <div
        className={cn(
          "flex h-full min-h-0 gap-2 overflow-hidden rounded-[0.85rem] border-2 p-2 text-left shadow-xs",
          hasConflict
            ? "border-destructive/50 bg-destructive/10"
            : isCurrent
              ? "border-primary/70 bg-primary/18"
              : "border-primary/45 bg-primary/12",
        )}
        style={sourceStyle}
        title={autoStartReasonTitle}
        aria-label={autoStartReasonTitle ? `${info.event.title}. ${autoStartReasonTitle}` : info.event.title}
        draggable={!isPending}
        onDragStart={() => {
          setHiddenTaskId(item.taskId);
          onScheduledDragStart(item);
        }}
        onDragEnd={() => {
          setHiddenTaskId(null);
          onDragEnd();
        }}
      >
        <div
          className={cn("w-1 shrink-0 rounded-full", !sourceManaged && (isCurrent ? "bg-primary" : getPriorityAccent(item.priority)))}
          style={sourceManaged ? { backgroundColor: sourceManaged.sourceColor } : undefined}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <p className="line-clamp-1 text-sm font-medium text-foreground">{info.event.title}</p>
            <div className="flex shrink-0 items-center gap-1">
              {sourceManaged ? (
                <Badge
                  variant="outline"
                  className="gap-1 px-1.5 py-0 text-[10px]"
                  title={externalCalendarMessages.readOnlyLabel}
                >
                  <CalendarDays className="size-3" />
                  <span className="max-w-20 truncate">{sourceManaged.sourceName}</span>
                </Badge>
              ) : null}
              <Badge variant="secondary" className="px-2 py-0 text-[10px]">
                {item.priority}
              </Badge>
            </div>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {formatTimeRange(info.event.start, info.event.end, locale, copy)}
          </p>
          {sourceManaged ? (
            <span
              className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground"
              title={externalCalendarMessages.readOnlyLabel}
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: sourceManaged.sourceColor }}
              />
              <CalendarDays className="size-3 shrink-0" />
              <span className="truncate">{sourceManaged.sourceName}</span>
            </span>
          ) : null}
          {hasConflict || item.scheduleStatus === "Overdue" || item.approvalPendingCount ? (
            <div className="flex flex-wrap gap-1 text-[10px]">
              {hasConflict ? <Badge variant="destructive">{copy.conflictPreviewLabel}</Badge> : null}
              {item.scheduleStatus === "Overdue" ? <Badge variant="destructive">{copy.overdue}</Badge> : null}
              {item.approvalPendingCount ? <Badge variant="secondary">{copy.approvalPending}</Badge> : null}
            </div>
          ) : null}
          <AutoStartReasonNote item={item} copy={copy} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/45 px-3 py-2 sm:px-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {formatDayHeading(dayDate, locale, copy)}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <DayTimelineSummary items={items} dayDate={dayDate} /> · {" "}
            {items.length} {items.length === 1 ? copy.blockSingular : copy.blockPlural}
          </p>
        </div>
        <div className="rounded-full border border-border/45 bg-card/75 px-2.5 py-1 text-right text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <p className="font-semibold uppercase">
            {draggedItem ? copy.dropOntoLane : copy.clickOrDrag}
          </p>
        </div>
      </div>

      <div
        ref={dropZoneRef}
        role="region"
        aria-label={`Schedule drop zone for ${formatDayHeading(dayDate, locale, copy)}`}
        className={cn(
          "chrona-fullcalendar relative min-h-0 flex-1 overflow-hidden bg-muted/40 p-1.5 sm:p-2",
          draggedItem && "chrona-fullcalendar-drop-mode",
        )}
        onDragOver={handleDragOver}
        onScrollCapture={syncTimelineScrollTop}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragPreview(null);
          }
        }}
        onDrop={(event) => {
          void handleDrop(event);
        }}
      >
        <div className="relative h-full min-h-[40rem] rounded-2xl border border-border/75 bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04),0_16px_38px_rgba(15,23,42,0.08)]">
          {selectedDay === getTodayKey() ? (
            <span className="sr-only" aria-label="Current time marker" />
          ) : null}
          <div className="sr-only">
            {items.map((item) => (
              <div key={item.workBlockId ?? item.taskId}>
                <a
                  href={buildScheduleHref(selectedDay, item.taskId, item.workBlockId)}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelectTask(item.workBlockId ?? item.taskId);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                      return;
                    }

                    event.preventDefault();
                    void handleKeyboardAdjust(item, event.key);
                  }}
                >
                  {item.title}
                  {item.sourceManaged ? ` · ${item.sourceManaged.sourceName} · ${externalCalendarMessages.readOnlyLabel}` : null}
                </a>
                <button
                  type="button"
                  onMouseDown={() => handleAccessibleResizeStart(item)}
                >
                  {copy.resizeHandleLabel} {item.title}
                </button>
              </div>
            ))}
            {externalEvents.map((event) => (
              <div key={event.id}>
                <span>
                  {event.title} · {event.sourceName} · {externalCalendarMessages.readOnlyLabel}
                </span>
                {event.overlapsScheduledTask ? <span> · {externalCalendarMessages.overlapsTaskLabel}</span> : null}
              </div>
            ))}
          </div>
          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin, interactionPlugin]}
            initialView="timeGridDay"
            initialDate={dayDate}
            headerToolbar={false}
            allDaySlot={false}
            dayHeaders={false}
            height="100%"
            expandRows={false}
            slotMinTime={fullCalendarTime(0)}
            slotMaxTime={fullCalendarTime(24)}
            scrollTime={fullCalendarTime(WORKDAY_START_HOUR)}
            slotDuration={`00:${String(TIMELINE_SLOT_MINUTES).padStart(2, "0")}:00`}
            snapDuration={`00:${String(TIMELINE_SLOT_MINUTES).padStart(2, "0")}:00`}
            slotLabelFormat={{ hour: "numeric", minute: "2-digit" }}
            nowIndicator={selectedDay === getTodayKey()}
            selectable={!isPending && !draggedItem}
            selectMirror={true}
            unselectAuto={false}
            editable={!isPending}
            eventDurationEditable={!isPending}
            eventStartEditable={!isPending}
            eventOverlap={false}
            eventAllow={handleEventAllow}
            eventResizableFromStart={false}
            datesSet={handleDatesSet}
            dateClick={handleDateClick}
            select={handleDateSelect}
            eventClick={(info) => {
              info.jsEvent.preventDefault();
              const clicked = selectedItemById.get(info.event.id);
              onSelectTask(clicked ? clicked.workBlockId ?? clicked.taskId : info.event.id);
            }}
            eventDragStart={(info) => setHiddenTaskId(info.event.id)}
            eventDragStop={() => {
              setHiddenTaskId(null);
              setDragPreview(null);
            }}
            eventDrop={(info) => {
              void handleEventDrop(info);
            }}
            eventResize={(info) => {
              void handleEventResize(info);
            }}
            events={calendarEvents}
            eventContent={renderEventContent}
          />

          <div className="pointer-events-none absolute inset-x-[70px] top-0 h-full sm:inset-x-[82px]">
            <ScheduleGhostBlockLayer preview={ghostPreview} mapMinuteToY={mapMinuteToY} />
            {draggedItem && dragPreview ? (
              <TimelinePlacementCard
                preview={dragPreview}
                scrollTop={timelineScrollTop}
                title={draggedItem.title}
                kind={draggedItem.kind}
              />
            ) : null}
          </div>

          {items.length === 0 ? (
            <div className="pointer-events-none absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-3xl border border-dashed border-primary/30 bg-card/95 p-5 text-sm text-muted-foreground shadow-sm sm:left-24 sm:right-6">
              <p className="font-medium text-foreground">{copy.emptyDayLane}</p>
              <p className="mt-1">{copy.emptyDayLaneDescription}</p>
            </div>
          ) : null}
        </div>

        {composerDraft ? (
          <TimelineComposer
            draft={composerDraft}
            defaultExecutionRuntime={defaultExecutionRuntime}
            availableAiClients={availableAiClients}
            isPending={isPending}
            onClose={closeComposer}
            onCreate={async (input) => {
              await onCreateTaskBlock(input);
              closeComposer();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
