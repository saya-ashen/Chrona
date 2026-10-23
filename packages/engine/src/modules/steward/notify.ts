import type { Prisma } from "@chrona/db";
import { z } from "zod";
import { notificationSchema, type NotifyLevel, type DeliveryOutcome } from "@chrona/contracts/steward";
import { routeNotification, localDayKey, isDigestDue, foldedBeforeDigest, RESPONSE_KEY_PREFIX } from "@chrona/domain/steward/notify-budget";
import { composeDigest } from "@chrona/domain/steward/digest";
import type { StewardPorts } from "./ports";
import { notificationSettings } from "./settings";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toNotification } from "./store";
export type NotificationInput = { workspaceId: string; moduleId?: string; sessionId?: string; approvalId?: string; level: NotifyLevel; title: string; body: string; urgent?: boolean; responds?: boolean; dedupeKey: string };
export { RESPONSE_KEY_PREFIX };
export type NotificationContext = { now: Date; chatBound: boolean; publicUrl: string | null };
const notificationInputSchema = notificationSchema.pick({ level: true, title: true, body: true }).extend({ workspaceId: z.string().min(1), moduleId: z.string().min(1).optional(), sessionId: z.string().min(1).optional(), approvalId: z.string().min(1).optional(), urgent: z.boolean().optional(), responds: z.boolean().optional(), dedupeKey: z.string().min(1).max(500) }).strict();
export async function enqueueNotification(tx: Prisma.TransactionClient, raw: NotificationInput, context: NotificationContext) {
  const input = parseInput(notificationInputSchema, raw);
  const { workspaceId, dedupeKey } = input;
  const existing = await tx.notification.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: dedupeKey } } });
  if (existing) return existing;
  const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (input.moduleId && !await tx.module.findFirst({ where: { id: input.moduleId, workspaceId } })) throw new StewardError("not_found", "Module not found");
  if (input.sessionId && !await tx.session.findFirst({ where: { id: input.sessionId, workspaceId } })) throw new StewardError("not_found", "Session not found");
  if (input.approvalId && !await tx.approval.findFirst({ where: { id: input.approvalId, workspaceId, moduleId: input.moduleId ?? null } })) throw new StewardError("not_found", "Approval not found");
  const settings = notificationSettings(workspace.settings), day = localDayKey(context.now, settings.timezone);
  // Reserve budget for queued sends too: a batch must not overrun the cap before delivery.
  const sent = await tx.notification.findMany({ where: { workspaceId, level: "now", OR: [{ sentAt: { gte: new Date(context.now.getTime() - 48 * 3600000) } }, { status: "queued" }] } });
  const sentToday = sent.filter(r => localDayKey(r.sentAt ?? r.createdAt, settings.timezone) === day && !r.idempotencyKey.startsWith("digest:") && !r.idempotencyKey.startsWith(RESPONSE_KEY_PREFIX)).length;
  const negative = input.moduleId ? await tx.notification.count({ where: { workspaceId, moduleId: input.moduleId, feedback: "not_useful", createdAt: { gte: new Date(context.now.getTime() - 30 * 86400000) } } }) : 0;
  const responds = input.responds ?? false;
  const route = routeNotification(!responds && negative >= 2 && input.level === "now" ? "digest" : input.level, { ...settings, now: context.now, urgent: input.urgent ?? false, sentToday, responds });
  const row = await tx.notification.create({ data: { workspaceId, moduleId: input.moduleId, sessionId: input.sessionId, approvalId: input.approvalId, level: input.level, title: input.title, body: input.body, idempotencyKey: dedupeKey, ...notificationRouting(input, context, route), createdAt: context.now, nextAttemptAt: context.now } });
  await audit(tx, { workspaceId, kind: "notification_enqueued", actor: "chrona", subjectId: row.id, details: { status: row.status, route } });
  return row;
}
function notificationRouting(input: NotificationInput, context: NotificationContext, route: ReturnType<typeof routeNotification>) {
  return {
    channel: route === "web" || !context.chatBound ? "in_app" : "chrona_qqbot",
    status: route === "fold" ? "folded" : "queued",
    link: input.sessionId ? `${context.publicUrl ?? ""}/sessions/${input.sessionId}` : input.moduleId ? `${context.publicUrl ?? ""}/apps/${input.moduleId}` : null,
  };
}
function deliveryStatus(outcome: DeliveryOutcome, attempts: number) {
  return outcome.outcome === "accepted" ? "sent" : outcome.outcome === "uncertain" ? "uncertain" : outcome.retryable && attempts < 6 ? "queued" : "failed";
}
function validateMutation(action: string, status: string) {
  if (action === "retry" && status !== "failed") throw new StewardError("conflict", "Only failed notifications may be retried");
}
export function createNotifications(ports: StewardPorts, workspaceId: string) {
  const { db } = ports;
  const context = async (now: Date): Promise<NotificationContext> => ({ now, chatBound: ports.chat ? await ports.chat.bound() : false, publicUrl: ports.publicUrl });
  async function enqueue(tx: Prisma.TransactionClient, input: NotificationInput) {
    if (input.workspaceId !== workspaceId) throw new StewardError("forbidden", "Workspace mismatch");
    return enqueueNotification(tx, input, await context(ports.now()));
  }
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
        return (await tx.notification.updateMany({ where: { id: row.id, status: "queued", leaseToken: null }, data: { leaseToken: token, leaseUntil: new Date(now.getTime() + 300000), attempts: { increment: 1 } } })).count > 0;
      });
      if (!claimed) continue;
      let outcome: DeliveryOutcome;
      const adapter = ports.deliveries.find(d => d.channel === row.channel);
      try { outcome = adapter ? await adapter.send({ idempotencyKey: row.idempotencyKey, title: row.title, body: row.body, link: row.link, recipient: row.recipient, ...(row.approvalId ? { approval: { id: row.approvalId, scoped: !!row.moduleId } } : {}) }) : { outcome: "rejected", retryable: false, error: "Delivery channel unavailable" }; }
      catch { outcome = { outcome: "uncertain", error: "Delivery adapter threw; receipt unknown" }; }
      const attempts = row.attempts + 1;
      const status = deliveryStatus(outcome, attempts);
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
      const rows = await tx.notification.findMany({ where: { workspaceId, status: "folded", id: { notIn: memberships.flatMap(r => r.subjectId ? [r.subjectId] : []) } }, include: { module: true }, orderBy: { createdAt: "asc" } });
      const due = rows.filter(r => foldedBeforeDigest(r.createdAt, { ...settings, now }));
      const digest = composeDigest(due.map(r => ({ title: r.title, body: r.body, moduleTitle: r.module?.name ?? null })), { dayLabel: day });
      if (!digest) return null;
      const row = await tx.notification.create({ data: { workspaceId, ...digest, body: digest.body.slice(0, 2000), level: "now", channel: ctx.chatBound ? "chrona_qqbot" : "in_app", status: "queued", idempotencyKey: key, createdAt: now, nextAttemptAt: now, link: `${ports.publicUrl ?? ""}/today` } });
      for (const folded of due) await audit(tx, { workspaceId, kind: "digest_included", actor: "chrona", subjectId: folded.id, details: { digestId: row.id } });
      await audit(tx, { workspaceId, kind: "notification_enqueued", actor: "chrona", subjectId: row.id, details: { digest: true } });
      return toNotification(row);
    });
  }
  async function mutate(id: string, action: "acknowledge" | "retry" | "useful" | "not_useful") {
    return db.$transaction(async tx => {
      const row = await tx.notification.findFirst({ where: { id, workspaceId } });
      if (!row) throw new StewardError("not_found", "Notification not found");
      const now = ports.now();
      validateMutation(action, row.status);
      const feedback = action === "useful" || action === "not_useful";
      if (feedback && row.feedback === action) return toNotification(row);
      const updated = await tx.notification.update({ where: { id }, data: feedback ? { feedback: action } : action === "retry" ? { status: "queued", attempts: 0, nextAttemptAt: now, lastError: null, leaseToken: null, leaseUntil: null } : { status: "acknowledged", acknowledgedAt: now } });
      await tx.audit.create({ data: { workspaceId, kind: feedback ? "notification_feedback" : `notification_${action}`, actorKey: "user", subjectId: id, details: { action, moduleId: row.moduleId }, createdAt: now } });
      // Feedback stays on notification rows; enqueue derives the module's downgrade.
      return toNotification(updated);
    });
  }
  /** Every open approval is announced once, wherever it was created; the user is waiting on it, so caps and quiet hours do not hold it back. */
  async function announceApprovals(now = ports.now()) {
    const open = await db.approval.findMany({ where: { workspaceId, status: "open", notifications: { none: {} } }, orderBy: { createdAt: "asc" }, take: 20 });
    for (const row of open) await db.$transaction(async tx => enqueueNotification(tx, { workspaceId, ...(row.moduleId ? { moduleId: row.moduleId } : {}), approvalId: row.id, level: "now", responds: true,
      title: `需要你批准：${row.title}`.slice(0, 200), body: [row.detail, row.preview].filter(Boolean).join("\n\n").slice(0, 1500), dedupeKey: `approval:${row.id}` }, await context(now)));
  }
  return { announceApprovals, enqueueNotification: enqueue, enqueue: async (input: Omit<NotificationInput, "workspaceId">) => db.$transaction(async tx => toNotification(await enqueue(tx, { ...input, workspaceId }))), deliverDue, sendDigestIfDue, recordFeedback: (id: string, feedback: "useful" | "not_useful") => mutate(id, feedback), acknowledge: (id: string) => mutate(id, "acknowledge"), retry: (id: string) => mutate(id, "retry"), list: async () => (await db.notification.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } })).map(toNotification) };
}
