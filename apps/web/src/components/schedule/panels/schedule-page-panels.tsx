"use client";

import { Calendar, GripVertical, PanelRightOpen } from "lucide-react";
import { type DragEvent, useState } from "react";
import { getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { UnscheduledItem } from "@/components/schedule/schedule-page-types";
import {
  formatDateTime,
  getPriorityAccent,
  getPriorityTone,
} from "@/components/schedule/schedule-page-utils";
import { TimeslotSuggestionPanel } from "@/components/schedule/panels/timeslot-suggestion-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ScheduleSlot } from "@chrona/contracts/ai";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { cn } from "@/lib/utils";

export { DayTimelineSummary } from "./schedule-panel-primitives";
export { SelectedBlockSheet } from "./selected-block-sheet";

function getQueueSuggestedDuration(item: UnscheduledItem) {
  const value = (
    item.executionConfig as { suggestedDurationMinutes?: unknown } | null
  )?.suggestedDurationMinutes;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(15, Math.round(value / 15) * 15);
}

export function QueueCard({
  item,
  isDragging,
  isPending,
  currentSchedule,
  onScheduleSlot,
  onOpenTaskDetails,
  onDragStart,
  onDragEnd,
}: {
  item: UnscheduledItem;
  isDragging: boolean;
  isPending: boolean;
  currentSchedule?: ScheduleSlot[];
  onScheduleSlot?: (taskId: string, startAt: Date, endAt: Date) => void;
  onOpenTaskDetails: (taskId: string) => void;
  onDragStart: (item: UnscheduledItem, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
  const suggestedDurationMinutes = getQueueSuggestedDuration(item);
  const [showTimeslots, setShowTimeslots] = useState(false);
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
        aria-label={`Drag ${item.title} to the timeline`}
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
          {suggestedDurationMinutes ? (
            <Button
              type="button"
              variant={showTimeslots ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                setShowTimeslots((v) => !v);
              }}
              title="Suggest time slot"
            >
              <Calendar />
              <span className="sr-only">Suggest time slot</span>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => onOpenTaskDetails(item.taskId)}
            title={copy.taskDetails}
          >
            <PanelRightOpen />
            <span className="sr-only">{copy.taskDetails}</span>
          </Button>
        </div>
      </CardHeader>

      {showTimeslots ? (
        <CardContent className="border-t border-border/60 px-3 py-3">
          <TimeslotSuggestionPanel
            taskId={item.taskId}
            title={item.title}
            priority={item.priority}
            estimatedMinutes={suggestedDurationMinutes ?? 60}
            dueAt={item.dueAt}
            currentSchedule={currentSchedule ?? []}
            onSchedule={
              onScheduleSlot
                ? (startAt, endAt) => onScheduleSlot(item.taskId, startAt, endAt)
                : undefined
              }
          />
        </CardContent>
      ) : null}
    </Card>
  );
}
