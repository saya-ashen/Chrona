import type { Delegation } from "@chrona/contracts/steward";
import type { Prisma, StewardNotification } from "@chrona/db/generated/prisma/client";

function localTime(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}
// Minute stepping handles skipped/repeated local times at DST boundaries.
function nextBoundary(at: Date, predicate: (date: Date) => boolean) {
  for (let ms = Math.floor(at.getTime() / 60_000) * 60_000 + 60_000; ms <= at.getTime() + 49 * 3_600_000; ms += 60_000) {
    const date = new Date(ms);
    if (predicate(date)) return date;
  }
  throw new Error("Invalid notification time policy");
}
function clockMinutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) throw new Error("Invalid quiet hours");
  return h * 60 + m;
}
function quietPredicate(q: NonNullable<Delegation["notification"]["quietHours"]>) {
  const start = clockMinutes(q.start), end = clockMinutes(q.end);
  return (date: Date) => {
    const minute = localTime(date, q.timezone).minute;
    return start < end ? minute >= start && minute < end : start > end ? minute >= start || minute < end : false;
  };
}

export async function deliveryTimePolicy(tx: Prisma.TransactionClient, row: StewardNotification, delegation: Delegation, at: Date) {
  const policy = delegation.notification;
  let timezone = "UTC";
  if (policy.quietHours) {
    timezone = policy.quietHours.timezone;
    const quiet = quietPredicate(policy.quietHours);
    if (quiet(at)) return { reason: "Quiet hours; deferred until quiet hours end.", until: nextBoundary(at, date => !quiet(date)) };
  }
  const day = localTime(at, timezone).day;
  // Reservations count distinct notifications, including uncertain effects.
  const reservations = await tx.stewardAudit.findMany({
    where: { workspaceId: row.workspaceId, kind: "notification.claimed", createdAt: { gte: new Date(at.getTime() - 49 * 3_600_000), lte: at } },
    select: { subjectId: true, createdAt: true, details: true },
  });
  const used = new Set(reservations.filter(r => localTime(r.createdAt, timezone).day === day &&
    (r.details as { delegationId?: string }).delegationId === row.delegationId).map(r => r.subjectId));
  const sent = await tx.stewardNotification.findMany({
    where: { workspaceId: row.workspaceId, delegationId: row.delegationId, sentAt: { gte: new Date(at.getTime() - 49 * 3_600_000), lte: at } },
    select: { id: true, sentAt: true },
  });
  for (const notification of sent) if (localTime(notification.sentAt!, timezone).day === day) used.add(notification.id);
  used.delete(row.id); // A retry consumes its original reservation.
  if (used.size >= delegation.limits.maxNotificationsPerDay) return {
    reason: "Daily notification cap reached; deferred until next local day.",
    until: nextBoundary(at, date => localTime(date, timezone).day !== day),
  };
  return null;
}
