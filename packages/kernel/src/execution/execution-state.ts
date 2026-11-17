import type { VerifiedExecutionStop } from "./execution-delivery-stop-types";
import { assertVerifiedExecutionStop } from "./execution-delivery-stop";
export { executionDigest } from "./execution-delivery-digest";
import type { Prisma } from "@chrona/db";
import { EXECUTION_EVENT_LIMITS, type ExecutionPrincipal, type ExecutionRef, type ExecutionSnapshot, type ExecutionView } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { CallError } from "../modules/module-call-error";

type Attempt = Prisma.ExecutionAttemptGetPayload<{ include: { run: true } }>;
export const executionCallerKey = (principal: ExecutionPrincipal) => principal.caller.kind === "owner" ? "owner" : `module:${principal.caller.moduleId}`;
export function executionScope(principal: ExecutionPrincipal): Prisma.ExecutionAttemptWhereInput {
  return { workspaceId: principal.workspaceId, ownerId: principal.ownerId, ...(principal.caller.kind === "module" ? { callerKey: executionCallerKey(principal), callerHash: principal.caller.hash } : {}) };
}
export function executionRef(row: Attempt): ExecutionRef {
  if (!row.run.sessionId) throw new CallError("conflict", "Execution session is missing");
  return { workId: row.workId, sessionId: row.run.sessionId, runId: row.runId, attemptId: row.id };
}
export function executionView(row: Attempt): ExecutionView {
  let status: ExecutionView["status"];
  if (row.run.status === "queued") status = "queued";
  else if (row.run.status === "running") status = row.capabilityRevokedAt ? "unknown" : "running";
  else if (!row.stopConfirmedAt) status = "unknown";
  else if (row.cancelRequestedAt) status = "cancelled";
  else status = row.run.status === "finished" ? "completed" : "failed";
  return { ...executionRef(row), projectRef: row.projectRef, status, cancelRequested: !!row.cancelRequestedAt, stopConfirmed: !!row.stopConfirmedAt };
}
export function executionPrincipal(row: Attempt): ExecutionPrincipal {
  return { workspaceId: row.workspaceId, ownerId: row.ownerId, caller: row.moduleId && row.callerHash ? { kind: "module", moduleId: row.moduleId, hash: row.callerHash } : { kind: "owner" } };
}
export function executionBaseline(baseline: string): { kind: "commit" | "snapshot"; digest: string } {
  const separator = baseline.indexOf(":");
  const kind = baseline.slice(0, separator), digest = baseline.slice(separator + 1);
  if ((kind !== "commit" && kind !== "snapshot") || !digest || digest.length > 128) throw new CallError("conflict", "Execution baseline has no explicit kind");
  return { kind, digest };
}
export function executionEventStore(ports: StewardPorts) {
  if (!ports.executionEvents) throw new CallError("unavailable", "Execution event storage is not configured");
  return ports.executionEvents;
}
export async function executionSnapshot(tx: Prisma.TransactionClient, row: Attempt, now: Date): Promise<ExecutionSnapshot> {
  const stored = await tx.executionSnapshot.findUnique({ where: { attemptId: row.id } });
  const previous = stored?.snapshot as ExecutionSnapshot | undefined;
  return { ...executionRef(row), highWatermark: row.highWatermark, status: executionView(row).status,
    cancelRequested: !!row.cancelRequestedAt, stopConfirmed: !!row.stopConfirmedAt, finalMessage: previous?.finalMessage ?? null,
    questions: (previous?.questions ?? []).map(question => ({ ...question, status: question.status === "pending" && row.run.status !== "running" ? "interrupted" : question.status })),
    missing: previous?.missing ?? false, expiresAt: new Date(now.getTime() + EXECUTION_EVENT_LIMITS.snapshotRetentionMs).toISOString() };
}
/** Called inside Run.finish's transaction; unknown completion never releases a writable directory. */
export async function finishExecution(ports: StewardPorts, tx: Prisma.TransactionClient, runId: string, evidence?: "provider_exited" | "never_started" | VerifiedExecutionStop, now = ports.now()) {
  let row = await tx.executionAttempt.findUnique({ where: { runId }, include: { run: true } });
  if (!row) return false;
  const principal = executionPrincipal(row);
  if (row.stopConfirmedAt) return true;
  await assertExecutionStop(tx, row, evidence);
  row = await tx.executionAttempt.update({ where: { id: row.id }, data: { capabilityRevokedAt: row.capabilityRevokedAt ?? now, ...(evidence ? { stopConfirmedAt: now, stopEvidence: typeof evidence === "string" ? { kind: evidence, at: now.toISOString() } : evidence as unknown as Prisma.InputJsonValue, heldDirectory: null } : {}) }, include: { run: true } });
  await executionEventStore(ports).control(tx, principal, executionRef(row), { slot: "terminal", at: now.toISOString(), status: evidence ? "confirmed" : "unknown" });
  await executionEventStore(ports).saveSnapshot(tx, principal, await executionSnapshot(tx, row, now));
  await ports.onExecutionFinishedIn?.(tx, row.workspaceId, runId);
  return true;
}

/** Caller holds the workspace writer lock; an offered response may have been lost. */
export async function executionNeverOfferedIn(tx: Prisma.TransactionClient, row: Attempt) {
  if (row.targetBinding) {
    const delivery = await tx.executionDelivery.findUnique({ where: { attemptId: row.id } });
    return !!delivery && !delivery.offeredAt && !delivery.acceptedAt && !delivery.startedAt && !delivery.finalDigest && !delivery.processIdentity && delivery.sourceThrough === 0;
  }
  return false;
}

async function assertDeliveryStop(tx: Prisma.TransactionClient, row: Attempt, evidence: VerifiedExecutionStop) {
  assertVerifiedExecutionStop(evidence, row.id);
  const delivery = await tx.executionDelivery.findUniqueOrThrow({ where: { attemptId: row.id } });
  if (delivery.id !== evidence.target.deliveryId || delivery.launchDigest !== evidence.target.launchDigest || delivery.finalDigest !== evidence.statement.finalDigest) throw new CallError("conflict", "Verified stop no longer matches delivery");
}
async function assertExecutionStop(tx: Prisma.TransactionClient, row: Attempt, evidence?: "provider_exited" | "never_started" | VerifiedExecutionStop) {
  if (!evidence) return;
  if (typeof evidence !== "string" && "statement" in evidence) {
    await assertDeliveryStop(tx, row, evidence);
    return;
  }
  if (row.targetBinding) {
    if (evidence === "never_started" && (!row.run.startedAt || row.capabilityRevokedAt && await executionNeverOfferedIn(tx, row))) {
      await tx.executionDelivery.updateMany({ where: { attemptId: row.id }, data: { settledAt: new Date() } });
      return;
    }
    throw new CallError("forbidden", "Application execution requires kernel-verified stop evidence");
  }
  if (evidence === "provider_exited") return;
  if (!row.run.startedAt) return;
  throw new CallError("conflict", "A started run requires process exit evidence");
}
