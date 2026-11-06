import { createHash } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { EXECUTION_EVENT_LIMITS, type ExecutionPrincipal, type ExecutionRef, type ExecutionSnapshot, type ExecutionView } from "@chrona/contracts/steward";
import type { VerifiedDeviceStop, StewardPorts } from "./ports";
import { deviceCommandBytes } from "./execution-control-budget";
import { CallError } from "./module-calls";

type Attempt = Prisma.ExecutionAttemptGetPayload<{ include: { run: true } }>;
export const executionDigest = (input: unknown): string => createHash("sha256").update(JSON.stringify(input, (_, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest("hex");
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
export async function finishExecution(ports: StewardPorts, tx: Prisma.TransactionClient, runId: string, evidence?: "provider_exited" | "never_started" | VerifiedDeviceStop, now = ports.now()) {
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
  if (row.executorId === "server" || row.sourceReceipt) return false;
  const a = await tx.executorAssignment.findUnique({ where: { attemptId: row.id } });
  if (!a || a.executorId !== row.executorId || a.generation !== row.executorGeneration) return false;
  if ([a.offeredAt, a.startedAt, a.processIdentity, a.final, a.finalDigest, a.finalizedAt, a.tombstoneDigest].some(value => value !== null)) return false;
  if ([a.sourceHighWatermark, a.sourceProducedThrough, a.receiptCount].some(value => value !== 0)) return false;
  const commands = await tx.executionCommand.findMany({ where: { attemptId: row.id } });
  if (commands.some(command => command.operation !== "cancel" || command.offeredAt)) return false;
  // Cancellation receipts consume shared metadata bytes, not source/process progress.
  const cancelBytes = commands.reduce((bytes, command) => bytes + deviceCommandBytes({ ...command, receipt: command.receipt as Prisma.InputJsonValue }), 0);
  return a.receiptBytes === cancelBytes && !await tx.executorSourceReceipt.count({ where: { attemptId: row.id } });
}

async function assertExecutionStop(tx: Prisma.TransactionClient, row: Attempt, evidence?: "provider_exited" | "never_started" | VerifiedDeviceStop) {
  if (!evidence) return;
  if (evidence === "provider_exited") {
    if (row.executorId !== "server") throw new CallError("conflict", "Device execution requires verified device stop evidence");
    return;
  }
  const assignment = await tx.executorAssignment.findUnique({ where: { attemptId: row.id } });
  if (evidence === "never_started") {
    if (row.executorId === "server" && !row.run.startedAt || !row.run.startedAt && !assignment) return;
    if (!assignment || !row.capabilityRevokedAt || !await executionNeverOfferedIn(tx, row)) throw new CallError("conflict", "A started run requires process exit evidence");
    await tx.executorAssignment.update({ where: { attemptId: row.id }, data: { tombstoneDigest: executionDigest({ assignmentId: assignment.assignmentId, launchDigest: assignment.launchDigest, kind: "never_offered" }) } });
    return;
  }
  assertDeviceStop(row, assignment, evidence);
}
function assertDeviceStop(row: Attempt, assignment: { assignmentId: string; generation: number } | null, evidence: VerifiedDeviceStop) {
  const { assignmentId, generation, ...ref } = evidence.target;
  if (!assignment || evidence.executorId !== row.executorId || evidence.generation !== assignment.generation || assignmentId !== assignment.assignmentId || generation !== assignment.generation || executionDigest(ref) !== executionDigest(executionRef(row))) throw new CallError("conflict", "Verified stop reference mismatch");
}
