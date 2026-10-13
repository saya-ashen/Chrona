import { scheduleItemSchema, type ScheduleItem } from "@chrona/contracts/steward";
import { buildSchedule } from "@chrona/domain/steward/schedule";
import { attentionView, delegationView, followUpView, type Context } from "./mappers";

/** Read-only projection; tentative attention dates never become commitments. */
export async function schedule(ctx: Context, from: string, to: string): Promise<ScheduleItem[]> {
  const start = new Date(from), end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
    throw new RangeError("Valid ordered schedule bounds required");
  }
  const workspaceId = ctx.actor.workspaceId;
  const [calendar, attention, follows, delegations] = await Promise.all([
    ctx.db.importedCalendarEvent.findMany({ where: { workspaceId, status: { not: "cancelled" }, startsAt: { gte: start, lt: end } } }),
    ctx.db.attentionItem.findMany({ where: { workspaceId, status: { in: ["open", "snoozed"] }, dueAt: { gte: start, lt: end } } }),
    ctx.db.followUp.findMany({ where: { workspaceId, status: "pending", dueAt: { gte: start, lt: end } } }),
    ctx.db.delegation.findMany({ where: { workspaceId, status: "active", cadenceSeconds: { not: null } } }),
  ]);
  return buildSchedule({
    now: ctx.now().toISOString(),
    calendarEvents: calendar.map(row => ({ id: row.id, title: row.title, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), affairId: null })),
    attentionItems: attention.map(row => attentionView(row)),
    followUps: follows.map(row => followUpView(row)),
    delegations: delegations.map(row => delegationView(row)),
  }, { from: start.toISOString(), to: end.toISOString() }).map(item => scheduleItemSchema.parse(item));
}
