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
  describeOwner,
  formatTimeRange,
  getPriorityAccent,
  getPriorityTone,
} from "@/components/schedule/schedule-page-utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n, useLocale } from "@/i18n/client";
import { cn } from "@/lib/utils";

export function TimelinePlacementCard({
  preview,
  title,
  kind,
}: {
  preview: TimelinePlacementPreview;
  title: string;
  kind: "queue" | "scheduled";
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-3 right-3 rounded-2xl border p-3 shadow-sm",
        preview.hasConflict
          ? "border-red-300 bg-red-50/95"
          : "border-dashed border-primary/50 bg-primary/10",
      )}
      style={{
        top: `${preview.top}px`,
        minHeight: "56px",
        height: `${preview.height}px`,
      }}
    >
      <div className="flex h-full gap-3 overflow-hidden">
        <div
          className={cn(
            "w-1 shrink-0 rounded-full",
            preview.hasConflict ? "bg-red-500" : "bg-primary",
          )}
        />
        <div className="min-w-0 space-y-1">
          <p className="line-clamp-1 text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">
            {formatTimeRange(preview.startAt, preview.endAt, locale, copy)} · {" "}
            {preview.source === "resize"
              ? copy.resizePreviewLabel
              : kind === "queue"
                ? copy.dropToSchedule
                : copy.dropToMoveBlock}
          </p>
          {preview.hasConflict ? (
            <p className="text-xs font-medium text-red-700">{copy.conflictPreviewLabel}</p>
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
        "absolute left-3 right-3 rounded-2xl border bg-background/95 p-3 shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        hasConflict
          ? "border-red-400 bg-red-50/80 ring-1 ring-red-300/50"
          : isSelected
            ? "border-primary ring-1 ring-primary/30"
            : "border-border",
        isHidden && "opacity-40",
      )}
      style={{
        top: `${top}px`,
        minHeight: "56px",
        height: `${height}px`,
      }}
    >
      <div className="flex h-full gap-3 overflow-hidden">
        <div className={`w-1 shrink-0 rounded-full ${accent}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Move className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="line-clamp-1 text-sm font-medium text-foreground">{item.title}</p>
            </div>
            <div className="flex items-center gap-1">
              {hasConflict ? (
                <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700" title={copy.conflictPreviewLabel}>
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  {copy.conflictPreviewLabel}
                </span>
              ) : null}
              <StatusBadge tone={getPriorityTone(item.priority)} className="px-2 py-0.5 text-[11px]">
                {item.priority}
              </StatusBadge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatTimeRange(item.scheduledStartAt, item.scheduledEndAt, locale, copy)}
          </p>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {describeOwner(item.ownerType, item.assigneeAgentId, copy)}
          </p>
          {item.scheduleStatus === "Overdue" || item.approvalPendingCount ? (
            <div className="flex flex-wrap gap-1 pt-1 text-[11px] text-muted-foreground">
              {item.scheduleStatus === "Overdue" ? (
                <StatusBadge tone="critical" className="px-2 py-0.5 text-[11px]">
                  {copy.overdue}
                </StatusBadge>
              ) : null}
              {item.approvalPendingCount ? (
                <StatusBadge tone="warning" className="px-2 py-0.5 text-[11px]">
                  {copy.approvalPending}
                </StatusBadge>
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
