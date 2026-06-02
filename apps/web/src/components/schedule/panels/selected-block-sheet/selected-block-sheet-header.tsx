"use client";

import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { ScheduleRecord } from "@/components/schedule/schedule-page-types";
import { formatDateTime, formatTimeRange } from "@/components/schedule/schedule-page-utils";
import { TaskContextLinks } from "@/components/tasks/shared/task-context-links";
import { Button } from "@/components/ui/button";

export function SelectedBlockSheetHeader({
  item,
  locale,
  copy,
  onClose,
}: {
  item: ScheduleRecord;
  locale: string;
  copy: SchedulePageCopy;
  onClose: () => void;
}) {
  const timeRange = formatTimeRange(
    item.scheduledStartAt,
    item.scheduledEndAt,
    locale,
    copy,
  );
  const dueLabel = formatDateTime(item.dueAt, locale);

  return (
    <div className="border-b border-border/70 bg-muted/[0.1] px-5 py-3 md:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2
            id="schedule-task-sheet-title"
            className="truncate text-lg font-semibold tracking-tight text-foreground"
          >
            {item.title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{timeRange}</span>
            {dueLabel ? <span>{copy.due}: {dueLabel}</span> : null}
            <span>{item.priority}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <TaskContextLinks
            taskId={item.taskId}
            workBlockId={item.workBlockId ?? null}
            size="sm"
          />
          <Button
            type="button"
            onClick={onClose}
            variant="outline" size="sm"
          >
            {copy.close}
          </Button>
        </div>
      </div>
    </div>
  );
}
