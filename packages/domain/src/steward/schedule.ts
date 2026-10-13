import type { AttentionItem, Delegation, FollowUp, ScheduleItem } from "@chrona/contracts/steward";

export type ScheduleInput = {
  /** Explicit evaluation time; never read the system clock. */
  now: string;
  calendarEvents: readonly { id: string; title: string; startsAt: string; endsAt: string | null; affairId: string | null }[];
  attentionItems: readonly Pick<AttentionItem, "id" | "title" | "affairId" | "kind" | "status" | "dueAt">[];
  followUps: readonly Pick<FollowUp, "id" | "note" | "affairId" | "status" | "dueAt">[];
  delegations: readonly (Pick<Delegation, "id" | "purpose" | "affairId" | "status" | "lastCheckAt" | "cadenceSeconds"> & Partial<Pick<Delegation, "expiresAt">>)[];
};

type ScheduleEntry = Omit<ScheduleItem, "id" | "title" | "sourceRef" | "endsAt"> & {
  sourceId: string;
  title: string;
  endsAt?: string | null;
};

function scheduleItem({ sourceId, title, endsAt = null, ...entry }: ScheduleEntry): ScheduleItem {
  return { ...entry, id: `${entry.kind}:${sourceId}`, title: title.slice(0, 200), endsAt, sourceRef: sourceId };
}

function delegationCheck(delegation: ScheduleInput["delegations"][number], now: string): ScheduleItem[] {
  if (delegation.status !== "active" || delegation.cadenceSeconds === null
    || !Number.isFinite(delegation.cadenceSeconds) || delegation.cadenceSeconds <= 0) return [];
  const next = delegation.lastCheckAt === null
    ? Date.parse(now)
    : Date.parse(delegation.lastCheckAt) + delegation.cadenceSeconds * 1000;
  if (!Number.isFinite(next)) return [];
  if (delegation.expiresAt && Date.parse(delegation.expiresAt) <= Math.max(Date.parse(now), next)) return [];
  return [scheduleItem({
    kind: "steward_check", sourceId: delegation.id, title: delegation.purpose,
    startsAt: new Date(next).toISOString(), affairId: delegation.affairId, confirmed: true,
  })];
}

/**
 * Project starts within [from, to), not overlapping appointments. A null cadence
 * means no scheduled check. Non-commitment attention dates are never promises;
 * resolved/dismissed items are historical, not upcoming schedule entries.
 */
export function buildSchedule(input: ScheduleInput, { from, to }: { from: string; to: string }): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const add = (entry: ScheduleEntry) => { items.push(scheduleItem(entry)); };
  for (const event of input.calendarEvents) {
    add({ kind: "appointment", sourceId: event.id, title: event.title,
      startsAt: event.startsAt, affairId: event.affairId, confirmed: true, endsAt: event.endsAt });
  }
  for (const item of input.attentionItems) {
    if (!item.dueAt || (item.status !== "open" && item.status !== "snoozed")) continue;
    const confirmed = item.kind === "commitment";
    add({ kind: confirmed ? "deadline" : "unconfirmed_suggestion", sourceId: item.id,
      title: item.title, startsAt: item.dueAt, affairId: item.affairId, confirmed });
  }
  for (const followUp of input.followUps) {
    if (followUp.status === "pending") add({
      kind: "follow_up", sourceId: followUp.id, title: followUp.note,
      startsAt: followUp.dueAt, affairId: followUp.affairId, confirmed: true,
    });
  }
  for (const delegation of input.delegations) {
    items.push(...delegationCheck(delegation, input.now));
  }
  const start = Date.parse(from);
  const end = Date.parse(to);
  return items.filter(item => Date.parse(item.startsAt) >= start && Date.parse(item.startsAt) < end)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
