import { delegationSchema, type DeliveryAdapter, type DeliveryOutcome } from "@chrona/contracts/steward";
import type { PrismaClient, Prisma, StewardNotification } from "@chrona/db/generated/prisma/client";
import { decidePermission } from "@chrona/domain/steward/permission";
import { StewardError } from "./mappers";

// A claim is deliberately uncertain until the adapter supplies a receipt. No new
// schema status is needed. nextAttemptAt is the lease deadline while claimed.
const CLAIM = "Delivery in progress; outcome unknown until receipt or 5-minute claim timeout.";
const LEASE_MS = 5 * 60_000;
const BACKOFF = [60_000, 300_000, 900_000, 3_600_000];
type Adapter = DeliveryAdapter & { idempotent?: boolean };
type Tx = Prisma.TransactionClient;

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
async function audit(tx: Tx, row: StewardNotification, kind: string, reason: string, at: Date, actorKey = "system:steward") {
  await tx.stewardAudit.create({ data: { workspaceId: row.workspaceId, subjectId: row.id, kind, actorKey, details: { reason, attempt: row.attempts }, createdAt: at } });
}
async function failure(tx: Tx, row: StewardNotification) {
  const dedupeKey = `notification:${row.id}:failed`;
  await tx.attentionItem.upsert({ where: { workspaceId_dedupeKey: { workspaceId: row.workspaceId, dedupeKey } }, update: {}, create: {
    workspaceId: row.workspaceId, dedupeKey, kind: "failure", delegationId: row.delegationId,
    title: "Notification delivery failed", whatHappened: "A notification could not be delivered.",
    whyItMatters: "The intended notification has not been confirmed delivered.", nextStep: "Review delivery history and explicitly retry if appropriate.",
  } });
}

