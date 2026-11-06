import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { EXECUTOR_LIMITS, type ExecutorFence, type ExecutorPrincipal, type ExecutorRequests, type ExecutorTarget, type ExecutorOwnerIncarnation } from "@chrona/contracts/steward";
import { CallError } from "./module-calls";
import type { StewardPorts } from "./ports";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
type Owner = { workspaceId: string; ownerId: string };
type AuthPorts = Pick<StewardPorts, "db" | "now">;
function credentialHash(credential: string) {
  if (!/^[a-f0-9]{64}$/.test(credential)) throw new CallError("forbidden", "Device credential rejected");
  return hash(credential);
}
async function lock(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`UPDATE "ExecutionExecutor" SET "id" = "id" WHERE 0`;
}
function principal(row: { id: string; workspaceId: string; ownerId: string }, fence: ExecutorFence, mode: ExecutorPrincipal["mode"]): ExecutorPrincipal {
  return { workspaceId: row.workspaceId, ownerId: row.ownerId, executorId: row.id, generation: fence.generation, incarnation: fence.incarnation, mode };
}

/** Hash-only device identity. R must recheck within its ingress writer transaction before effects. */
export function createExecutorAuth(ports: AuthPorts) {
  return {
    async createPairing(owner: Owner) {
      return ports.db.$transaction(async tx => {
        await lock(tx);
        if (await tx.executorPairing.count() >= EXECUTOR_LIMITS.pairingRecords) throw new CallError("capacity", "Pairing capacity reached");
        const now = ports.now(), code = randomBytes(32).toString("hex");
        const expiresAt = new Date(now.getTime() + EXECUTOR_LIMITS.pairMs);
        await tx.executorPairing.create({ data: { ...owner, codeHash: hash(code), expiresAt, receiptExpiresAt: new Date(now.getTime() + EXECUTOR_LIMITS.pairReceiptMs) } });
        return { code, expiresAt: expiresAt.toISOString() };
      });
    },
    async pair(credential: string, input: ExecutorRequests["pair"]) {
      const digest = credentialHash(credential);
      return ports.db.$transaction(async tx => {
        await lock(tx);
        const row = await tx.executorPairing.findUnique({ where: { codeHash: hash(input.code) }, include: { executor: true } });
        const now = ports.now();
        if (!row || row.receiptExpiresAt <= now) throw new CallError("forbidden", "Pairing rejected");
        if (row.consumedAt) {
          if (!row.credentialHash || !same(row.credentialHash, digest)) throw new CallError("conflict", "Pairing already consumed");
          if (!row.executor || row.executor.revokedAt) throw new CallError("forbidden", "Device revoked");
          return receipt(row.executor);
        }
        if (row.expiresAt <= now) throw new CallError("forbidden", "Pairing expired");
        if (await tx.executionExecutor.findUnique({ where: { credentialHash: digest } })) throw new CallError("conflict", "Credential already bound");
        if (await tx.executionExecutor.count() >= EXECUTOR_LIMITS.deviceRecords) throw new CallError("capacity", "Device capacity reached");
        const executor = await tx.executionExecutor.create({ data: { id: randomUUID(), workspaceId: row.workspaceId, ownerId: row.ownerId, label: input.label, credentialHash: digest } });
        await tx.executorPairing.update({ where: { codeHash: row.codeHash }, data: { executorId: executor.id, credentialHash: digest, consumedAt: now } });
        return receipt(executor);
      });
    },
    authenticateReconcile: (credential: string, fence: ExecutorFence) => authenticateReconcile(ports, credential, fence),
    async prepareIncarnation(owner: Owner, input: ExecutorOwnerIncarnation) {
      return ports.db.$transaction(async tx => {
        await lock(tx);
        const key = `executor-incarnation:${hash(JSON.stringify([owner.workspaceId, owner.ownerId, input.commandKey]))}`;
        const digest = hash(JSON.stringify([input.executorId, input.generation, input.expectedIncarnation, input.nextIncarnation]));
        const result = { executorId: input.executorId, generation: input.generation, incarnation: input.nextIncarnation, reconciled: false as const };
        const prior = await tx.audit.findUnique({ where: { id: key } });
        if (prior) {
          if ((prior.details as { digest?: string }).digest !== digest) throw new CallError("conflict", "Incarnation key already consumed");
          return result;
        }
        const row = await tx.executionExecutor.findFirst({ where: { id: input.executorId, ...owner } });
        if (!row || row.revokedAt || row.generation !== input.generation || row.incarnation !== input.expectedIncarnation || input.nextIncarnation === input.expectedIncarnation) throw new CallError("forbidden", "Incarnation transition rejected");
        const retired = (incarnation: string) => `executor-incarnation-retired:${hash(JSON.stringify([row.id, incarnation]))}`;
        if (await tx.audit.findUnique({ where: { id: retired(input.nextIncarnation) } })) throw new CallError("conflict", "Incarnation already retired");
        await tx.executionExecutor.update({ where: { id: row.id }, data: { incarnation: input.nextIncarnation, authorizedUntil: null, reconciledAt: null } });
        await tx.audit.create({ data: { id: retired(input.expectedIncarnation), workspaceId: owner.workspaceId, actorKey: owner.ownerId, kind: "executor_incarnation_retired", subjectId: row.id, details: {} } });
        await tx.audit.create({ data: { id: key, workspaceId: owner.workspaceId, actorKey: owner.ownerId, kind: "executor_incarnation", subjectId: row.id, details: { digest } } });
        return result;
      });
    },
    async authenticate(credential: string, fence: ExecutorFence, mode: "active" | "drain") {
      const digest = credentialHash(credential);
      return ports.db.$transaction(async tx => {
        await lock(tx);
        const row = await authenticatedRow(tx, digest, fence);
        if (!row.revokedAt && row.generation === fence.generation && row.incarnation === fence.incarnation) {
          if (row.reconciledAt) return principal(row, fence, "active");
          if (mode === "drain") return principal(row, fence, "recovery");
        }
        if (mode === "drain" && row.revokedAt) return drainPrincipal(tx, row, fence);
        throw new CallError("forbidden", "Device fence rejected");
      });
    },
    async revoke(owner: Owner, input: { executorId: string; generation: number; commandKey: string }) {
      return ports.db.$transaction(async tx => {
        await lock(tx);
        const key = `executor-revoke:${hash(JSON.stringify([owner.workspaceId, owner.ownerId, input.commandKey]))}`;
        const digest = hash(JSON.stringify([input.executorId, input.generation]));
        const prior = await tx.audit.findUnique({ where: { id: key } });
        if (prior) {
          if ((prior.details as { digest?: string }).digest !== digest) throw new CallError("conflict", "Revoke key already consumed");
          return { executorId: input.executorId, generation: input.generation + 1, revoked: true as const };
        }
        const row = await tx.executionExecutor.findFirst({ where: { id: input.executorId, ...owner } });
        if (!row || row.revokedAt || row.generation !== input.generation) throw new CallError("forbidden", "Device fence rejected");
        const now = ports.now();
        await tx.executionExecutor.update({ where: { id: row.id }, data: { generation: { increment: 1 }, revokedAt: now, authorizedUntil: null, reconciledAt: null } });
        await tx.executionAttempt.updateMany({ where: { ...owner, executorId: row.id, stopConfirmedAt: null, cancelRequestedAt: null }, data: { cancelRequestedAt: now } });
        await tx.executionAttempt.updateMany({ where: { ...owner, executorId: row.id, stopConfirmedAt: null, capabilityRevokedAt: null }, data: { capabilityRevokedAt: now } });
        await tx.audit.create({ data: { id: key, workspaceId: owner.workspaceId, actorKey: owner.ownerId, kind: "executor_revoke", subjectId: row.id, details: { digest } } });
        return { executorId: row.id, generation: row.generation + 1, revoked: true as const };
      });
    },
  };
}
async function authenticateReconcile(ports: AuthPorts, credential: string, fence: ExecutorFence) {
  const digest = credentialHash(credential);
  return ports.db.$transaction(async tx => {
    await lock(tx);
    const row = await authenticatedRow(tx, digest, fence);
    if (row.revokedAt) return drainPrincipal(tx, row, fence);
    if (row.generation !== fence.generation) throw new CallError("forbidden", "Device fence rejected");
    if (row.incarnation === null) {
      if (await tx.executorAssignment.count({ where: { executorId: row.id } })) throw new CallError("forbidden", "Owner incarnation transition required");
      await tx.executionExecutor.update({ where: { id: row.id }, data: { incarnation: fence.incarnation, authorizedUntil: null, reconciledAt: null } });
    } else if (row.incarnation !== fence.incarnation) throw new CallError("forbidden", "Owner incarnation transition required");
    return principal(row, fence, row.incarnation !== null && row.reconciledAt ? "active" : "recovery");
  });
}
async function authenticatedRow(tx: Prisma.TransactionClient, digest: string, fence: ExecutorFence) {
  const row = await tx.executionExecutor.findUnique({ where: { credentialHash: digest } });
  if (!row || !same(row.credentialHash, digest) || row.id !== fence.executorId) throw new CallError("forbidden", "Device identity rejected");
  return row;
}
async function drainPrincipal(tx: Prisma.TransactionClient, row: Awaited<ReturnType<typeof authenticatedRow>>, fence: ExecutorFence) {
  if (row.generation === fence.generation + 1 && row.incarnation === fence.incarnation) {
    const original = await tx.executorAssignment.findFirst({ where: { executorId: row.id, generation: fence.generation } });
    if (original) return principal(row, fence, "drain");
  }
  throw new CallError("forbidden", "Device drain rejected");
}
function receipt(row: { id: string; generation: number }) {
  return { executorId: row.id, generation: row.generation, heartbeatMs: EXECUTOR_LIMITS.heartbeatMs, graceMs: EXECUTOR_LIMITS.graceMs };
}

