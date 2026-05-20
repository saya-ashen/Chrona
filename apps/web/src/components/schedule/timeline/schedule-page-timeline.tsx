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
} from "@fullcalendar/core";
import { useMemo, useRef, useState, type DragEvent } from "react";
import {
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
  getSchedulePageCopy,
  TIMELINE_SLOT_MINUTES,
} from "@/components/schedule/schedule-page-copy";
import { TaskCreateDialog } from "@/components/schedule/dialogs/task-create-dialog";
import { DayTimelineSummary } from "@/components/schedule/panels/schedule-page-panels";
import { TimelinePlacementCard } from "@/components/schedule/timeline/schedule-timeline-primitives";
import { ScheduleGhostBlockLayer } from "@/components/global-ai-sidebar/schedule-ghost-block-layer";
import type { ScheduleGhostBlockPreview } from "@chrona/contracts";
import type {
  ScheduledItem,
  TimelineCreateInput,
  TimelineDragItem,
  TimelinePlacementPreview,
} from "@/components/schedule/schedule-page-types";
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
} from "@/components/schedule/schedule-page-utils";
import { type TaskConfigExecutionRuntime } from "@/components/schedule/forms/task-config-form";
import { Badge } from "@/components/ui/badge";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { cn } from "@/lib/utils";

const TIMELINE_HOUR_HEIGHT = 56;
const WORKDAY_START_HOUR = 8;

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

