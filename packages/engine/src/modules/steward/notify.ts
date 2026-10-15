import type { Prisma } from "@chrona/db";
import type { NotifyLevel, DeliveryOutcome } from "@chrona/contracts/steward";
import { routeNotification, localDayKey, isDigestDue } from "@chrona/domain/steward/notify-budget";
import { composeDigest } from "@chrona/domain/steward/digest";
import type { StewardPorts } from "./service";
import { notificationSettings } from "./settings";
import { requireAffair } from "./affairs";
import { audit } from "./audit";
import { StewardError } from "./errors";
import { toNotification } from "./store";
export type NotificationInput = { workspaceId: string; affairId?: string; askId?: string; level: NotifyLevel; title: string; body: string; urgent?: boolean; dedupeKey: string };
export type NotificationContext = { now: Date; chatBound: boolean; publicUrl: string | null };
export async function enqueueNotification(tx: Prisma.TransactionClient, input: NotificationInput, context: NotificationContext) {
  const { workspaceId, dedupeKey } = input;
  const existing = await tx.notification.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: dedupeKey } } });
  if (existing) return existing;
  const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const affair = input.affairId ? await requireAffair(tx, workspaceId, input.affairId) : null;
  if (input.askId && !await tx.ask.findFirst({ where: { id: input.askId, workspaceId } })) throw new StewardError("not_found", "Ask not found");
  const settings = notificationSettings(workspace.settings), day = localDayKey(context.now, settings.timezone);
  // Reserve budget for queued sends too: a batch must not overrun the cap before delivery.
  const sent = await tx.notification.findMany({ where: { workspaceId, level: "now", OR: [{ sentAt: { gte: new Date(context.now.getTime() - 48 * 3600000) } }, { status: "queued" }] } });
  const sentToday = sent.filter(r => localDayKey(r.sentAt ?? r.createdAt, settings.timezone) === day && !r.idempotencyKey.startsWith("digest:")).length;
  const route = routeNotification(input.level, { ...settings, now: context.now, urgent: input.urgent ?? false, sentToday });
  const row = await tx.notification.create({ data: { workspaceId, affairId: input.affairId, askId: input.askId, level: input.level, title: input.title, body: input.body, idempotencyKey: dedupeKey, channel: route === "web" || !context.chatBound ? "in_app" : "chrona_qqbot", status: affair?.status === "paused" ? "suppressed" : route === "fold" ? "folded" : "queued", createdAt: context.now, nextAttemptAt: context.now, link: input.affairId ? `${context.publicUrl ?? ""}/affairs/${input.affairId}` : null } });
  await audit(tx, { workspaceId, kind: "notification_enqueued", actor: "chrona", subjectId: row.id, details: { status: row.status, route } });
  return row;
}
export function createNotifications(ports: StewardPorts, workspaceId: string) {
  const { db } = ports;
  const context = async (now: Date): Promise<NotificationContext> => ({ now, chatBound: ports.chat ? await ports.chat.bound() : false, publicUrl: ports.publicUrl });
  async function enqueue(tx: Prisma.TransactionClient, input: NotificationInput) { return enqueueNotification(tx, input, await context(ports.now())); }
  async function deliverDue(now = ports.now()) {
    // An expired send lease may have reached the channel: never resend it automatically.
    const expired = await db.notification.findMany({ where: { workspaceId, status: "queued", leaseToken: { not: null }, leaseUntil: { lte: now } } });
    for (const row of expired) await db.$transaction(async tx => {
      const changed = await tx.notification.updateMany({ where: { id: row.id, status: "queued", leaseToken: row.leaseToken }, data: { status: "uncertain", leaseToken: null, leaseUntil: null, lastError: "Delivery lease expired; receipt unknown" } });
      if (changed.count) await audit(tx, { workspaceId, kind: "notification_delivery", actor: "chrona", subjectId: row.id, details: { outcome: "uncertain" } });
    });
    const rows = await db.notification.findMany({ where: { workspaceId, status: "queued", leaseToken: null, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, orderBy: { createdAt: "asc" }, take: 100 });
    for (const row of rows) {
      if (row.idempotencyKey.startsWith("digest:")) {
        const settings = notificationSettings((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings);
        if (routeNotification("now", { ...settings, dailyCap: 1, sentToday: 0, now, urgent: false }) !== "send") continue;
      }
      const token = crypto.randomUUID();
      const claimed = await db.$transaction(async tx => {
        if (row.affairId && (await tx.affair.findUnique({ where: { id: row.affairId } }))?.status === "paused") {
          await tx.notification.updateMany({ where: { id: row.id, status: "queued" }, data: { status: "suppressed" } });
          await audit(tx, { workspaceId, kind: "notification_suppressed", actor: "chrona", subjectId: row.id, details: {} });
          return false;
        }
        return (await tx.notification.updateMany({ where: { id: row.id, status: "queued", leaseToken: null }, data: { leaseToken: token, leaseUntil: new Date(now.getTime() + 300000), attempts: { increment: 1 } } })).count > 0;
      });
      if (!claimed) continue;
      let outcome: DeliveryOutcome;
      const adapter = ports.deliveries.find(d => d.channel === row.channel);
      try { outcome = adapter ? await adapter.send({ idempotencyKey: row.idempotencyKey, title: row.title, body: row.body, link: row.link, recipient: row.recipient }) : { outcome: "rejected", retryable: false, error: "Delivery channel unavailable" }; }
      catch { outcome = { outcome: "uncertain", error: "Delivery adapter threw; receipt unknown" }; }
      const attempts = row.attempts + 1;
      const status = outcome.outcome === "accepted" ? "sent" : outcome.outcome === "uncertain" ? "uncertain" : outcome.retryable && attempts < 6 ? "queued" : "failed";
      await db.$transaction(async tx => {
        const changed = await tx.notification.updateMany({ where: { id: row.id, status: "queued", leaseToken: token }, data: { status, leaseToken: null, leaseUntil: null, sentAt: outcome.outcome === "accepted" ? now : null, receiptRef: outcome.outcome === "accepted" ? outcome.receiptRef : null, lastError: outcome.outcome === "accepted" ? null : outcome.error.slice(0, 500), nextAttemptAt: status === "queued" ? new Date(now.getTime() + Math.min(21600000, 60000 * 2 ** (attempts - 1))) : null } });
        if (changed.count) await audit(tx, { workspaceId, kind: "notification_delivery", actor: "chrona", subjectId: row.id, details: { outcome: outcome.outcome, status, attempts } });
      });
    }
  }
  async function sendDigestIfDue(now = ports.now()) {
    const ctx = await context(now);
    return db.$transaction(async tx => {
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } }), settings = notificationSettings(workspace.settings);
      const day = localDayKey(now, settings.timezone), key = `digest:${day}`;
      if (!isDigestDue({ ...settings, now, lastDigestDay: null }) || routeNotification("now", { ...settings, dailyCap: 1, sentToday: 0, now, urgent: false }) !== "send") return null;
      if (await tx.notification.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: key } } })) return null;
      const memberships = await tx.audit.findMany({ where: { workspaceId, kind: "digest_included" }, select: { subjectId: true } });
      const rows = await tx.notification.findMany({ where: { workspaceId, status: "folded", id: { notIn: memberships.flatMap(r => r.subjectId ? [r.subjectId] : []) }, OR: [{ affairId: null }, { affair: { status: { not: "paused" } } }] }, include: { affair: true }, orderBy: { createdAt: "asc" } });
      const digest = composeDigest(rows.map(r => ({ title: r.title, body: r.body, affairTitle: r.affair?.title ?? null })), { dayLabel: day });
      if (!digest) return null;
      const row = await tx.notification.create({ data: { workspaceId, ...digest, body: digest.body.slice(0, 2000), level: "now", channel: ctx.chatBound ? "chrona_qqbot" : "in_app", status: "queued", idempotencyKey: key, createdAt: now, nextAttemptAt: now, link: `${ports.publicUrl ?? ""}/today` } });
      for (const folded of rows) await audit(tx, { workspaceId, kind: "digest_included", actor: "chrona", subjectId: folded.id, details: { digestId: row.id } });
      await audit(tx, { workspaceId, kind: "notification_enqueued", actor: "chrona", subjectId: row.id, details: { digest: true } });
      return toNotification(row);
    });
  }
  async function mutate(id: string, action: "acknowledge" | "retry" | "useful" | "not_useful") {
    return db.$transaction(async tx => {
      const row = await tx.notification.findFirst({ where: { id, workspaceId } });
      if (!row) throw new StewardError("not_found", "Notification not found");
      const now = ports.now();
      if (action === "retry" && row.status !== "failed") throw new StewardError("conflict", "Only failed notifications may be retried");
      if (action === "retry" && row.affairId && (await requireAffair(tx, workspaceId, row.affairId)).status === "paused") throw new StewardError("conflict", "Affair is paused");
      const feedback = action === "useful" || action === "not_useful";
      if (feedback && row.feedback === action) return toNotification(row);
      const updated = await tx.notification.update({ where: { id }, data: feedback ? { feedback: action } : action === "retry" ? { status: "queued", attempts: 0, nextAttemptAt: now, lastError: null, leaseToken: null, leaseUntil: null } : { status: "acknowledged", acknowledgedAt: now } });
      await tx.audit.create({ data: { workspaceId, kind: feedback ? "notification_feedback" : `notification_${action}`, actorKey: "user", subjectId: id, details: { action, affairId: row.affairId }, createdAt: now } });
      if (action === "not_useful" && row.affairId) {
        const recent = await tx.audit.findMany({ where: { workspaceId, kind: "notification_feedback", createdAt: { gte: new Date(now.getTime() - 30 * 86400000) } } });
        const ids = [...new Set(recent.filter(r => (r.details as { action?: string }).action === "not_useful").flatMap(r => r.subjectId ? [r.subjectId] : []))];
        if (await tx.notification.count({ where: { workspaceId, affairId: row.affairId, feedback: "not_useful", id: { in: ids } } }) >= 2) {
          const affair = await requireAffair(tx, workspaceId, row.affairId);
          if (affair.notify === "now") {
            await tx.affair.update({ where: { id: affair.id }, data: { notify: "digest", revision: { increment: 1 } } });
            await tx.preference.create({ data: { workspaceId, origin: "learned", text: `「${affair.title}」的例行变化不必立即通知`, createdAt: now } });
            await audit(tx, { workspaceId, kind: "affair_notify_downgraded", actor: "chrona", subjectId: affair.id, details: {} });
          }
        }
      }
      return toNotification(updated);
    });
  }
  return { enqueueNotification: enqueue, enqueue: async (input: Omit<NotificationInput, "workspaceId">) => db.$transaction(async tx => toNotification(await enqueue(tx, { ...input, workspaceId }))), deliverDue, sendDigestIfDue, recordFeedback: (id: string, feedback: "useful" | "not_useful") => mutate(id, feedback), acknowledge: (id: string) => mutate(id, "acknowledge"), retry: (id: string) => mutate(id, "retry"), list: async () => (await db.notification.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } })).map(toNotification) };
}
