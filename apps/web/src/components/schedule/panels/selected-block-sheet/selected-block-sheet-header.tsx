"use client";

import { LocalizedLink } from "@/components/i18n/localized-link";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import { formatDateTime, formatTimeRange } from "@/components/schedule/schedule-page-utils";
import { buttonVariants } from "@/components/ui/button";
import type { TaskPlanGraphResponse } from "@/modules/ai/types";
import { CompactMetaPill, ItemMeta } from "../schedule-panel-primitives";

export function SelectedBlockSheetHeader({
  item,
  selectedDay,
  locale,
  copy,
  acceptedPlan,
  buildScheduleHref,
}: {
  item: ScheduledItem;
  selectedDay: string;
  locale: string;
  copy: SchedulePageCopy;
  acceptedPlan: TaskPlanGraphResponse | null;
  buildScheduleHref: (day: string, taskId?: string) => string;
}) {
  return (
    <div className="border-b border-border/70 bg-muted/[0.12] px-5 py-4 md:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              {copy.taskDetailsEyebrow}
            </p>
            <h2
              id="schedule-task-sheet-title"
              className="text-xl font-semibold tracking-tight text-foreground"
            >
              {item.title}
            </h2>
          </div>
          <ItemMeta item={item} />
          <div className="flex flex-wrap gap-2">
            <CompactMetaPill
              label={copy.scheduledWindow}
              value={formatTimeRange(
                item.scheduledStartAt,
                item.scheduledEndAt,
                locale,
                copy,
              )}
              tone="accent"
            />
            <CompactMetaPill
              label={copy.due}
              value={formatDateTime(item.dueAt, locale)}
            />
            <CompactMetaPill
              label={copy.currentPlan}
              value={item.scheduleStatus ?? copy.scheduledMetric}
            />
            <CompactMetaPill
              label={copy.latestRun}
              value={item.latestRunStatus ?? copy.noActiveRun}
            />
            <CompactMetaPill
              label={copy.nextAction}
              value={item.actionRequired ?? copy.stayOnPlan}
            />
            <CompactMetaPill
              label={copy.taskPlanLabel}
              value={acceptedPlan?.savedPlan?.revision
                ? `Accepted · r${acceptedPlan.savedPlan.revision}`
                : acceptedPlan?.savedPlan?.status === "accepted"
                  ? "Accepted"
                  : "No accepted plan"}
              tone={acceptedPlan?.savedPlan?.status === "accepted" ? "accent" : "default"}
            />
          </div>
        </div>
        <LocalizedLink
          href={buildScheduleHref(selectedDay)}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {copy.close}
        </LocalizedLink>
      </div>
    </div>
  );
}