function buildDragItem(item: ScheduledItem, startAt: Date, endAt: Date): TimelineDragItem {
  return {
    kind: "scheduled",
    taskId: item.taskId,
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
  isPending,
  onClose,
  onCreate,
}: {
  draft: TimelinePlacementPreview;
  defaultExecutionRuntime: string;
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
      onClose={onClose}
      onSubmit={async (input) => {
        await onCreate({
          title: input.title,
          description: input.description,
          priority: input.priority,
          autoExecute: input.autoExecute,
          dueAt: input.dueAt,
          executionRuntime: defaultExecutionRuntime,
          executionConfig: {},
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt,
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
  executionRuntimes: _executionRuntimes,
  defaultExecutionRuntime,
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
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
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
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
  const selectedItemById = useMemo(
    () => new Map(items.map((item) => [item.taskId, item])),
    [items],
  );
  const calendarRef = useRef<FullCalendar | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const [composerDraft, setComposerDraft] = useState<TimelinePlacementPreview | null>(null);
  const [dragPreview, setDragPreview] = useState<TimelinePlacementPreview | null>(null);
  const [hiddenTaskId, setHiddenTaskId] = useState<string | null>(null);

  const mapMinuteToY = (minute: number) => {
    const clamped = Math.min(Math.max(minute, 0), 24 * 60);
    return (clamped / 60) * TIMELINE_HOUR_HEIGHT;
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

  const calendarEvents = useMemo<EventInput[]>(() => items.map((item) => {
    const start = item.scheduledStartAt ?? dateForMinute(dayDate, 9 * 60);
    const end = item.scheduledEndAt ?? dateForMinute(
      dayDate,
      minutesFromDate(start) + DEFAULT_SCHEDULE_BLOCK_MINUTES,
    );
    const isCurrent = selectedDay === getTodayKey() && start.getTime() <= Date.now() && end.getTime() >= Date.now();
    const isPast = selectedDay === getTodayKey() && end.getTime() < Date.now();
    const hasConflict = conflictTaskIds?.has(item.taskId) ?? false;

    return {
      id: item.taskId,
      title: item.title,
      start,
      end,
      editable: !isPending,
      durationEditable: !isPending,
      startEditable: !isPending,
      classNames: [
        "chrona-calendar-event",
        selectedTaskId === item.taskId ? "chrona-calendar-event-selected" : "",
        isCurrent ? "chrona-calendar-event-current" : "",
        isPast ? "chrona-calendar-event-past" : "",
        hasConflict ? "chrona-calendar-event-conflict" : "",
        hiddenTaskId === item.taskId ? "chrona-calendar-event-hidden" : "",
      ].filter(Boolean),
      extendedProps: { item, hasConflict, isCurrent },
    };
  }), [conflictTaskIds, dayDate, hiddenTaskId, isPending, items, selectedDay, selectedTaskId]);

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

  function handleDatesSet(_info: DatesSetArg) {
    window.requestAnimationFrame(() => {
      const calendarScroller = dropZoneRef.current?.querySelector(".fc-scroller") as HTMLElement | null;
      if (calendarScroller && calendarScroller.scrollTop < WORKDAY_START_HOUR * TIMELINE_HOUR_HEIGHT * 0.75) {
        calendarScroller.scrollTop = WORKDAY_START_HOUR * TIMELINE_HOUR_HEIGHT;
      }
    });
  }

  function renderEventContent(info: EventContentArg) {
    const item = info.event.extendedProps.item as ScheduledItem | undefined;
    if (!item) {
      return <span>{info.event.title}</span>;
    }

    const hasConflict = Boolean(info.event.extendedProps.hasConflict);
    const isCurrent = Boolean(info.event.extendedProps.isCurrent);

    return (
      <div
        className="flex h-full min-h-0 gap-2 overflow-hidden p-2 text-left"
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
        <div className={cn("w-1 shrink-0 rounded-full", isCurrent ? "bg-primary" : getPriorityAccent(item.priority))} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <p className="line-clamp-1 text-sm font-medium text-foreground">{info.event.title}</p>
            <Badge variant="secondary" className="shrink-0 px-2 py-0 text-[10px]">
              {item.priority}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {formatTimeRange(info.event.start, info.event.end, locale, copy)}
          </p>
          {hasConflict || item.scheduleStatus === "Overdue" || item.approvalPendingCount ? (
            <div className="flex flex-wrap gap-1 text-[10px]">
              {hasConflict ? <Badge variant="destructive">{copy.conflictPreviewLabel}</Badge> : null}
              {item.scheduleStatus === "Overdue" ? <Badge variant="destructive">{copy.overdue}</Badge> : null}
              {item.approvalPendingCount ? <Badge variant="secondary">{copy.approvalPending}</Badge> : null}
            </div>
          ) : null}
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
        <div className="rounded-full border border-border/45 bg-white/75 px-2.5 py-1 text-right text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
          "chrona-fullcalendar relative min-h-0 flex-1 overflow-hidden bg-slate-50/85 p-1.5 sm:p-2",
          draggedItem && "chrona-fullcalendar-drop-mode",
        )}
        onDragOver={handleDragOver}
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
              <div key={item.taskId}>
                <a
                  href={buildScheduleHref(selectedDay, item.taskId)}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelectTask(item.taskId);
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
                </a>
                <button
                  type="button"
                  onMouseDown={() => handleAccessibleResizeStart(item)}
                >
                  {copy.resizeHandleLabel} {item.title}
                </button>
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
            eventResizableFromStart={false}
            datesSet={handleDatesSet}
            dateClick={handleDateClick}
            select={handleDateSelect}
            eventClick={(info) => {
              info.jsEvent.preventDefault();
              onSelectTask(info.event.id);
            }}
            eventDragStart={(info) => setHiddenTaskId(info.event.id)}
            eventDragStop={() => setHiddenTaskId(null)}
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
                title={draggedItem.title}
                kind={draggedItem.kind}
              />
            ) : null}
          </div>

          {items.length === 0 ? (
            <div className="pointer-events-none absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-3xl border border-dashed border-primary/30 bg-white/95 p-5 text-sm text-muted-foreground shadow-[0_12px_32px_rgba(15,23,42,0.09)] sm:left-24 sm:right-6">
              <p className="font-medium text-foreground">{copy.emptyDayLane}</p>
              <p className="mt-1">{copy.emptyDayLaneDescription}</p>
            </div>
          ) : null}
        </div>

        {composerDraft ? (
          <TimelineComposer
            draft={composerDraft}
            defaultExecutionRuntime={defaultExecutionRuntime}
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