/** No JSON stop claim is promoted to VerifiedDeviceStop here. */
export async function assertExecutorTarget(tx: Prisma.TransactionClient, who: ExecutorPrincipal, target: ExecutorTarget, launchDigest?: string, recover = false) {
  if (target.generation !== who.generation) throw new CallError("forbidden", "Assignment generation rejected");
  const row = await tx.executorAssignment.findFirst({ where: {
    assignmentId: target.assignmentId, executorId: who.executorId, generation: who.generation, ...(recover ? {} : { incarnation: who.incarnation }),
    ...(launchDigest === undefined ? {} : { launchDigest }),
    attempt: { id: target.attemptId, workId: target.workId, runId: target.runId, workspaceId: who.workspaceId, ownerId: who.ownerId,
      executorId: who.executorId, executorGeneration: who.generation, run: { sessionId: target.sessionId } },
  }, include: { attempt: true } });
  if (!row) throw new CallError("forbidden", "Assignment rejected");
  return row;
}
async function assertCurrentFence(tx: Prisma.TransactionClient, who: ExecutorPrincipal) {
  const executor = await tx.executionExecutor.findFirst({ where: { id: who.executorId, workspaceId: who.workspaceId, ownerId: who.ownerId } });
  if (!executor) throw new CallError("forbidden", "Device identity rejected");
  if (executor.incarnation !== who.incarnation) throw new CallError("forbidden", "Device incarnation rejected");
  if (who.mode === "drain") {
    if (!executor.revokedAt || executor.generation !== who.generation + 1) throw new CallError("forbidden", "Device drain rejected");
  } else {
    if (executor.revokedAt || executor.generation !== who.generation || (who.mode === "active" && !executor.reconciledAt)) throw new CallError("forbidden", "Device fence rejected");
  }
}
function assertDrainEntry(entry: ExecutorRequests["reconcile"]["entries"][number], row: { sourceHighWatermark: number; finalDigest: string | null }) {
  if (entry.identity || entry.sourceAck > row.sourceHighWatermark || !["stopping", "unknown", "final"].includes(entry.phase)
    || (entry.finalDigest !== undefined && entry.finalDigest !== row.finalDigest)) throw new CallError("forbidden", "Drain reconciliation rejected");
}
export async function assertExecutorRequest(tx: Prisma.TransactionClient, who: ExecutorPrincipal, op: Exclude<keyof ExecutorRequests, "pair">, input: ExecutorRequests[typeof op]) {
  await assertCurrentFence(tx, who);
  if (who.mode !== "active" && op !== "final" && op !== "reconcile") throw new CallError("forbidden", "Recovery operation rejected");
  if ("target" in input) await assertExecutorTarget(tx, who, input.target);
  if ("final" in input) await assertExecutorTarget(tx, who, input.final, input.final.launchDigest, true);
  if ("entries" in input) {
    for (const entry of input.entries) {
      const known = await tx.executorAssignment.findUnique({ where: { assignmentId: entry.target.assignmentId }, select: { assignmentId: true } });
      if (!known) {
        if (who.mode === "drain") throw new CallError("forbidden", "Drain assignment rejected");
        continue; // Unknown recovery entries receive no authority, only an explicit unknown decision.
      }
      const row = await assertExecutorTarget(tx, who, entry.target, entry.launchDigest, true);
      if (who.mode === "drain" || row.incarnation !== who.incarnation) assertDrainEntry(entry, row);
    }
  }
}
