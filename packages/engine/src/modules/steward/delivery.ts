import { delegationSchema, type DeliveryAdapter, type DeliveryOutcome } from "@chrona/contracts/steward";
import type { PrismaClient, Prisma, StewardNotification } from "@chrona/db/generated/prisma/client";
import { decidePermission } from "@chrona/domain/steward/permission";
import { StewardError } from "./mappers";
import { deliveryTimePolicy } from "./delivery-policy";

// A claim is deliberately uncertain until the adapter supplies a receipt. No new
// schema status is needed. nextAttemptAt is the lease deadline while claimed.
const CLAIM = "Delivery in progress; outcome unknown until receipt or 5-minute claim timeout.";
const LEASE_MS = 5 * 60_000;
const BACKOFF = [60_000, 300_000, 900_000, 3_600_000];
type Adapter = DeliveryAdapter & { idempotent?: boolean };
type Tx = Prisma.TransactionClient;
function findAdapter(adapters: Record<string, Adapter>, channel: string): Adapter | undefined {
  return adapters[channel];
}

async function audit(tx: Tx, row: StewardNotification, kind: string, reason: string, { at, actorKey = "system:steward" }: { at: Date; actorKey?: string }) {
  await tx.stewardAudit.create({ data: { workspaceId: row.workspaceId, subjectId: row.id, kind, actorKey, details: { reason, attempt: row.attempts }, createdAt: at } });
}
function receiptStatus(outcome: DeliveryOutcome, adapter: Adapter | undefined, attempts: number) {
  const retryable = outcome.outcome === "rejected" ? outcome.retryable : outcome.outcome === "uncertain" && adapter?.idempotent === true;
  if (outcome.outcome === "accepted") return "sent";
  if (retryable) return attempts >= 6 ? "failed" : "queued";
  return outcome.outcome === "uncertain" ? "uncertain" : "failed";
}

type DeliveryRow = Prisma.StewardNotificationGetPayload<{ include: { delegation: true; attentionItem: true } }>;
async function checkDelegation(tx: Tx, row: DeliveryRow, at: Date, workspaceId: string) {
  const raw = row.delegation;
  if (!raw || raw.workspaceId !== row.workspaceId || (row.attentionItem && row.attentionItem.workspaceId !== row.workspaceId)) return "An owning delegation in this workspace is required.";
  if (raw.connectionId) {
    const connection = await tx.sourceConnection.findFirst({ where: { id: raw.connectionId, workspaceId } });
    if (!connection || !["active", "failing"].includes(connection.status)) return "Source connection is not active.";
  }
  const { workspaceId: _workspaceId, ...contractFields } = raw;
  const parsed = delegationSchema.safeParse({ ...contractFields, ...Object.fromEntries(["grantedAt", "expiresAt", "lastCheckAt", "lastSuccessAt", "lastFailureAt", "createdAt", "updatedAt"].map((key) => [key, (raw[key as keyof typeof raw] as Date | null)?.toISOString() ?? null])) });
  if (!parsed.success) return "Invalid delegation policy; delivery denied.";
  return checkNotificationPolicy(parsed.data, row.channel, at);
}

function checkNotificationPolicy(delegation: ReturnType<typeof delegationSchema.parse>, channel: string, at: Date) {
  const permission = decidePermission({ action: "notify_user", delegation, now: at });
  if (permission.outcome !== "allowed") return permission.reason;
  const policy = delegation.notification;
  if (policy.mode === "silent") return "Notification policy is silent.";
  if (policy.channel !== channel) return "Notification channel no longer matches delegation policy.";
  return delegation;
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
      const retry = findAdapter(adapters, row.channel)?.idempotent === true;
      const status = retry ? (row.attempts >= 6 ? "failed" : "queued") : "uncertain";
      const changed = await tx.stewardNotification.updateMany({ where: { id: row.id, status: "uncertain", attempts: row.attempts, lastError: CLAIM, nextAttemptAt: { lte: at } }, data: {
        status, nextAttemptAt: status === "queued" ? at : null, lastError: "Claim timed out; delivery outcome unknown. Automatic retry requires an idempotent adapter.",
      } });
      if (!changed.count) return;
      await audit(tx, row, "notification.claim_timeout", "Delivery claim expired with no receipt.", { at });
      if (status === "failed") await failure(tx, row);
    });
  }
  return createDeliveryActions({ db, adapters, workspaceId, actorKey, now }, recover);
}

type DeliveryContext = {
  db: PrismaClient; adapters: Record<string, Adapter>; workspaceId: string; actorKey: string; now: () => Date;
};
function cooldownDeadline(row: DeliveryRow, previous: StewardNotification | null, inFlight: StewardNotification | null, minutes: number) {
  return Math.max(
    row.attentionItem?.cooldownUntil?.getTime() ?? 0,
    previous?.sentAt ? previous.sentAt.getTime() + minutes * 60_000 : 0,
    inFlight?.nextAttemptAt?.getTime() ?? 0,
  );
}

