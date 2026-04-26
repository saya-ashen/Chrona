import type { SchedulePageData } from "@/components/schedule/schedule-page-types";
import { toDate } from "@/components/schedule/utils/date";

export function hydrateSchedulePageData(data: SchedulePageData): SchedulePageData {
  const hydrateRecord = <T extends { dueAt?: Date | string | null; scheduledStartAt?: Date | string | null; scheduledEndAt?: Date | string | null; lastActivityAt?: Date | string | null }>(item: T): T => ({
    ...item,
    dueAt: toDate(item.dueAt),
    scheduledStartAt: toDate(item.scheduledStartAt),
    scheduledEndAt: toDate(item.scheduledEndAt),
    lastActivityAt: toDate(item.lastActivityAt),
  });

  return {
    ...data,
    scheduled: data.scheduled.map((item) => hydrateRecord(item)),
    unscheduled: data.unscheduled.map((item) => hydrateRecord(item)),
    risks: data.risks.map((item) => hydrateRecord(item)),
    proposals: data.proposals.map((proposal) => ({
      ...proposal,
      dueAt: toDate(proposal.dueAt),
      scheduledStartAt: toDate(proposal.scheduledStartAt),
      scheduledEndAt: toDate(proposal.scheduledEndAt),
    })),
    suggestions: data.suggestions.map((suggestion) => ({
      ...suggestion,
      changes: suggestion.changes.map((change) => ({
        ...change,
        scheduledStartAt: toDate(change.scheduledStartAt ?? null) ?? undefined,
        scheduledEndAt: toDate(change.scheduledEndAt ?? null) ?? undefined,
        dueAt: toDate(change.dueAt ?? null) ?? undefined,
      })),
    })),
    conflicts: data.conflicts.map((conflict) => ({
      ...conflict,
      timeRange: conflict.timeRange
        ? {
            start: toDate(conflict.timeRange.start) ?? conflict.timeRange.start,
            end: toDate(conflict.timeRange.end) ?? conflict.timeRange.end,
          }
        : conflict.timeRange,
    })),
  };
}
