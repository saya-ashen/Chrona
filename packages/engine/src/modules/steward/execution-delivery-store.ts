import { executionAuthorityApprovalSchema, applicationExecutionStartSchema, type ExecutionAuthorityApproval, type ExecutionPrincipal, type KernelExecutionStart, type KernelPlacementView } from "@chrona/contracts/steward";
import { createPublicKey, randomUUID } from "node:crypto";
import type { StewardPorts } from "./ports";
import { assertExecutionPrincipal } from "./execution-principal";
import { executionCallerKey, executionDigest, executionEventStore, executionRef, executionView, executionBaseline } from "./execution-state";
import { createRunSession, enqueueExecutionRunIn } from "./runs";
import { CallError } from "./module-call-error";
import { receiverIn, capacitySubject, type DeliveryRow } from "./execution-delivery-records";
export async function approveExecutionAuthority(ports: StewardPorts, principal: ExecutionPrincipal, raw: ExecutionAuthorityApproval) {
  if (principal.caller.kind !== "owner") throw new CallError("forbidden", "Only the host owner approves execution authority");
  const input = executionAuthorityApprovalSchema.parse(raw);
  if (input.receiver.workspaceId !== principal.workspaceId) throw new CallError("forbidden", "Execution authority workspace mismatch");
  try { if (createPublicKey(input.publicKey).asymmetricKeyType !== "ed25519") throw Error(); } catch { throw new CallError("invalid", "Execution stop key must be Ed25519"); }
  return ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
    await receiverIn(tx, input.receiver, true);
    const previous = await tx.executionAuthority.findFirst({ where: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, subjectId: input.subjectId }, orderBy: { epoch: "desc" } });
    if (previous && input.epoch <= previous.epoch) throw new CallError("conflict", "Authority epochs must increase for the stable subject");
    await tx.executionAuthority.updateMany({ where: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, subjectId: input.subjectId, revokedAt: null }, data: { revokedAt: ports.now() } });
    return tx.executionAuthority.create({ data: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, receiverModuleId: input.receiver.moduleId, receiverHash: input.receiver.hash, receiverActivationId: input.receiver.activationId, subjectId: input.subjectId, epoch: input.epoch, keyId: input.keyId, publicKey: input.publicKey, verifierId: input.verifierId, verifierVersion: input.verifierVersion, scope: input.scope, approvalId: input.approvalId, approvedAt: ports.now() } });
  });
}
export function kernelPlacementView(a: DeliveryRow["attempt"]): KernelPlacementView {
  return { ...executionRef(a), placement: a.placement as KernelPlacementView["placement"], queueExpiresAt: a.queueExpiresAt!.toISOString(), online: !a.capabilityRevokedAt,
    workspace: { workspaceRef: a.workspaceRef!, mode: a.workspaceMode as "existing" | "independent_worktree", baseline: executionBaseline(a.baseline), retained: true, state: a.stopConfirmedAt ? "retained" : a.capabilityRevokedAt ? "unknown" : a.run.startedAt ? "ready" : "requested" } };
}
export async function admitApplicationExecution(ports: StewardPorts, principal: ExecutionPrincipal, raw: KernelExecutionStart) {
  const input = applicationExecutionStartSchema.parse(raw);
  if (input.placement.kind !== "application") throw new CallError("unsupported", "Local execution uses the host workspace admission port");
  const placement = input.placement;
  const admitted = await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
    const old = await tx.executionAttempt.findUnique({ where: { workspaceId_ownerId_callerKey_commandKey: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey: executionCallerKey(principal), commandKey: input.commandKey } }, include: { run: true } });
    if (old) {
      if (old.requestDigest !== executionDigest(input) || (principal.caller.kind === "module" && old.callerHash !== principal.caller.hash)) throw new CallError("conflict", "Execution start key changed");
      return { row: old, created: false };
    }
    await assertExecutionPrincipal(tx, principal);
    const caller = principal.caller.kind === "module" ? await tx.module.findUniqueOrThrow({ where: { id: principal.caller.moduleId } }) : null;
    if (caller?.executionFenceAt) throw new CallError("forbidden", "Execution caller is draining");
    const now = ports.now(), expires = new Date(input.queueExpiresAt);
    if (expires <= now || expires.getTime() > now.getTime() + 86_400_000) throw new CallError("invalid", "Execution queue expiry must be within one day");
    const authorities = await tx.executionAuthority.findMany({ where: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, receiverModuleId: placement.applicationId, revokedAt: null }, orderBy: { epoch: "desc" } });
    const candidates = authorities.flatMap(authority => {
      const scope = authority.scope as ExecutionAuthorityApproval["scope"];
      if (caller && !scope.callerModuleIds.includes(caller.id)) return [];
      const target = scope.targets.find(t => t.targetRef === placement.targetRef && t.targetRevision === placement.targetRevision && t.projectRef === placement.projectRef);
      return target ? [{ authority, target }] : [];
    });
    if (candidates.length !== 1) throw new CallError("forbidden", "Execution target requires exactly one approved authority");
    const { authority, target } = candidates[0]!;
    await receiverIn(tx, { workspaceId: principal.workspaceId, moduleId: authority.receiverModuleId, hash: authority.receiverHash, activationId: authority.receiverActivationId }, true);
    if (executionDigest(target.baseline) !== executionDigest(input.workspace.baseline) || !target.workspaceModes.includes(input.workspace.mode)) throw new CallError("forbidden", "Execution workspace exceeds approved scope");
    if (await tx.executionAttempt.count({ where: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey: executionCallerKey(principal), workId: input.workId } })) throw new CallError("conflict", "Execution work already exists");
    const capacityKey = capacitySubject(principal.workspaceId, principal.ownerId, authority.subjectId), workspaceRef = randomUUID();
    const heldDirectory = JSON.stringify([capacityKey, target.directoryIdentity, ...(input.workspace.mode === "independent_worktree" ? [workspaceRef] : [])]);
    if (await tx.executionAttempt.count({ where: { heldDirectory } })) throw new CallError("conflict", "Execution directory is occupied");
    const session = await createRunSession(tx, principal.workspaceId, "module", now, caller ? { moduleId: caller.id } : {});
    const run = await enqueueExecutionRunIn(ports, tx, { workspaceId: principal.workspaceId, sessionId: session.id, prompt: input.goal, cwd: "", now });
    const row = await tx.executionAttempt.create({ data: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey: executionCallerKey(principal), moduleId: caller?.id, callerHash: caller?.activeHash, callerActivationId: caller?.activationId, placement: input.placement, targetBinding: { authorityId: authority.id, target }, capacityKey, workId: input.workId, commandKey: input.commandKey, requestDigest: executionDigest(input), runId: run.id, projectRef: placement.projectRef, projectDigest: executionDigest(target), directoryIdentity: target.directoryIdentity, queueExpiresAt: expires, workspaceRef, workspaceMode: input.workspace.mode, sourceManifest: input.workspace.source, resolvedCwd: null, logDir: "", baseline: `${target.baseline.kind}:${target.baseline.digest}`, budget: input.budget, heldDirectory }, include: { run: true } });
    await executionEventStore(ports).admit(tx, principal, executionRef(row));
    await executionEventStore(ports).control(tx, principal, executionRef(row), { slot: "admission", at: now.toISOString(), status: "confirmed" });
    return { row, created: true };
  });
  if (admitted.created) void ports.onQueued?.().catch(error => console.error("Execution queue wake failed", error instanceof Error ? error.name : "unknown"));
  return { execution: executionView(admitted.row), placement: kernelPlacementView(admitted.row) };
}