async function claim({ db, workspaceId, now }: DeliveryContext, id: string) {
    return db.$transaction(async (tx) => {
      const at = now();
      // First statement acquires SQLite's write lock; policy checks and reservations
      // are serialized across workers, not merely across this service instance.
      const changed = await tx.stewardNotification.updateMany({ where: { id, workspaceId, status: "queued", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: at } }] }, data: { status: "uncertain" } });
      if (!changed.count) return null;
      const row = await tx.stewardNotification.findUniqueOrThrow({ where: { id }, include: { delegation: true, attentionItem: true } });
      const suppress = async (reason: string) => {
        await tx.stewardNotification.update({ where: { id }, data: { status: "suppressed", nextAttemptAt: null, lastError: reason } });
        await audit(tx, row, "notification.suppressed", reason, { at });
        return null;
      };
      const defer = async (reason: string, until: Date) => {
        await tx.stewardNotification.update({ where: { id }, data: { status: "queued", nextAttemptAt: until, lastError: reason } });
        await audit(tx, row, "notification.deferred", reason, { at });
        return null;
      };
      const checked = await checkDelegation(tx, row, at, workspaceId);
      if (typeof checked === "string") return suppress(checked);
      const delegation = checked;
      const policy = delegation.notification;
      try {
        const deferred = await deliveryTimePolicy(tx, row, delegation, at);
        if (deferred) return defer(deferred.reason, deferred.until);
      } catch { return suppress("Invalid notification timezone or quiet-hours policy."); }
      if (row.attentionItemId) {
        const previous = await tx.stewardNotification.findFirst({ where: { attentionItemId: row.attentionItemId, id: { not: id }, sentAt: { not: null } }, orderBy: { sentAt: "desc" } });
        const inFlight = await tx.stewardNotification.findFirst({ where: { attentionItemId: row.attentionItemId, id: { not: id }, status: "uncertain", nextAttemptAt: { gt: at } }, orderBy: { nextAttemptAt: "desc" } });
        const until = cooldownDeadline(row, previous, inFlight, policy.cooldownMinutes);
        if (until > at.getTime()) return defer("Attention-item notification cooldown.", new Date(until));
      }
      const claimed = await tx.stewardNotification.update({ where: { id }, data: { attempts: { increment: 1 }, lastError: CLAIM, nextAttemptAt: new Date(at.getTime() + LEASE_MS) } });
      await tx.stewardAudit.create({ data: { workspaceId: row.workspaceId, subjectId: id, kind: "notification.claimed", actorKey: "system:steward", details: { delegationId: row.delegationId, attempt: claimed.attempts, timeoutAt: claimed.nextAttemptAt!.toISOString() }, createdAt: at } });
      return claimed;
    });
  }
function createDeliveryActions(context: DeliveryContext, recover: () => Promise<void>) {
  const { db, adapters, workspaceId, actorKey, now } = context;
  return {
    async deliverDue({ limit = 100 }: { limit?: number } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid delivery limit");
      await recover();
      const rows = await db.stewardNotification.findMany({ where: { workspaceId, status: "queued", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now() } }] }, orderBy: [{ generatedAt: "asc" }, { id: "asc" }], take: limit });
      let attempted = 0;
      for (const candidate of rows) {
        const row = await claim(context, candidate.id);
        if (!row) continue;
        attempted++;
        const adapter = findAdapter(adapters, row.channel);
        let outcome: DeliveryOutcome;
        try { outcome = adapter ? await adapter.send({ idempotencyKey: row.idempotencyKey, title: row.title, body: row.body, link: row.link }) : { outcome: "rejected", retryable: false, error: "Adapter unavailable" }; }
        catch { outcome = { outcome: "uncertain", error: "Adapter threw; delivery outcome unknown" }; }
        await db.$transaction(async (tx) => {
          const at = now();
          const status = receiptStatus(outcome, adapter, row.attempts);
          // Fence late receipts from expired claims / explicit user transitions.
          const changed = await tx.stewardNotification.updateMany({ where: { id: row.id, status: "uncertain", attempts: row.attempts, lastError: CLAIM }, data: {
            status, nextAttemptAt: status === "queued" ? new Date(at.getTime() + BACKOFF[Math.min(row.attempts - 1, BACKOFF.length - 1)]) : null,
            lastError: outcome.outcome === "accepted" ? null : outcome.outcome === "uncertain" ? "Delivery outcome unknown; no non-idempotent automatic retry." : "Adapter rejected delivery.",
            ...(outcome.outcome === "accepted" ? { sentAt: at, receiptRef: outcome.receiptRef } : {}),
          } });
          if (!changed.count) return;
          await audit(tx, row, `notification.${status}`, `Adapter outcome: ${outcome.outcome}`, { at });
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
        if (changed.count) await audit(tx, row, "notification.acknowledged", "User acknowledged notification, not attention resolution.", { at, actorKey });
        return row;
      });
    },
    async retryFailed(id: string) {
      return db.$transaction(async (tx) => {
        const at = now();
        const changed = await tx.stewardNotification.updateMany({ where: { id, workspaceId, status: "failed" }, data: { status: "queued", attempts: 0, nextAttemptAt: at, lastError: "Explicit user retry requested." } });
        const row = await tx.stewardNotification.findFirst({ where: { id, workspaceId } });
        if (!row) throw new StewardError("NOT_FOUND", "Notification not found");
        if (changed.count) await audit(tx, row, "notification.retry_requested", "Explicit user retry; idempotency key preserved.", { at, actorKey });
        return row;
      });
    },
  };
}
