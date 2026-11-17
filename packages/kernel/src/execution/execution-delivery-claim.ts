import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { KERNEL_EXECUTION_LIMITS, type ExecutionLaunch } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { executionDigest, executionEventStore, executionPrincipal, executionRef, executionSnapshot, finishExecution } from "./execution-state";
import { receiverIn } from "./execution-delivery-records";
import { CallError } from "../modules/module-call-error";

/** K2: one writer transaction commits Run ownership and the complete immutable delivery. */
export async function claimApplicationExecutionIn(ports: StewardPorts, tx: Prisma.TransactionClient, run: Prisma.RunGetPayload<{ include: { session: true } }>, now: Date) {
  const a = await tx.executionAttempt.findUniqueOrThrow({ where: { runId: run.id }, include: { run: true } });
  if (!a.targetBinding || a.stopConfirmedAt || a.capabilityRevokedAt || a.cancelRequestedAt || run.status !== "queued" || run.session?.status !== "active") return null;
  if (a.queueExpiresAt && a.queueExpiresAt <= now) {
    await tx.run.update({ where: { id: run.id }, data: { status: "timed_out", endedAt: now } });
    await finishExecution(ports, tx, run.id, "never_started", now);
    return null;
  }
  const binding = a.targetBinding as { authorityId: string; target: ExecutionLaunch["target"] };
  const authority = await tx.executionAuthority.findUnique({ where: { id: binding.authorityId } });
  if (!authority || authority.revokedAt) return null;
  try {
    await receiverIn(tx, { workspaceId: a.workspaceId, moduleId: authority.receiverModuleId, hash: authority.receiverHash, activationId: authority.receiverActivationId }, true);
    if (a.moduleId && !await tx.module.count({ where: { id: a.moduleId, workspaceId: a.workspaceId, activeHash: a.callerHash, activationId: a.callerActivationId!, status: "active", executionFenceAt: null } })) return null;
  } catch (error) { if (error instanceof CallError) return null; throw error; }
  const occupied = { stopConfirmedAt: null, run: { startedAt: { not: null } } };
  if (await tx.executionAttempt.count({ where: occupied }) >= KERNEL_EXECUTION_LIMITS.codingGlobal || await tx.executionAttempt.count({ where: { ...occupied, capacityKey: a.capacityKey } }) >= KERNEL_EXECUTION_LIMITS.codingEnvironment || await tx.executionAttempt.count({ where: { ...occupied, ...(a.moduleId ? { moduleId: a.moduleId } : { workspaceId: a.workspaceId, ownerId: a.ownerId, moduleId: null }) } }) >= KERNEL_EXECUTION_LIMITS.codingApplication) return null;
  if (await tx.run.count({ where: { sessionId: run.sessionId, OR: [{ status: "running" }, { startedAt: { not: null }, execution: { stopConfirmedAt: null } }] } })) return null;
  const budget = a.budget as ExecutionLaunch["budget"], deadlineAt = new Date(now.getTime() + budget.timeoutMs), token = randomBytes(32).toString("hex");
  if (!(await tx.run.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", startedAt: now, deadlineAt, leaseUntil: deadlineAt, tokenHash: createHash("sha256").update(token).digest("hex") } })).count) return null;
  const deliveryId = randomUUID();
  const launch: ExecutionLaunch = { fence: { ...executionRef(a), workspaceId: a.workspaceId, ownerId: a.ownerId, deliveryId, callerModuleId: a.moduleId, callerHash: a.callerHash, callerActivationId: a.callerActivationId, receiverModuleId: authority.receiverModuleId, receiverHash: authority.receiverHash, receiverActivationId: authority.receiverActivationId, authorityId: authority.id, subjectId: authority.subjectId, epoch: authority.epoch, keyId: authority.keyId }, placement: a.placement as ExecutionLaunch["placement"], target: binding.target, workspaceRef: a.workspaceRef!, workspace: { mode: a.workspaceMode as "existing" | "independent_worktree", baseline: binding.target.baseline, ...(a.sourceManifest ? { source: a.sourceManifest as ExecutionLaunch["workspace"]["source"] } : {}) }, goal: run.prompt, budget, deadlineAt: deadlineAt.toISOString() };
  await tx.executionDelivery.create({ data: { id: deliveryId, attemptId: a.id, authorityId: authority.id, receiverModuleId: authority.receiverModuleId, receiverHash: authority.receiverHash, receiverActivationId: authority.receiverActivationId, launch, launchDigest: executionDigest(launch), createdAt: now } });
  const claimed = await tx.executionAttempt.findUniqueOrThrow({ where: { id: a.id }, include: { run: true } });
  await executionEventStore(ports).saveSnapshot(tx, executionPrincipal(a), await executionSnapshot(tx, claimed, now));
  return { ...run, status: "running", startedAt: now, deadlineAt, leaseUntil: deadlineAt, token, runId: run.id };
}