/** Internal application service. The caller supplies its authorized workspace. */
export function createStewardDelivery({ db, adapters, workspaceId, actorKey = "system:steward", now = () => new Date() }: {
  db: PrismaClient; adapters: Record<string, Adapter>; workspaceId: string; actorKey?: string; now?: () => Date;
}) {
  if (!workspaceId) throw new StewardError("FORBIDDEN", "Workspace access required");
  async function recover() {
    const at = now();
    const stale = await db.stewardNotification.findMany({ where: { workspaceId, status: "uncertain", lastError: CLAIM, nextAttemptAt: { lte: at } } });
    for (const row of stale) await db.$transaction(async (tx) => {
      const retry = adapters[row.channel]?.idempotent === true;
      const status = retry ? (row.attempts >= 6 ? "failed" : "queued") : "uncertain";
      const changed = await tx.stewardNotification.updateMany({ where: { id: row.id, status: "uncertain", attempts: row.attempts, lastError: CLAIM, nextAttemptAt: { lte: at } }, data: {
        status, nextAttemptAt: status === "queued" ? at : null, lastError: "Claim timed out; delivery outcome unknown. Automatic retry requires an idempotent adapter.",
      } });
      if (!changed.count) return;
      await audit(tx, row, "notification.claim_timeout", "Delivery claim expired with no receipt.", at);
      if (status === "failed") await failure(tx, row);
    });
  }
  async function claim(id: string) {
    return db.$transaction(async (tx) => {
      const at = now();
      // First statement acquires SQLite's write lock; policy checks and reservations
      // are serialized across workers, not merely across this service instance.
      const changed = await tx.stewardNotification.updateMany({ where: { id, workspaceId, status: "queued", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: at } }] }, data: { status: "uncertain" } });
      if (!changed.count) return null;
      const row = await tx.stewardNotification.findUniqueOrThrow({ where: { id }, include: { delegation: true, attentionItem: true } });
      const suppress = async (reason: string) => {
        await tx.stewardNotification.update({ where: { id }, data: { status: "suppressed", nextAttemptAt: null, lastError: reason } });
        await audit(tx, row, "notification.suppressed", reason, at);
        return null;
      };
      const defer = async (reason: string, until: Date) => {
        await tx.stewardNotification.update({ where: { id }, data: { status: "queued", nextAttemptAt: until, lastError: reason } });
        await audit(tx, row, "notification.deferred", reason, at);
        return null;
      };
      const raw = row.delegation;
      if (!raw || raw.workspaceId !== row.workspaceId || (row.attentionItem && row.attentionItem.workspaceId !== row.workspaceId)) return suppress("An owning delegation in this workspace is required.");
      if (raw.connectionId) {
        const connection = await tx.sourceConnection.findFirst({ where: { id: raw.connectionId, workspaceId } });
        if (!connection || !["active", "failing"].includes(connection.status)) return suppress("Source connection is not active.");
      }
      const { workspaceId: _workspaceId, ...contractFields } = raw;
      const parsed = delegationSchema.safeParse({ ...contractFields, ...Object.fromEntries(["grantedAt", "expiresAt", "lastCheckAt", "lastSuccessAt", "lastFailureAt", "createdAt", "updatedAt"].map((key) => [key, (raw[key as keyof typeof raw] as Date | null)?.toISOString() ?? null])) });
      // Pick contract fields explicitly: Prisma includes persistence-only workspaceId.
      if (!parsed.success) return suppress("Invalid delegation policy; delivery denied.");
      const delegation = parsed.data;
      const permission = decidePermission({ action: "notify_user", delegation, now: at });
      if (permission.outcome !== "allowed") return suppress(permission.reason);
      const policy = delegation.notification;
      if (policy.mode === "silent") return suppress("Notification policy is silent.");
      if (policy.channel !== row.channel) return suppress("Notification channel no longer matches delegation policy.");
      let timezone = "UTC";
      try {
        if (policy.quietHours) {
          const q = policy.quietHours;
          timezone = q.timezone;
          const start = clockMinutes(q.start), end = clockMinutes(q.end);
          const quiet = (date: Date) => { const m = localTime(date, timezone).minute; return start < end ? m >= start && m < end : start > end ? m >= start || m < end : false; };
          if (quiet(at)) return defer("Quiet hours; deferred until quiet hours end.", nextBoundary(at, (date) => !quiet(date)));
        }
        const day = localTime(at, timezone).day;
        // Reservation audits count distinct notifications (not attempts), including
        // uncertain effects, so concurrent workers cannot overspend a daily cap.
        const reservations = await tx.stewardAudit.findMany({ where: { workspaceId: row.workspaceId, kind: "notification.claimed", createdAt: { gte: new Date(at.getTime() - 49 * 3_600_000), lte: at } }, select: { subjectId: true, createdAt: true, details: true } });
        const used = new Set(reservations.filter((r) => localTime(r.createdAt, timezone).day === day && (r.details as { delegationId?: string }).delegationId === row.delegationId).map((r) => r.subjectId));
        const sent = await tx.stewardNotification.findMany({ where: { workspaceId: row.workspaceId, delegationId: row.delegationId, sentAt: { gte: new Date(at.getTime() - 49 * 3_600_000), lte: at } }, select: { id: true, sentAt: true } });
        for (const notification of sent) if (localTime(notification.sentAt!, timezone).day === day) used.add(notification.id);
        used.delete(id); // A retry consumes its original reservation, not a new slot.
        if (used.size >= delegation.limits.maxNotificationsPerDay) return defer("Daily notification cap reached; deferred until next local day.", nextBoundary(at, (date) => localTime(date, timezone).day !== day));
      } catch { return suppress("Invalid notification timezone or quiet-hours policy."); }
      if (row.attentionItemId) {
        const previous = await tx.stewardNotification.findFirst({ where: { attentionItemId: row.attentionItemId, id: { not: id }, sentAt: { not: null } }, orderBy: { sentAt: "desc" } });
        const inFlight = await tx.stewardNotification.findFirst({ where: { attentionItemId: row.attentionItemId, id: { not: id }, status: "uncertain", nextAttemptAt: { gt: at } }, orderBy: { nextAttemptAt: "desc" } });
        const until = Math.max(row.attentionItem?.cooldownUntil?.getTime() ?? 0, previous?.sentAt ? previous.sentAt.getTime() + policy.cooldownMinutes * 60_000 : 0, inFlight?.nextAttemptAt?.getTime() ?? 0);
        if (until > at.getTime()) return defer("Attention-item notification cooldown.", new Date(until));
      }
      const claimed = await tx.stewardNotification.update({ where: { id }, data: { attempts: { increment: 1 }, lastError: CLAIM, nextAttemptAt: new Date(at.getTime() + LEASE_MS) } });
      await tx.stewardAudit.create({ data: { workspaceId: row.workspaceId, subjectId: id, kind: "notification.claimed", actorKey: "system:steward", details: { delegationId: row.delegationId, attempt: claimed.attempts, timeoutAt: claimed.nextAttemptAt!.toISOString() }, createdAt: at } });
      return claimed;
    });
  }
  return {
    async deliverDue({ limit = 100 }: { limit?: number } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid delivery limit");
      await recover();
      const rows = await db.stewardNotification.findMany({ where: { workspaceId, status: "queued", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now() } }] }, orderBy: [{ generatedAt: "asc" }, { id: "asc" }], take: limit });
      let attempted = 0;
      for (const candidate of rows) {
        const row = await claim(candidate.id);
        if (!row) continue;
        attempted++;
        const adapter = adapters[row.channel];
        let outcome: DeliveryOutcome;
        try { outcome = adapter ? await adapter.send({ idempotencyKey: row.idempotencyKey, title: row.title, body: row.body, link: row.link }) : { outcome: "rejected", retryable: false, error: "Adapter unavailable" }; }
        catch { outcome = { outcome: "uncertain", error: "Adapter threw; delivery outcome unknown" }; }
        await db.$transaction(async (tx) => {
          const at = now();
          const retryable = outcome.outcome === "rejected" ? outcome.retryable : outcome.outcome === "uncertain" && adapter?.idempotent === true;
          const status = outcome.outcome === "accepted" ? "sent" : retryable ? (row.attempts >= 6 ? "failed" : "queued") : outcome.outcome === "uncertain" ? "uncertain" : "failed";
          // Fence late receipts from expired claims / explicit user transitions.
          const changed = await tx.stewardNotification.updateMany({ where: { id: row.id, status: "uncertain", attempts: row.attempts, lastError: CLAIM }, data: {
            status, nextAttemptAt: status === "queued" ? new Date(at.getTime() + BACKOFF[Math.min(row.attempts - 1, BACKOFF.length - 1)]) : null,
            lastError: outcome.outcome === "accepted" ? null : outcome.outcome === "uncertain" ? "Delivery outcome unknown; no non-idempotent automatic retry." : "Adapter rejected delivery.",
            ...(outcome.outcome === "accepted" ? { sentAt: at, receiptRef: outcome.receiptRef } : {}),
          } });
          if (!changed.count) return;
          await audit(tx, row, `notification.${status}`, `Adapter outcome: ${outcome.outcome}`, at);
          if (status === "failed") await failure(tx, row);
        });
      }
      return { attempted };
    },
    list() { return db.stewardNotification.findMany({ where: { workspaceId }, orderBy: [{ generatedAt: "desc" }, { id: "asc" }] }); },
    async acknowledge(id: string) {
      return db.$transaction(async (tx) => {
        const at = now();
        const changed = await tx.stewardNotification.updateMany({ where: { id, workspaceId, status: { in: ["sent", "uncertain"] } }, data: { status: "acknowledged", acknowledgedAt: at, nextAttemptAt: null } });
        const row = await tx.stewardNotification.findFirst({ where: { id, workspaceId } });
        if (!row) throw new StewardError("NOT_FOUND", "Notification not found");
        if (changed.count) await audit(tx, row, "notification.acknowledged", "User acknowledged notification, not attention resolution.", at, actorKey);
        return row;
      });
    },
    async retryFailed(id: string) {
      return db.$transaction(async (tx) => {
        const at = now();
        const changed = await tx.stewardNotification.updateMany({ where: { id, workspaceId, status: "failed" }, data: { status: "queued", attempts: 0, nextAttemptAt: at, lastError: "Explicit user retry requested." } });
        const row = await tx.stewardNotification.findFirst({ where: { id, workspaceId } });
        if (!row) throw new StewardError("NOT_FOUND", "Notification not found");
        if (changed.count) await audit(tx, row, "notification.retry_requested", "Explicit user retry; idempotency key preserved.", at, actorKey);
        return row;
      });
    },
  };
}
