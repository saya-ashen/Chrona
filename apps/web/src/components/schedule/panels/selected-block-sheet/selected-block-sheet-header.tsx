"use client";

import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import { formatDateTime, formatTimeRange } from "@/components/schedule/schedule-page-utils";
import { buttonVariants } from "@/components/ui/button";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import { CompactMetaPill, ItemMeta } from "../schedule-panel-primitives";

export function SelectedBlockSheetHeader({
  item,
  locale,
  copy,
  acceptedPlan,
  onClose,
}: {
  item: ScheduledItem;
  locale: string;
  copy: SchedulePageCopy;
  acceptedPlan: TaskPlanReadModel | null;
  onClose: () => void;
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
              value={acceptedPlan?.revision
                ? `Accepted · r${acceptedPlan.revision}`
                : acceptedPlan?.status === "accepted"
                  ? "Accepted"
                  : "No accepted plan"}
              tone={acceptedPlan?.status === "accepted" ? "accent" : "default"}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {copy.close}
        </button>
      </div>
    </div>
  );
}
