"use client";

import type { SchedulePageCopy } from "../../schedule-page-copy";
import type { ScheduleRecord } from "../../schedule-page-types";
import { formatDateTime, formatTimeRange } from "../../schedule-page-utils";
import { TaskContextLinks } from "@/components/tasks/shared/task-context-links";
import { Button } from "shared/ui/button";
import { X } from "lucide-react";

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
    <div className="border-b border-border/60 px-4 py-3 sm:px-6 sm:py-4">
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
        <div className="flex items-center gap-2">
          <TaskContextLinks
            taskId={item.taskId}
            workBlockId={item.workBlockId ?? null}
            size="sm"
          />
          <Button
            type="button"
            onClick={onClose}
            variant="ghost"
            size="icon-sm"
            className="size-8 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={copy.close}
          >
            <X />
          </Button>
        </div>
      </div>
    </div>
  );
}
