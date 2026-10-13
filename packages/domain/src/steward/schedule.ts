import type { AttentionItem, Delegation, FollowUp, ScheduleItem } from "@chrona/contracts/steward";

export type ScheduleInput = {
  /** Explicit evaluation time; never read the system clock. */
  now: string;
  calendarEvents: readonly { id: string; title: string; startsAt: string; endsAt: string | null; affairId: string | null }[];
  attentionItems: readonly Pick<AttentionItem, "id" | "title" | "affairId" | "kind" | "status" | "dueAt">[];
  followUps: readonly Pick<FollowUp, "id" | "note" | "affairId" | "status" | "dueAt">[];
  delegations: readonly (Pick<Delegation, "id" | "purpose" | "affairId" | "status" | "lastCheckAt" | "cadenceSeconds"> & Partial<Pick<Delegation, "expiresAt">>)[];
};

/**
 * Project starts within [from, to), not overlapping appointments. A null cadence
 * means no scheduled check. Non-commitment attention dates are never promises;
 * resolved/dismissed items are historical, not upcoming schedule entries.
 */
export function buildSchedule(input: ScheduleInput, { from, to }: { from: string; to: string }): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const add = (kind: ScheduleItem["kind"], sourceId: string, title: string, startsAt: string, affairId: string | null, confirmed: boolean, endsAt: string | null = null) => {
    items.push({ id: `${kind}:${sourceId}`, kind, title: title.slice(0, 200), startsAt, endsAt, affairId, sourceRef: sourceId, confirmed });
  };
  for (const event of input.calendarEvents) {
    add("appointment", event.id, event.title, event.startsAt, event.affairId, true, event.endsAt);
  }
  for (const item of input.attentionItems) {
    if (!item.dueAt || (item.status !== "open" && item.status !== "snoozed")) continue;
    const confirmed = item.kind === "commitment";
    add(confirmed ? "deadline" : "unconfirmed_suggestion", item.id, item.title, item.dueAt, item.affairId, confirmed);
  }
  for (const followUp of input.followUps) {
    if (followUp.status === "pending") add("follow_up", followUp.id, followUp.note, followUp.dueAt, followUp.affairId, true);
  }
  for (const delegation of input.delegations) {
    if (delegation.status !== "active" || delegation.cadenceSeconds === null || !Number.isFinite(delegation.cadenceSeconds) || delegation.cadenceSeconds <= 0) continue;
    const next = delegation.lastCheckAt === null ? Date.parse(input.now) : Date.parse(delegation.lastCheckAt) + delegation.cadenceSeconds * 1000;
    if (!Number.isFinite(next)) continue;
    if (delegation.expiresAt && Date.parse(delegation.expiresAt) <= Math.max(Date.parse(input.now), next)) continue;
    add("steward_check", delegation.id, delegation.purpose, new Date(next).toISOString(), delegation.affairId, true);
  }
  const start = Date.parse(from);
  const end = Date.parse(to);
  return items.filter(item => Date.parse(item.startsAt) >= start && Date.parse(item.startsAt) < end)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
