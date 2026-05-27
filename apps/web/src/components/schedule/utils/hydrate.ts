import type { SchedulePageData } from "@/components/schedule/schedule-page-types";
import { toDate } from "@/components/schedule/utils/date";

export function hydrateSchedulePageData(
  data: SchedulePageData,
): SchedulePageData {
  const hydrateRecord = <
    T extends {
      dueAt?: Date | string | null;
      scheduledStartAt?: Date | string | null;
      scheduledEndAt?: Date | string | null;
      lastActivityAt?: Date | string | null;
    },
  >(
    item: T,
  ): T => ({
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
    listItems: data.listItems.map((item) => hydrateRecord(item)),
    proposals: data.proposals.map((proposal) => ({
      ...proposal,
      dueAt: toDate(proposal.dueAt),
      scheduledStartAt: toDate(proposal.scheduledStartAt),
      scheduledEndAt: toDate(proposal.scheduledEndAt),
    })),
    workBlocks: (data.workBlocks ?? []).map((block) => ({
      ...block,
      scheduledStartAt:
        toDate(block.scheduledStartAt) ?? block.scheduledStartAt,
      scheduledEndAt: toDate(block.scheduledEndAt) ?? block.scheduledEndAt,
      startedAt: toDate(block.startedAt),
    })),
  };
}
