"use client";

import { getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { ScheduleCardItem, ScheduledItem } from "@/components/schedule/schedule-page-types";
import {
  describeOwner,
  formatShortDay,
  formatTime,
  getPriorityTone,
  getRunTone,
  getRunnabilityTone,
  getScheduleTone,
  toTimestamp,
} from "@/components/schedule/schedule-page-utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n, useLocale } from "@/i18n/client";
import { cn } from "@/lib/utils";

export function ItemMeta({ item }: { item: ScheduleCardItem }) {
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);

  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone={getPriorityTone(item.priority)}>
        {item.priority}
      </StatusBadge>
      <StatusBadge>
        {describeOwner(item.ownerType, item.assigneeAgentId, copy)}
      </StatusBadge>
      {item.runnabilitySummary ? (
        <StatusBadge tone={getRunnabilityTone(item.isRunnable)}>
          {item.runnabilitySummary}
        </StatusBadge>
      ) : null}
      {item.scheduleStatus ? (
        <StatusBadge tone={getScheduleTone(item.scheduleStatus)}>
          {copy.planPrefix}: {item.scheduleStatus}
        </StatusBadge>
      ) : null}
      {item.latestRunStatus ? (
        <StatusBadge tone={getRunTone(item.latestRunStatus)}>
          {copy.runPrefix}: {item.latestRunStatus}
        </StatusBadge>
      ) : null}
      {item.approvalPendingCount ? (
        <StatusBadge tone="warning">
          {copy.approvalsPrefix}: {item.approvalPendingCount}
        </StatusBadge>
      ) : null}
    </div>
  );
}

export function CompactMetaPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | null | undefined;
  tone?: "default" | "accent";
}) {
  return (
    <div
      className={cn(
        "inline-flex min-w-[9rem] items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-xs",
        tone === "accent"
          ? "border-primary/20 bg-primary/[0.08] text-foreground"
          : "border-border/60 bg-background/80 text-foreground",
      )}
    >
      <span className="uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value ?? "-"}</span>
    </div>
  );
}

export function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function DayTimelineSummary({
  items,
  dayDate,
}: {
  items: ScheduledItem[];
  dayDate: Date;
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
  const starts = items
    .map((item) => toTimestamp(item.scheduledStartAt))
    .filter((value): value is number => value !== null);
  const ends = items
    .map((item) => toTimestamp(item.scheduledEndAt))
    .filter((value): value is number => value !== null);

  if (starts.length === 0 || ends.length === 0) {
    return (
      <span>
        {formatShortDay(dayDate, locale, copy)} {copy.dayOpenSuffix}
      </span>
    );
  }

  const earliest = new Date(Math.min(...starts));
  const latest = new Date(Math.max(...ends));

  return (
    <span>
      {formatTime(earliest, locale)} → {formatTime(latest, locale)}
    </span>
  );
}
