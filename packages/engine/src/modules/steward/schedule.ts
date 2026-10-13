import { scheduleItemSchema, type ScheduleItem } from "@chrona/contracts/steward";
import type { Context } from "./mappers";

/** Only persisted follow-ups and deterministic delegation check times. */
export async function schedule(ctx: Context, from: string, to: string): Promise<ScheduleItem[]> {
  const start = new Date(from), end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
    throw new RangeError("Valid ordered schedule bounds required");
  }
  const workspaceId = ctx.actor.workspaceId;
  const follows = await ctx.db.followUp.findMany({ where: { workspaceId, status: "pending", dueAt: { gte: start, lte: end } } });
  const delegations = await ctx.db.delegation.findMany({ where: { workspaceId, status: "active", cadenceSeconds: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: ctx.now() } }] } });
  const items: ScheduleItem[] = follows.map(row => ({ id: row.id, kind: "follow_up", title: row.note.slice(0, 200), startsAt: row.dueAt.toISOString(), endsAt: null, affairId: row.affairId, sourceRef: row.id, confirmed: true }));
  for (const row of delegations) {
    const next = row.lastCheckAt ? new Date(row.lastCheckAt.getTime() + row.cadenceSeconds! * 1000) : row.grantedAt ?? row.createdAt;
    if (next < start || next > end || (row.expiresAt && next >= row.expiresAt)) continue;
    items.push({ id: row.id, kind: "steward_check", title: row.purpose.slice(0, 200), startsAt: next.toISOString(), endsAt: null, affairId: row.affairId, sourceRef: row.id, confirmed: true });
  }
  return items.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)).map(item => scheduleItemSchema.parse(item));
}
