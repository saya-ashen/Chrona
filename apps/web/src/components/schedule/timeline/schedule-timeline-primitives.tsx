"use client";

import { AlertTriangle, Move } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type {
  ScheduledItem,
  TimelinePlacementPreview,
} from "@/components/schedule/schedule-page-types";
import {
  buildScheduleHref,
  formatTimeRange,
  getPriorityAccent,
  getPriorityTone,
} from "@/components/schedule/schedule-page-utils";
import { Badge } from "@/components/ui/badge";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { cn } from "@/lib/utils";

const DRAG_EMPTY_IMAGE = typeof Image !== "undefined" ? new Image() : null;
if (DRAG_EMPTY_IMAGE) {
  DRAG_EMPTY_IMAGE.src =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
}

export function TimelinePlacementCard({
  preview,
  scrollTop = 0,
  title,
  kind,
}: {
  preview: TimelinePlacementPreview;
  scrollTop?: number;
  title: string;
  kind: "queue" | "scheduled";
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-2 right-2 z-20 rounded-2xl border-2 p-3 shadow-lg ring-2 ring-background/80",
        preview.hasConflict
          ? "border-destructive/50 bg-destructive/10"
          : "border-dashed border-primary/80 bg-primary/18",
      )}
      style={{
        top: `${preview.top - scrollTop}px`,
        minHeight: "56px",
        height: `${preview.height}px`,
      }}
    >
      <div className="flex h-full gap-3 overflow-hidden">
        <div
          className={cn(
            "w-1 shrink-0 rounded-full",
            preview.hasConflict ? "bg-destructive" : "bg-primary",
          )}
        />
        <div className="min-w-0 space-y-1">
          <p className="line-clamp-1 text-sm font-medium text-foreground">{title}</p>
          <p className="inline-flex rounded-full bg-background/90 px-2 py-0.5 text-xs font-semibold text-foreground shadow-sm">
            {formatTimeRange(preview.startAt, preview.endAt, locale, copy)}
          </p>
          <p className="text-xs text-muted-foreground">
            {preview.source === "resize"
              ? copy.resizePreviewLabel
              : kind === "queue"
                ? copy.dropToSchedule
                : copy.dropToMoveBlock}
          </p>
          {preview.hasConflict ? (
            <p className="text-xs font-medium text-destructive">{copy.conflictPreviewLabel}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ScheduledTimelineBlock({
  item,
  selectedDay,
  top,
  height,
  isSelected,
  isCurrent,
  isPast,
  hasConflict,
  isPending,
  isHidden,
  onDragStart,
  onDragEnd,
  onResizeStart,
  onKeyboardAdjust,
}: {
  item: ScheduledItem;
  selectedDay: string;
  top: number;
  height: number;
  isSelected: boolean;
  isCurrent?: boolean;
  isPast?: boolean;
  hasConflict?: boolean;
  isPending: boolean;
  isHidden?: boolean;
  onDragStart: (item: ScheduledItem) => void;
  onDragEnd: () => void;
  onResizeStart: (item: ScheduledItem, clientY: number) => void;
  onKeyboardAdjust: (
    item: ScheduledItem,
    key: "ArrowUp" | "ArrowDown",
    mode: "move" | "resize",
  ) => Promise<void>;
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
  const accent = getPriorityAccent(item.priority);

  return (
    <LocalizedLink
      data-timeline-block
      href={buildScheduleHref(selectedDay, item.taskId)}
      draggable={!isPending}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.taskId);
        if (DRAG_EMPTY_IMAGE) {
          event.dataTransfer.setDragImage(DRAG_EMPTY_IMAGE, 0, 0);
        }
        onDragStart(item);
      }}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => {
        if (!isSelected || isPending) {
          return;
        }

        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
          return;
        }

        event.preventDefault();
        void onKeyboardAdjust(item, event.key, event.shiftKey ? "resize" : "move");
      }}
      aria-label={item.title}
      className={cn(
        "absolute left-2 right-2 rounded-2xl border bg-card/98 p-2.5 shadow-md transition-all hover:-translate-y-0.5 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:left-3 sm:right-3 sm:p-3",
        hasConflict
          ? "border-destructive/50 bg-destructive/10 ring-1 ring-destructive/30"
          : isCurrent
            ? "border-primary bg-primary-soft/85 ring-2 ring-primary/20 shadow-lg"
          : isSelected
            ? "border-primary ring-1 ring-primary/30 shadow-md"
            : "border-border",
        isPast && !isSelected && !isCurrent && "opacity-70",
        isHidden && "opacity-40",
      )}
      style={{
        top: `${top}px`,
        minHeight: "56px",
        height: `${height}px`,
      }}
    >
      <div className="flex h-full gap-3 overflow-hidden">
        <div className={cn("w-1 shrink-0 rounded-full", isCurrent ? "bg-primary" : accent)} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Move className={cn("size-3.5 shrink-0", isCurrent ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
              <p className="line-clamp-1 text-sm font-medium text-foreground">{item.title}</p>
            </div>
            <div className="flex items-center gap-1">
              {isCurrent ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                  {copy.quickCreateStartNowLabel}
                </span>
              ) : null}
              {hasConflict ? (
                <span className="flex items-center gap-1 rounded-full bg-destructive/12 px-2 py-0.5 text-[11px] font-medium text-destructive" title={copy.conflictPreviewLabel}>
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  {copy.conflictPreviewLabel}
                </span>
              ) : null}
              <Badge variant={getPriorityTone(item.priority)} className="px-2 py-0.5 text-[11px]">
                {item.priority}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatTimeRange(item.scheduledStartAt, item.scheduledEndAt, locale, copy)}
          </p>
          {item.scheduleStatus === "Overdue" || item.approvalPendingCount ? (
            <div className="flex flex-wrap gap-1 pt-1 text-[11px] text-muted-foreground">
              {item.scheduleStatus === "Overdue" ? (
                <Badge variant="destructive" className="px-2 py-0.5 text-[11px]">
                  {copy.overdue}
                </Badge>
              ) : null}
              {item.approvalPendingCount ? (
                <Badge variant="secondary" className="px-2 py-0.5 text-[11px]">
                  {copy.approvalPending}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        aria-label={`${copy.resizeHandleLabel} ${item.title}`}
        className="absolute inset-x-3 bottom-1 h-3 cursor-row-resize rounded-md border border-transparent bg-primary/10 text-[0px] outline-none hover:bg-primary/20 focus-visible:border-primary"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onResizeStart(item, event.clientY);
        }}
      >
        {copy.resizeHandleLabel}
      </button>
    </LocalizedLink>
  );
}
