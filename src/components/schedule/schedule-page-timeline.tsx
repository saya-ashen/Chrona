"use client";

import { Plus } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import {
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
  getSchedulePageCopy,
  TASK_CONFIG_PRESETS,
  TIMELINE_COMPOSER_HEIGHT,
  TIMELINE_COMPOSER_MARGIN,
  TIMELINE_SLOT_MINUTES,
} from "@/components/schedule/schedule-page-copy";
import { DayTimelineSummary } from "@/components/schedule/schedule-page-panels";
import {
  ScheduledTimelineBlock,
  TimelinePlacementCard,
} from "@/components/schedule/schedule-timeline-primitives";
import type {
  ScheduledDayGroup,
  ScheduledItem,
  TimelineCreateInput,
  TimelineDragItem,
  TimelineInteractionMode,
  TimelinePlacementPreview,
  TimelineResizeDraft,
} from "@/components/schedule/schedule-page-types";
import {
  buildCompressedTimeline,
  buildScheduleHref,
  buildTimelinePlacementPreview,
  clampScheduledEndMinute,
  clampScheduledStartMinute,
  describeOwner,
  formatDayHeading,
  formatDurationMinutes,
  formatShortDay,
  formatTime,
  formatTimeRange,
  getTodayKey,
  snapMinuteToGrid,
  toDateForDay,
} from "@/components/schedule/schedule-page-utils";
import {
  TaskConfigForm,
  type TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { useI18n, useLocale } from "@/i18n/client";
import { cn } from "@/lib/utils";

function TimelineCreateComposer({
  draft,
  timelineHeight,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  onClose,
  onCreate,
}: {
  draft: DragPreview;
  timelineHeight: number;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  onClose: () => void;
  onCreate: (input: TimelineCreateInput) => Promise<void>;
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
  const composerTop = Math.min(
    Math.max(
      draft.top + draft.height - TIMELINE_COMPOSER_HEIGHT,
      TIMELINE_COMPOSER_MARGIN,
    ),
    Math.max(
      TIMELINE_COMPOSER_MARGIN,
      timelineHeight - TIMELINE_COMPOSER_HEIGHT - TIMELINE_COMPOSER_MARGIN,
    ),
  );

  return (
    <div
      data-timeline-composer
      className="absolute left-3 z-20 max-h-[384px] w-[min(420px,calc(100%-1.5rem))] overflow-y-auto rounded-2xl border border-primary/30 bg-background/98 p-4 shadow-xl"
      style={{ top: `${composerTop}px` }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {copy.createTaskBlock}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatTimeRange(draft.startAt, draft.endAt, locale, copy)}
          </p>
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={onClose}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {copy.cancel}
        </button>
      </div>

      <TaskConfigForm
        runtimeAdapters={runtimeAdapters}
        defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
        compact
        isPending={isPending}
        presets={TASK_CONFIG_PRESETS}
        submitLabel={copy.createAndSchedule}
        pendingLabel={copy.creating}
        onSubmitAction={async (input) => {
          await onCreate({
            ...input,
            scheduledStartAt: draft.startAt,
            scheduledEndAt: draft.endAt,
          });
        }}
      />
    </div>
  );
}

export function WeekStrip({
  groups,
  selectedDay,
}: {
  groups: ScheduledDayGroup[];
  selectedDay: string;
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);

  return (
    <SurfaceCard as="div" variant="inset" padding="sm" className="rounded-2xl">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
        {groups.map((group) => {
          const isActive = group.key === selectedDay;

          return (
            <LocalizedLink
              key={group.key}
              href={buildScheduleHref(group.key)}
              className={cn(
                "rounded-2xl border px-3 py-3 transition-colors hover:border-primary/40 hover:bg-background",
                isActive
                  ? "border-primary/60 bg-primary/5 shadow-sm"
                  : "border-border/60 bg-background/70",
              )}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {formatShortDay(group.date, locale, copy)}
                  </p>
                  {group.riskCount > 0 ? (
                    <StatusBadge tone="critical">{copy.riskDay}</StatusBadge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{group.label}</p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge>
                    {group.items.length}{" "}
                    {group.items.length === 1
                      ? copy.blockSingular
                      : copy.blockPlural}
                  </StatusBadge>
                  {group.proposalCount > 0 ? (
                    <StatusBadge tone="info">
                      {group.proposalCount}{" "}
                      {group.proposalCount === 1
                        ? copy.proposalSingular
                        : copy.proposalPlural}
                    </StatusBadge>
                  ) : null}
                </div>
              </div>
            </LocalizedLink>
          );
        })}
      </div>
    </SurfaceCard>
  );
}

export function DayTimeline({
  items,
  dayDate,
  selectedDay,
  selectedTaskId,
  draggedItem,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  onScheduleDrop,
  onCreateTaskBlock,
  onScheduledDragStart,
  onDragEnd,
}: {
  items: ScheduledItem[];
  dayDate: Date;
  selectedDay: string;
  selectedTaskId?: string;
  draggedItem: TimelineDragItem | null;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  onScheduleDrop: (
    item: TimelineDragItem,
    startAt: Date,
    endAt: Date,
  ) => Promise<void>;
  onCreateTaskBlock: (input: TimelineCreateInput) => Promise<void>;
  onScheduledDragStart: (item: ScheduledItem) => void;
  onDragEnd: () => void;
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
  const compressedTimeline = useMemo(
    () => buildCompressedTimeline(items),
    [items],
  );
  const timelineHeight = compressedTimeline.totalVisualHeight;
  const isToday = selectedDay === getTodayKey();
  const currentTimeMarker = useMemo(() => {
    if (!isToday) {
      return null;
    }

    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();

    return {
      top: compressedTimeline.mapMinuteToY(minute),
      label: formatTime(now, locale),
    };
  }, [compressedTimeline, isToday, locale]);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [interactionMode, setInteractionMode] = useState<TimelineInteractionMode>("idle");
  const [dragPreview, setDragPreview] = useState<TimelinePlacementPreview | null>(null);
  const [composerDraft, setComposerDraft] = useState<TimelinePlacementPreview | null>(null);
  const [resizeDraft, setResizeDraft] = useState<TimelineResizeDraft | null>(null);
  const resizeDraftRef = useRef<TimelineResizeDraft | null>(null);

  function updateResizeDraft(nextDraft: TimelineResizeDraft | null) {
    resizeDraftRef.current = nextDraft;
    setResizeDraft(nextDraft);
  }

  function closeComposer() {
    setInteractionMode("idle");
    setComposerDraft(null);
  }

  useEffect(() => {
    if (!composerDraft || !scrollContainerRef.current) {
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    const composerTop = Math.min(
      Math.max(
        composerDraft.top + composerDraft.height - TIMELINE_COMPOSER_HEIGHT,
        TIMELINE_COMPOSER_MARGIN,
      ),
      Math.max(
        TIMELINE_COMPOSER_MARGIN,
        timelineHeight - TIMELINE_COMPOSER_HEIGHT - TIMELINE_COMPOSER_MARGIN,
      ),
    );
    const visibleTop = scrollContainer.scrollTop;
    const visibleBottom = visibleTop + scrollContainer.clientHeight;
    const composerBottom = composerTop + TIMELINE_COMPOSER_HEIGHT;

    function setScrollTop(top: number) {
      if (typeof scrollContainer.scrollTo === "function") {
        scrollContainer.scrollTo({ top, behavior: "smooth" });
        return;
      }

      scrollContainer.scrollTop = top;
    }

    if (composerTop < visibleTop + TIMELINE_COMPOSER_MARGIN) {
      setScrollTop(Math.max(composerTop - 16, 0));
      return;
    }

    if (composerBottom > visibleBottom - TIMELINE_COMPOSER_MARGIN) {
      setScrollTop(
        Math.max(composerBottom - scrollContainer.clientHeight + 16, 0),
      );
    }
  }, [composerDraft, timelineHeight]);

  function getMinuteFromClientY(clientY: number) {
    const timeline = timelineRef.current;

    if (!timeline) {
      return 9 * 60;
    }

    const rect = timeline.getBoundingClientRect();

    if (rect.height <= 0) {
      return 9 * 60;
    }

    return compressedTimeline.mapYToMinute(clientY - rect.top);
  }

  function buildPlacementPreview(
    startMinute: number,
    endMinute: number,
    source: TimelinePlacementPreview["source"],
    taskId?: string,
  ) {
    return buildTimelinePlacementPreview({
      selectedDay,
      startMinute,
      endMinute,
      compressedTimeline,
      items,
      taskId,
      source,
    });
  }

  function getDragPreview(clientY: number) {
    const snappedStartMinute = clampScheduledStartMinute(
      snapMinuteToGrid(getMinuteFromClientY(clientY)),
    );
    const durationMinutes = draggedItem?.durationMinutes ?? DEFAULT_SCHEDULE_BLOCK_MINUTES;
    const endMinute = Math.min(snappedStartMinute + durationMinutes, 24 * 60);

    return buildPlacementPreview(
      snappedStartMinute,
      endMinute,
      "drag",
      draggedItem?.kind === "scheduled" ? draggedItem.taskId : undefined,
    );
  }

  function createDraftAtMinute(minute: number) {
    const snappedStartMinute = clampScheduledStartMinute(snapMinuteToGrid(minute));
    const endMinute = Math.min(snappedStartMinute + DEFAULT_SCHEDULE_BLOCK_MINUTES, 24 * 60);
    return buildPlacementPreview(snappedStartMinute, endMinute, "create");
  }

  function openComposerAtMinute(minute: number) {
    setInteractionMode("creating");
    updateResizeDraft(null);
    setDragPreview(null);
    setComposerDraft(createDraftAtMinute(minute));
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!draggedItem || isPending) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setInteractionMode("dragging");
    setComposerDraft(null);
    updateResizeDraft(null);
    setDragPreview(getDragPreview(event.clientY));
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setInteractionMode("idle");
    setDragPreview(null);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!draggedItem || isPending) {
      return;
    }

    event.preventDefault();
    const preview = getDragPreview(event.clientY) ?? dragPreview;
    setInteractionMode("idle");
    setDragPreview(null);

    if (!preview || preview.hasConflict) {
      return;
    }

    await onScheduleDrop(draggedItem, preview.startAt, preview.endAt);
  }

  async function commitKeyboardAdjustment(
    item: ScheduledItem,
    adjustment: {
      startMinute: number;
      endMinute: number;
    },
  ) {
    if (isPending || draggedItem) {
      return;
    }

    const preview = buildPlacementPreview(
      adjustment.startMinute,
      adjustment.endMinute,
      "resize",
      item.taskId,
    );

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

  async function handleKeyboardAdjust(
    item: ScheduledItem,
    key: "ArrowUp" | "ArrowDown",
    mode: "move" | "resize",
  ) {
    if (!item.scheduledStartAt) {
      return;
    }

    const step = key === "ArrowUp" ? -TIMELINE_SLOT_MINUTES : TIMELINE_SLOT_MINUTES;
    const currentStartMinute =
      item.scheduledStartAt.getHours() * 60 + item.scheduledStartAt.getMinutes();
    const currentEndMinute = item.scheduledEndAt
      ? item.scheduledEndAt.getHours() * 60 + item.scheduledEndAt.getMinutes()
      : currentStartMinute + DEFAULT_SCHEDULE_BLOCK_MINUTES;

    if (mode === "move") {
      const duration = Math.max(
        currentEndMinute - currentStartMinute,
        TIMELINE_SLOT_MINUTES,
      );
      const nextStartMinute = clampScheduledStartMinute(currentStartMinute + step);
      const nextEndMinute = Math.min(nextStartMinute + duration, 24 * 60);

      await commitKeyboardAdjustment(item, {
        startMinute: nextStartMinute,
        endMinute: nextEndMinute,
      });
      return;
    }

    const nextEndMinute = clampScheduledEndMinute(
      currentStartMinute,
      currentEndMinute + step,
    );

    if (nextEndMinute === currentEndMinute) {
      return;
    }

    await commitKeyboardAdjustment(item, {
      startMinute: currentStartMinute,
      endMinute: nextEndMinute,
    });
  }

  function handleResizeStart(item: ScheduledItem, _clientY: number) {
    if (isPending || !item.scheduledStartAt) {
      return;
    }

    const startMinute = item.scheduledStartAt.getHours() * 60 + item.scheduledStartAt.getMinutes();
    const currentEndMinute = item.scheduledEndAt
      ? item.scheduledEndAt.getHours() * 60 + item.scheduledEndAt.getMinutes()
      : startMinute + DEFAULT_SCHEDULE_BLOCK_MINUTES;
    const initialPreview = buildPlacementPreview(startMinute, currentEndMinute, "resize", item.taskId);
    const initialDraft = { ...initialPreview, taskId: item.taskId, edge: "end" } satisfies TimelineResizeDraft;

    setInteractionMode("resizing");
    setComposerDraft(null);
    setDragPreview(null);
    updateResizeDraft(initialDraft);

    function handlePointerMove(moveEvent: globalThis.MouseEvent) {
      const snappedEndMinute = clampScheduledEndMinute(
        startMinute,
        snapMinuteToGrid(getMinuteFromClientY(moveEvent.clientY)),
      );
      const nextPreview = buildPlacementPreview(startMinute, snappedEndMinute, "resize", item.taskId);
      updateResizeDraft({ ...nextPreview, taskId: item.taskId, edge: "end" });
    }

    async function handlePointerUp() {
      window.removeEventListener("mousemove", handlePointerMove);
      setInteractionMode("idle");

      const finalDraft = resizeDraftRef.current ?? initialDraft;
      updateResizeDraft(null);

      if (finalDraft.hasConflict) {
        return;
      }

      await onScheduleDrop(
        {
          kind: "scheduled",
          taskId: item.taskId,
          title: item.title,
          dueAt: item.dueAt,
          durationMinutes: finalDraft.endMinute - finalDraft.startMinute,
        },
        item.scheduledStartAt,
        finalDraft.endAt,
      );
    }

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener(
      "mouseup",
      () => {
        void handlePointerUp();
      },
      { once: true },
    );
  }

  function handleTimelineClick(event: MouseEvent<HTMLDivElement>) {
    if (draggedItem || isPending) {
      return;
    }

    const target = event.target as HTMLElement;

    if (
      target.closest("[data-timeline-block]") ||
      target.closest("[data-timeline-composer]")
    ) {
      return;
    }

    openComposerAtMinute(getMinuteFromClientY(event.clientY));
  }

  return (
    <SurfaceCard as="div" variant="inset" className="rounded-2xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {formatDayHeading(dayDate, locale, copy)}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            <DayTimelineSummary items={items} dayDate={dayDate} /> · {" "}
            {items.length} {items.length === 1 ? copy.blockSingular : copy.blockPlural}
          </p>
        </div>
        <div className="text-right text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => openComposerAtMinute(9 * 60)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Plus className="size-3.5" />
              {copy.createTaskBlock}
            </button>
          </div>
          <p className="mt-2">
            {draggedItem ? copy.dropOntoLane : copy.clickOrDrag}
          </p>
          <p className="mt-1 normal-case tracking-normal">
            {copy.timelineCompressedPrefix} {" "}
            {formatDurationMinutes(Math.round(compressedTimeline.visualMinutes))}
            {compressedTimeline.compressedGapCount > 0
              ? ` · ${compressedTimeline.compressedGapCount} ${copy.quietHoursCompressedSuffix}`
              : ""}
          </p>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="max-h-[72vh] overflow-y-auto rounded-2xl border border-border/60 bg-card/40 pr-2"
      >
        <div className="flex gap-3">
          <div className="sticky left-0 top-0 hidden w-16 shrink-0 self-start bg-background/95 py-2 sm:block">
            <div className="relative" style={{ height: `${timelineHeight}px` }}>
              {compressedTimeline.hours.map((hour) => (
                <div
                  key={hour.hour}
                  className="absolute left-0 right-0"
                  style={{ top: `${hour.visualStart}px` }}
                >
                  <span className="-translate-y-1/2 text-xs text-muted-foreground">
                    {formatTime(new Date(2026, 0, 1, hour.hour, 0), locale)}
                  </span>
                </div>
              ))}
              <div
                className="absolute left-0 right-0"
                style={{ top: `${timelineHeight}px` }}
              >
                <span className="-translate-y-1/2 text-xs text-muted-foreground">
                  11:59 PM
                </span>
              </div>
            </div>
          </div>

          <div
            ref={timelineRef}
            role="region"
            aria-label={`Schedule drop zone for ${formatDayHeading(dayDate, locale, copy)}`}
            tabIndex={0}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={(event) => {
              void handleDrop(event);
            }}
            onClick={handleTimelineClick}
            className={cn(
              "relative flex-1 rounded-2xl border border-border/60 bg-card/60 outline-none transition-colors",
              draggedItem && "border-primary/50 bg-primary/5",
            )}
            style={{ height: `${timelineHeight}px` }}
          >
            {compressedTimeline.hours.map((hour) => (
              <div
                key={hour.hour}
                className="absolute inset-x-0"
                style={{
                  top: `${hour.visualStart}px`,
                  height: `${hour.visualHeight}px`,
                }}
              >
                <div className="absolute inset-x-0 top-0 border-t border-dashed border-border/70" />
                {!hour.active ? (
                  <div className="absolute inset-x-3 inset-y-1 rounded-md bg-muted/35" />
                ) : null}
              </div>
            ))}
            <div
              className="absolute inset-x-0 border-t border-dashed border-border/70"
              style={{ top: `${timelineHeight}px` }}
            />

            {currentTimeMarker ? (
              <div
                aria-label={`Current time ${currentTimeMarker.label}`}
                className="pointer-events-none absolute inset-x-0 z-10"
                style={{ top: `${currentTimeMarker.top}px` }}
              >
                <div className="flex items-center gap-2 -translate-y-1/2 px-3">
                  <span className="size-2 rounded-full bg-primary" />
                  <div className="h-px flex-1 bg-primary/80" />
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {currentTimeMarker.label}
                  </span>
                </div>
              </div>
            ) : null}

            {items.length === 0 ? (
              <div className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 rounded-2xl border border-dashed border-primary/30 bg-background/92 p-4 text-sm text-muted-foreground shadow-sm">
                <p className="font-medium text-foreground">{copy.emptyDayLane}</p>
                <p className="mt-1">{copy.emptyDayLaneDescription}</p>
              </div>
            ) : null}

            {composerDraft ? (
              <TimelineCreateComposer
                draft={composerDraft}
                timelineHeight={timelineHeight}
                runtimeAdapters={runtimeAdapters}
                defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
                isPending={isPending}
                onClose={closeComposer}
                onCreate={async (input) => {
                  await onCreateTaskBlock(input);
                  closeComposer();
                }}
              />
            ) : null}

            {draggedItem && dragPreview ? (
              <TimelinePlacementCard
                preview={dragPreview}
                title={draggedItem.title}
                kind={draggedItem.kind}
              />
            ) : null}

            {resizeDraft ? (
              <TimelinePlacementCard
                preview={resizeDraft}
                title={items.find((item) => item.taskId === resizeDraft.taskId)?.title ?? copy.adjustBlock}
                kind="scheduled"
              />
            ) : null}

            {items.map((item) => {
              const start = item.scheduledStartAt
                ? item.scheduledStartAt.getHours() * 60 + item.scheduledStartAt.getMinutes()
                : 0;
              const end = item.scheduledEndAt
                ? item.scheduledEndAt.getHours() * 60 + item.scheduledEndAt.getMinutes()
                : start + 60;
              const safeEnd = Math.max(end, start + 45);
              const top = compressedTimeline.mapMinuteToY(start);
              const height = Math.max(
                compressedTimeline.mapMinuteToY(safeEnd) - top,
                56,
              );

              return (
                <ScheduledTimelineBlock
                  key={item.taskId}
                  item={item}
                  selectedDay={selectedDay}
                  top={top}
                  height={height}
                  isSelected={selectedTaskId === item.taskId}
                  isPending={isPending}
                  isHidden={interactionMode === "resizing" && resizeDraft?.taskId === item.taskId}
                  onDragStart={onScheduledDragStart}
                  onDragEnd={onDragEnd}
                  onResizeStart={handleResizeStart}
                  onKeyboardAdjust={handleKeyboardAdjust}
                />
              );
            })}
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}
