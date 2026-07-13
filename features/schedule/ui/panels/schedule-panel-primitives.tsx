"use client";

import { getSchedulePageCopy } from "../schedule-page-copy";
import type { ScheduledItem } from "../schedule-page-types";
import {
  formatShortDay,
  formatTime,
  toTimestamp,
} from "../schedule-page-utils";
import { useI18n, useLocale } from "@chrona/i18n"

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
  const copy = getSchedulePageCopy(messages.components.schedulePage);
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
