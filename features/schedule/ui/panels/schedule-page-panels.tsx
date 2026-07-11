"use client";

import { GripVertical, PanelRightOpen } from "lucide-react";
import type { DragEvent } from "react";
import { getSchedulePageCopy } from "../schedule-page-copy";
import type { UnscheduledItem } from "../schedule-page-types";
import {
  formatDateTime,
  getPriorityAccent,
  getPriorityTone,
} from "../schedule-page-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { cn } from "@/lib/utils";

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
      className={cn(
        "gap-0 rounded-xl bg-card/95 py-0 data-[size=sm]:py-0 shadow-[0_3px_12px_rgba(15,23,42,0.06)] ring-border/70 transition-[background,border-color,box-shadow,opacity,transform] hover:bg-card hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)]",
        isDragging && "scale-[0.99] border-primary/70 bg-primary/10 opacity-80 shadow-[0_0_0_2px_rgba(37,99,235,0.16),0_12px_28px_rgba(15,23,42,0.16)]",
      )}
    >
      <CardHeader
        draggable={!isPending}
        aria-label={`${copy.scheduleTaskAction}: ${item.title}`}
        onDragStart={(event) => onDragStart(item, event)}
        onDragEnd={onDragEnd}
        className={cn(
          "grid min-h-14 cursor-grab select-none grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5 px-2.5 py-1.5 active:cursor-grabbing",
          isPending && "cursor-not-allowed opacity-60",
        )}
      >
        <div className={`w-1 shrink-0 self-stretch rounded-full ${accent}`} />

        <GripVertical
          className="size-4 shrink-0 text-muted-foreground/35"
          aria-hidden="true"
        />

        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-foreground">
              {item.title}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
            <Badge variant={getPriorityTone(item.priority)}>
              {item.priority}
            </Badge>
            {item.dueAt ? <span className="truncate">{formatDateTime(item.dueAt, locale)}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={isPending}
            onClick={() => onScheduleTask(item.taskId)}
          >
            {copy.scheduleAction}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenTaskDetails(item.taskId)}
            title={copy.taskDetails}
          >
            <PanelRightOpen />
            <span className="sr-only">{copy.taskDetails}</span>
          </Button>
        </div>
      </CardHeader>

    </Card>
  );
}
