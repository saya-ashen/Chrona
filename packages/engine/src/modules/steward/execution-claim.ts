import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@chrona/db";
import { KERNEL_EXECUTION_LIMITS, type ExecutionPrincipal, type LocalExecutionProjectGrant, type WorkPlacement, type RunLane } from "@chrona/contracts/steward";
import { prepareLocalWorkspace } from "./local-workspace";
import type { ExecutionClaimSelection, StewardPorts } from "./ports";
import { assertPreparedServerWorkspace, serverClaimRequest, type ServerClaimPreparation } from "./execution-server-workspace";
import { audit } from "./audit";
import { CallError } from "./module-calls";
import { assertExecutionPrincipal } from "./execution-principal";
import { executionDigest, executionPrincipal, executionSnapshot, executionEventStore, finishExecution } from "./execution-state";
type Attempt = Prisma.ExecutionAttemptGetPayload<{ include: { run: true } }>;
/** Device independent trees have logical reservations; the daemon owns their physical lifetime lock. */
export function heldExecutionDirectory(executorId: string, directoryIdentity: string, independentWorkspaceRef?: string) {
  return JSON.stringify(independentWorkspaceRef ? [executorId, "logical-workspace", directoryIdentity, independentWorkspaceRef] : [executorId, directoryIdentity]);
}
export async function executionGrant(ports: StewardPorts, tx: Prisma.TransactionClient, principal: ExecutionPrincipal, placement: WorkPlacement) {
  if (!ports.resolveExecutionPlacement) throw new CallError("unavailable", "Execution placements are not configured");
  const grant = await ports.resolveExecutionPlacement(principal, placement, tx);
  if (grant.executorId !== placement.executorId || grant.projectRef !== placement.projectRef || grant.mappingRevision !== placement.mappingRevision) throw new CallError("forbidden", "Execution placement does not match its grant");
  return grant;
}
/** Started-but-unconfirmed attempts keep capacity regardless of Run's terminal/lease/cancel label. */
export async function codingCapacity(tx: Prisma.TransactionClient, row: Attempt) {
  const occupied: Prisma.ExecutionAttemptWhereInput = { stopConfirmedAt: null, run: { startedAt: { not: null } } };
  const bucket = row.moduleId ? { moduleId: row.moduleId } : { moduleId: null, workspaceId: row.workspaceId, ownerId: row.ownerId };
  return await tx.executionAttempt.count({ where: occupied }) < KERNEL_EXECUTION_LIMITS.codingGlobal
    && await tx.executionAttempt.count({ where: { ...occupied, capacityKey: row.capacityKey } }) < KERNEL_EXECUTION_LIMITS.codingEnvironment
    && await tx.executionAttempt.count({ where: { ...occupied, ...bucket } }) < KERNEL_EXECUTION_LIMITS.codingApplication;
}
export async function codingGrant(ports: StewardPorts, tx: Prisma.TransactionClient, row: Attempt) {
  const principal = executionPrincipal(row);
  await assertExecutionPrincipal(tx, principal);
  if (!row.queueExpiresAt) return null; // v1 keeps its project resolver and server launch recheck.
  const grant = await executionGrant(ports, tx, principal, { executorId: row.executorId, projectRef: row.projectRef, mappingRevision: row.mappingRevision });
  if (executionDigest(grant) !== row.projectDigest || grant.directoryIdentity !== row.directoryIdentity || grant.executorGeneration !== row.executorGeneration) throw new CallError("conflict", "Execution grant changed while queued");
  if (row.baseline !== `${grant.baseline.kind}:${grant.baseline.digest}`) throw new CallError("conflict", "Execution baseline changed while queued");
  return grant;
}

