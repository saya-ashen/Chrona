import { z } from "zod";
import { executionIdSchema, executionDeliveryTargetSchema, executionReceiverSchema, type ExecutionReceiver } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { executionDigest } from "./execution-delivery-digest";
import { deliveryIn, deliveryInclude, receiverIn, receiptIn, replayIn, json, type DeliveryRow } from "./execution-delivery-records";
import { executionNeverOfferedIn } from "./execution-state";
import { finishRunIn } from "./run-finish";
import { CallError } from "./module-call-error";

const subject = { subjectId: executionIdSchema, epoch: z.number().int().positive(), keyId: executionIdSchema };
const reason = z.string().min(1).max(1000);
const snapshotItem = z.object({ deliveryId: executionIdSchema, launchDigest: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(["intent", "spawn_possible", "running", "unknown", "stopped"]), journalSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), sourceWatermark: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export const executionGovernanceRequests = [
  z.object({ operation: z.literal("revoke"), key: executionIdSchema, ...subject, reason }).strict(),
  z.object({ operation: z.literal("cancel"), key: executionIdSchema, target: executionDeliveryTargetSchema, reason }).strict(),
  z.object({ operation: z.literal("reconcile"), key: executionIdSchema, ...subject, snapshotId: executionIdSchema, page: z.number().int().min(0).max(99), complete: z.boolean(), items: z.array(snapshotItem).max(100) }).strict(),
  z.object({ operation: z.literal("retention"), key: executionIdSchema }).strict(),
] as const;
const requestSchema = z.discriminatedUnion("operation", executionGovernanceRequests);
type Request = z.infer<typeof requestSchema>;
type Reconcile = Extract<Request, { operation: "reconcile" }>;
type Subject = Pick<Reconcile, "subjectId" | "epoch" | "keyId">;
const receiptKind = "execution_governance_receipt";
const reconcileKind = "execution_governance_reconcile";

function receiverWhere(who: ExecutionReceiver) {
  return { workspaceId: who.workspaceId, receiverModuleId: who.moduleId, receiverHash: who.hash, receiverActivationId: who.activationId };
}
function actor(who: ExecutionReceiver) { return `execution-receiver:${executionDigest(who)}`; }
function snapshotScope(who: ExecutionReceiver, input: Reconcile) {
  return executionDigest([who, input.subjectId, input.epoch, input.keyId, input.snapshotId]);
}
async function authorityIn(tx: Prisma.TransactionClient, who: ExecutionReceiver, input: Subject) {
  const rows = await tx.executionAuthority.findMany({ where: { ...receiverWhere(who), subjectId: input.subjectId, epoch: input.epoch, keyId: input.keyId }, take: 2 });
  if (rows.length !== 1) throw new CallError("forbidden", "Exact receiver subject authority is unavailable");
  return rows[0]!;
}
async function cancelDeliveryIn(ports: StewardPorts, tx: Prisma.TransactionClient, row: DeliveryRow, controlKey: string, now: Date) {
  if (row.settledAt) return;
  const a = row.attempt;
  await tx.executionAttempt.update({ where: { id: a.id }, data: { capabilityRevokedAt: a.capabilityRevokedAt ?? now, cancelRequestedAt: a.cancelRequestedAt ?? now } });
  // An offered packet may already have started, even if its acceptance reply was lost.
  if (await executionNeverOfferedIn(tx, a)) {
    await finishRunIn(ports, a.workspaceId, tx, a.runId, { outcome: "failed", sessionId: null, error: "Execution receiver cancellation" }, now, "never_started");
    return;
  }
  const payload = { operation: "cancel" };
  if (!await replayIn(tx, row, "control", controlKey, payload)) await receiptIn(tx, row, "control", controlKey, payload, { admitted: true }, now, "outbound");
}
async function revokeIn(ports: StewardPorts, tx: Prisma.TransactionClient, who: ExecutionReceiver, input: Extract<Request, { operation: "revoke" }>, now: Date) {
  const authority = await authorityIn(tx, who, input);
  await tx.executionAuthority.update({ where: { id: authority.id }, data: { revokedAt: authority.revokedAt ?? now } });
  const attempts = await tx.executionAttempt.findMany({ where: { workspaceId: who.workspaceId, stopConfirmedAt: null, targetBinding: { path: "$.authorityId", equals: authority.id } }, include: { run: true } });
  for (const a of attempts) {
    const row = await tx.executionDelivery.findUnique({ where: { attemptId: a.id }, include: deliveryInclude });
    if (row) await cancelDeliveryIn(ports, tx, row, `revoke:${authority.id}`, now);
    else {
      await tx.executionAttempt.update({ where: { id: a.id }, data: { capabilityRevokedAt: a.capabilityRevokedAt ?? now, cancelRequestedAt: a.cancelRequestedAt ?? now } });
      if (a.run.status === "queued" && !a.run.startedAt) await finishRunIn(ports, who.workspaceId, tx, a.runId, { outcome: "failed", sessionId: null, error: "Execution authority revoked" }, now, "never_started");
    }
  }
  return { revoked: true, subjectId: input.subjectId, epoch: input.epoch, keyId: input.keyId };
}
async function snapshotItemsIn(tx: Prisma.TransactionClient, who: ExecutionReceiver, input: Reconcile) {
  const pages = await tx.audit.findMany({ where: { workspaceId: who.workspaceId, actorKey: actor(who), kind: reconcileKind, subjectId: snapshotScope(who, input) } });
  const previous = pages.map(page => (page.details as { payload: Reconcile }).payload).sort((a, b) => a.page - b.page);
  if (previous.length !== input.page || previous.some((page, index) => page.page !== index || page.complete)) throw new CallError("conflict", "Reconciliation pages must be contiguous and immutable");
  const items = [...previous.flatMap(page => page.items), ...input.items];
  if (items.length > 100) throw new CallError("capacity", "Reconciliation snapshot exceeds item limit");
  if (new Set(items.map(item => item.deliveryId)).size !== items.length) throw new CallError("conflict", "Duplicate reconciliation delivery");
  return items;
}
function consistentItem(row: DeliveryRow, item: Reconcile["items"][number]) {
  if (item.sourceWatermark !== row.sourceThrough || item.state === "intent" && !!row.startedAt) return false;
  if (row.finalDigest && !row.settledAt) return false;
  return !(["spawn_possible", "unknown"].includes(item.state) || item.state === "stopped" && !row.settledAt);
}
async function reconcileIn(tx: Prisma.TransactionClient, who: ExecutionReceiver, input: Reconcile) {
  const authority = await authorityIn(tx, who, input), items = await snapshotItemsIn(tx, who, input);
  let consistent = true;
  for (const item of items) {
    const row = await tx.executionDelivery.findUnique({ where: { id: item.deliveryId }, include: deliveryInclude });
    if (!row || row.authorityId !== authority.id || row.launchDigest !== item.launchDigest) throw new CallError("forbidden", "Reconciliation delivery fence mismatch");
    if (!consistentItem(row, item)) consistent = false;
  }
  const pending = await tx.executionDelivery.findMany({ where: { authorityId: authority.id, settledAt: null, offeredAt: { not: null } }, orderBy: { id: "asc" } });
  const seen = new Set(items.map(item => item.deliveryId));
  const missing = input.complete ? pending.filter(row => !seen.has(row.id)).map(row => row.id) : [];
  const module = await receiverIn(tx, who, false);
  // A journal is evidence of transport state only. It never certifies process stop,
  // clears capability fences, finishes Runs, or releases occupied directories.
  return { recorded: true, reconciled: input.complete, missing, launchable: input.complete && !authority.revokedAt && module.status === "active" && !module.executionFenceAt && consistent && missing.length === 0 };
}
async function retentionIn(tx: Prisma.TransactionClient, who: ExecutionReceiver) {
  const module = await receiverIn(tx, who, false);
  const where = { receiverModuleId: who.moduleId, receiverHash: who.hash, receiverActivationId: who.activationId, attempt: { workspaceId: who.workspaceId } };
  const rows = await tx.executionDelivery.findMany({ where: { ...where, OR: [{ settledAt: null }, { receipts: { some: { direction: "outbound", acceptedAt: null } } }] }, select: { id: true, receipts: { where: { direction: "outbound", acceptedAt: null }, select: { requestKey: true } } } });
  const authorities = await tx.executionAuthority.findMany({ where: receiverWhere(who), select: { id: true } });
  const queued = authorities.length ? await tx.executionAttempt.count({ where: { workspaceId: who.workspaceId, stopConfirmedAt: null, delivery: null, OR: authorities.map(authority => ({ targetBinding: { path: "$.authorityId", equals: authority.id } })) } }) : 0;
  const pendingDeliveryIds = rows.map(row => row.id).sort(), pendingControlKeys = [...new Set(rows.flatMap(row => row.receipts.map(receipt => receipt.requestKey)))].sort();
  // A positive immutable observation is useful only behind the host lifecycle
  // fence. Resume rotates activation, so it cannot replay this old permission.
  return { safeToDelete: !!module.executionFenceAt && queued === 0 && rows.length === 0, pendingDeliveryIds, pendingControlKeys };
}
/** Receiver-only governance. Audit holds immutable receipts even before a delivery exists;
 * these rows are committed facts, never jobs or a second execution queue. */
export function createExecutionDeliveryGovernance(ports: StewardPorts) {
  return async (rawWho: ExecutionReceiver, raw: unknown) => {
    const who = executionReceiverSchema.parse(rawWho), input = requestSchema.parse(raw);
    if (Buffer.byteLength(JSON.stringify(input)) > 65_536) throw new CallError("too_large", "Governance request exceeds byte limit");
    return ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${who.workspaceId}`;
      await receiverIn(tx, who, false);
      const id = `execution-governance:${executionDigest([who, input.operation, input.key])}`, digest = executionDigest(input);
      const prior = await tx.audit.findUnique({ where: { id } });
      if (prior) {
        const details = prior.details as { requestDigest: string; receipt: Prisma.JsonValue };
        if (details.requestDigest !== digest) throw new CallError("conflict", "Governance receipt key contains different content");
        return details.receipt;
      }
      const kinds = [receiptKind, reconcileKind], control = input.operation === "revoke" || input.operation === "cancel";
      // Reconciliation/status traffic cannot consume the reserve for durable fences.
      if (await tx.audit.count({ where: { actorKey: actor(who), kind: { in: kinds } } }) >= (control ? 1024 : 896) || await tx.audit.count({ where: { kind: { in: kinds } } }) >= (control ? 4096 : 3840)) throw new CallError("capacity", "Governance receipt storage limit exceeded");
      const now = ports.now();
      const receipt = await executeIn(ports, tx, who, input, now);
      const details = { requestDigest: digest, payload: input, receipt };
      if (Buffer.byteLength(JSON.stringify(details)) > 65_536) throw new CallError("capacity", "Governance receipt exceeds storage limit");
      await tx.audit.create({ data: { id, workspaceId: who.workspaceId, actorKey: actor(who), kind: input.operation === "reconcile" ? reconcileKind : receiptKind, subjectId: input.operation === "reconcile" ? snapshotScope(who, input) : who.moduleId, details: json(details), createdAt: now } });
      return receipt;
    });
  };
}
async function executeIn(ports: StewardPorts, tx: Prisma.TransactionClient, who: ExecutionReceiver, input: Request, now: Date) {
  switch (input.operation) {
    case "revoke": return revokeIn(ports, tx, who, input, now);
    case "reconcile": return reconcileIn(tx, who, input);
    case "retention": return retentionIn(tx, who);
    case "cancel": {
      const row = await deliveryIn(tx, who, input.target);
      const controlKey = `receiver-cancel:${executionDigest([who, input.key, input.target.deliveryId])}`;
      await cancelDeliveryIn(ports, tx, row, controlKey, now);
      return { controlKey };
    }
  }
}
