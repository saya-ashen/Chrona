"use client";

import { CalendarPlus, GripVertical } from "lucide-react";
import type { DragEvent } from "react";
import { getSchedulePageCopy } from "../schedule-page-copy";
import type { UnscheduledItem } from "../schedule-page-types";
import {
  formatDateTime,
  getPriorityAccent,
} from "../schedule-page-utils";
import { Button } from "@shared/ui"
import { Card } from "@shared/ui"
import { useI18n, useLocale } from "@chrona/i18n"
import { cn } from "@shared/ui";

export { DayTimelineSummary } from "./schedule-panel-primitives";
export { SelectedBlockSheet } from "./selected-block-sheet";


export function QueueCard({
  item,
  isDragging,
  isPending,
  onScheduleTask,
  onOpenTaskDetails,
  onDragStart,
  onDragEnd,
}: {
  item: UnscheduledItem;
  isDragging: boolean;
  isPending: boolean;
  onScheduleTask: (taskId: string) => void;
  onOpenTaskDetails: (taskId: string) => void;
  onDragStart: (item: UnscheduledItem, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components.schedulePage);
  const accent = getPriorityAccent(item.priority);

  return (
    <Card
      size="sm"
      role="button"
      tabIndex={isPending ? -1 : 0}
      draggable={!isPending}
      aria-label={item.title}
      aria-disabled={isPending || undefined}
      onClick={() => {
        if (!isPending) onOpenTaskDetails(item.taskId);
      }}
      onKeyDown={(event) => {
        if (!isPending && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpenTaskDetails(item.taskId);
        }
      }}
      onDragStart={(event) => onDragStart(item, event)}
      onDragEnd={onDragEnd}
      className={cn(
        "group grid min-h-16 cursor-grab grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-card/95 px-2.5 py-2 shadow-[0_3px_12px_rgba(15,23,42,0.06)] ring-border/70 transition-[background,border-color,box-shadow,opacity,transform] hover:bg-muted/35 hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing data-[size=sm]:py-2",
        isPending && "cursor-not-allowed opacity-60",
        isDragging && "scale-[0.99] border-primary/70 bg-primary/10 opacity-80 shadow-[0_0_0_2px_rgba(37,99,235,0.16),0_12px_28px_rgba(15,23,42,0.16)]",
      )}
    >
      <div className={cn("w-1 self-stretch rounded-full", accent)} aria-hidden="true" />

      <div className="min-w-0">
        <p className="truncate text-sm font-medium leading-5 text-foreground">{item.title}</p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs leading-4 text-muted-foreground">
          <span>{item.priority}</span>
          {item.dueAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{formatDateTime(item.dueAt, locale)}</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          disabled={isPending}
          onClick={(event) => {
            event.stopPropagation();
            onScheduleTask(item.taskId);
          }}
          onDragStart={(event) => event.preventDefault()}
        >
          <CalendarPlus />
          {copy.scheduleAction}
        </Button>
        <GripVertical className="size-4 shrink-0 text-muted-foreground/45" aria-hidden="true" />
      </div>
    </Card>
  );
}