async function activeQueuedCoding(tx: Prisma.TransactionClient, a: Attempt) {
  if (a.capabilityRevokedAt || a.cancelRequestedAt || a.stopConfirmedAt) return false;
  if (!a.run.sessionId || !await tx.session.count({ where: { id: a.run.sessionId, status: "active" } })) return false;
  return !(await tx.run.findUniqueOrThrow({ where: { id: a.runId }, select: { cancelRequestedAt: true } })).cancelRequestedAt;
}
export async function claimExecutionIn(ports: StewardPorts, tx: Prisma.TransactionClient, run: Prisma.RunGetPayload<{ include: { session: true } }>, now: Date, server?: ServerClaimPreparation | null) {
  const a = await tx.executionAttempt.findUniqueOrThrow({ where: { runId: run.id }, include: { run: true } });
  if (!await activeQueuedCoding(tx, a)) return null;
  if (a.queueExpiresAt && a.queueExpiresAt <= now) {
    await tx.executionAttempt.update({ where: { id: a.id }, data: { capabilityRevokedAt: now } });
    await tx.run.update({ where: { id: run.id }, data: { status: "timed_out", endedAt: now } });
    await finishExecution(ports, tx, run.id, "never_started", now);
    return null;
  }
  const grant = await codingGrant(ports, tx, a);
  const occupiedSession = await tx.run.count({ where: { sessionId: run.sessionId, OR: [{ status: "running" }, { startedAt: { not: null }, execution: { stopConfirmedAt: null } }] } });
  if (occupiedSession || !await codingCapacity(tx, a)) return null;
  if (!await verifyClaimWorkspace(tx, a, grant, server, now)) return null;
  const timeoutMs = (a.budget as { timeoutMs: number }).timeoutMs;
  const deadlineAt = new Date(now.getTime() + timeoutMs), token = randomBytes(32).toString("hex");
  if (!(await tx.run.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", tokenHash: createHash("sha256").update(token).digest("hex"), startedAt: now, deadlineAt, leaseUntil: deadlineAt } })).count) return null;
  const claimed = await tx.executionAttempt.findUniqueOrThrow({ where: { id: a.id }, include: { run: true } });
  await executionEventStore(ports).saveSnapshot(tx, executionPrincipal(a), await executionSnapshot(tx, claimed, now));
  await audit(tx, { workspaceId: run.workspaceId, actor: "chrona", kind: "run_claimed", subjectId: run.id, details: { lane: run.lane, executorId: a.executorId } });
  return { ...run, status: "running", startedAt: now, deadlineAt, leaseUntil: deadlineAt, token, runId: run.id };
}

async function verifyClaimWorkspace(tx: Prisma.TransactionClient, row: Attempt, grant: LocalExecutionProjectGrant | null, server: ServerClaimPreparation | null | undefined, now: Date) {
  if (grant?.executor !== "server") return true;
  if (!server || server.request.attemptId !== row.id) return false;
  assertServerClaim(row, grant, server, now);
  await tx.executionAttempt.update({ where: { id: row.id }, data: { sourceReceipt: server.prepared.sourceReceipt ?? Prisma.DbNull } });
  return true;
}
function assertServerClaim(row: Attempt, grant: LocalExecutionProjectGrant, server: ServerClaimPreparation, now: Date) {
  const current = serverClaimRequest(row, grant);
  if (row.requestDigest !== server.admissionDigest || executionDigest(current) !== executionDigest(server.request)) throw new CallError("conflict", "Queued server execution changed during verification");
  assertPreparedServerWorkspace(current, server.prepared, now);
  if (row.resolvedCwd !== server.prepared.cwd || row.run.cwd !== server.prepared.cwd || row.heldDirectory !== heldExecutionDirectory("server", server.prepared.workspaceDirectoryIdentity)) throw new CallError("conflict", "Server workspace directory reservation changed");
}
/** One authorized candidate only; the returned host lock spans the caller's final writer transaction. */
export async function prepareServerClaim(ports: StewardPorts, workspaceId: string, lane: RunLane, selection?: ExecutionClaimSelection): Promise<ServerClaimPreparation | null> {
  if (!ports.executionServerWorkspace || lane !== "background" || (selection?.kind === "ordinary" || selection?.kind === "application")) return null;
  if (selection?.kind === "execution" && selection.executorId !== "server") return null;
  const selected = await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const now = ports.now();
    const a = await tx.executionAttempt.findFirst({ where: { workspaceId, executorId: "server", targetBinding: { equals: Prisma.DbNull }, queueExpiresAt: { gt: now }, cancelRequestedAt: null, capabilityRevokedAt: null, stopConfirmedAt: null, run: { lane, status: "queued" } }, include: { run: true }, orderBy: [{ run: { createdAt: "asc" } }, { id: "asc" }] });
    if (!a || !await activeQueuedCoding(tx, a) || !await codingCapacity(tx, a)) return null;
    const grant = await codingGrant(ports, tx, a);
    if (!grant) return null;
    return { request: serverClaimRequest(a, grant), admissionDigest: a.requestDigest };
  });
  if (!selected) return null;
  return { ...selected, prepared: await prepareLocalWorkspace(ports, selected.request) };
}
