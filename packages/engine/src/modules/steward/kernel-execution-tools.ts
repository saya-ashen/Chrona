import { kernelExecutionStartSchema, kernelCleanupInputSchema, kernelCleanupReceiptSchema, type ExecutionPrincipal, type KernelExecutionStart, type KernelLocation, type KernelCleanupInput, type KernelPlacementView } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { createExecutionDelivery } from "./execution-delivery";
import { createExecutionV2Admission, executionPlacementIn } from "./execution-admission";
import { assertExecutionPrincipal } from "./execution-principal";
import { executionCallerKey, executionScope, executionDigest } from "./execution-state";
import { kernelPlacementView } from "./execution-delivery-store";
import { receiptIn, replayIn, deliveryInclude, receiverIn } from "./execution-delivery-records";
import { handleExecutionV2Tool } from "./execution-v2-tools";
import { CallError } from "./module-call-error";

async function attemptIn(tx: Prisma.TransactionClient, p: ExecutionPrincipal, workId: string) {
  await assertExecutionPrincipal(tx, p);
  const row = await tx.executionAttempt.findFirst({ where: { ...executionScope(p), callerKey: executionCallerKey(p), workId }, include: { run: true } });
  if (!row) throw new CallError("not_found", "Execution not found");
  return row;
}
export async function startKernelExecution(ports: StewardPorts, p: ExecutionPrincipal, raw: KernelExecutionStart) {
  const input = kernelExecutionStartSchema.parse(raw);
  if (input.placement.kind === "application") return createExecutionDelivery(ports).admit(p, input);
  // The private host workspace adapter retains its filesystem preparation/verification transaction.
  const result = await createExecutionV2Admission(ports).start(p, { ...input, placement: { executorId: "server", projectRef: input.placement.projectRef, mappingRevision: input.placement.mappingRevision }, budget: input.budget });
  return { execution: result.execution, placement: { ...result.placement, placement: input.placement, workspace: { workspaceRef: result.placement.workspace.workspaceRef, mode: result.placement.workspace.mode, baseline: result.placement.workspace.baseline, state: result.placement.workspace.state === "ready" ? "ready" : result.execution.stopConfirmed ? "retained" : result.execution.status === "unknown" ? "unknown" : "requested", retained: true } } };
}
export async function kernelExecutionPlacement(ports: StewardPorts, p: ExecutionPrincipal, workId: string): Promise<KernelPlacementView> {
  return ports.db.$transaction(async tx => {
    const a = await attemptIn(tx, p, workId);
    if (a.targetBinding) return kernelPlacementView(a);
    const old = await executionPlacementIn(tx, a, true);
    return { ...old, placement: { kind: "local", projectRef: a.projectRef, mappingRevision: a.mappingRevision }, workspace: { workspaceRef: old.workspace.workspaceRef, mode: old.workspace.mode, baseline: old.workspace.baseline, state: old.workspace.state === "ready" ? "ready" : a.stopConfirmedAt ? "retained" : a.capabilityRevokedAt ? "unknown" : "requested", retained: true } };
  });
}
export async function kernelExecutionLocations(ports: StewardPorts, p: ExecutionPrincipal, input: { after?: string; limit: number }) {
  return ports.db.$transaction(async tx => {
    await assertExecutionPrincipal(tx, p);
    const locations: KernelLocation[] = [];
    for (const selected of await ports.executionLocations?.(p, tx) ?? []) {
      if (selected.executorId !== "server") continue;
      const grant = await ports.resolveExecutionPlacement?.(p, selected, tx);
      if (grant?.executor !== "server") continue;
      locations.push({ placement: { kind: "local", projectRef: selected.projectRef, mappingRevision: selected.mappingRevision }, label: grant.label, online: true, baseline: grant.baseline, workspaceModes: grant.baseline.kind === "commit" ? ["existing", "independent_worktree"] : ["existing"] });
    }
    const authorities = await tx.executionAuthority.findMany({ where: { workspaceId: p.workspaceId, ownerId: p.ownerId, revokedAt: null } });
    for (const authority of authorities) {
      const scope = authority.scope as import("@chrona/contracts/steward").ExecutionAuthorityApproval["scope"];
      if (p.caller.kind === "module" && !scope.callerModuleIds.includes(p.caller.moduleId)) continue;
      let online = true;
      try { await receiverIn(tx, { workspaceId: p.workspaceId, moduleId: authority.receiverModuleId, hash: authority.receiverHash, activationId: authority.receiverActivationId }, true); } catch (e) { if (!(e instanceof CallError)) throw e; online = false; }
      for (const target of scope.targets) locations.push({ placement: { kind: "application", applicationId: authority.receiverModuleId, targetRef: target.targetRef, targetRevision: target.targetRevision, projectRef: target.projectRef }, label: target.targetRef, online, baseline: target.baseline, workspaceModes: target.workspaceModes });
    }
    const sorted = [...new Map(locations.map(item => [executionDigest(item.placement), item])).entries()].sort(([a], [b]) => a.localeCompare(b));
    const offset = input.after ? sorted.findIndex(([key]) => key === input.after) : -1;
    if (input.after && offset === -1) throw new CallError("not_found", "Execution location cursor changed");
    const page = sorted.slice(offset + 1, offset + 1 + input.limit);
    return { locations: page.map(([, item]) => item), after: sorted.length > offset + 1 + page.length ? page.at(-1)![0] : null };
  });
}
export async function kernelExecutionCleanup(ports: StewardPorts, p: ExecutionPrincipal, raw: KernelCleanupInput) {
  const input = kernelCleanupInputSchema.parse(raw);
  const initial = await ports.db.$transaction(tx => attemptIn(tx, p, input.workId));
  if (!initial.targetBinding) return handleExecutionV2Tool(ports, p, "workspace-cleanup", { workId: input.workId, commandKey: input.commandKey, action: input.op, ...(input.op === "confirm" ? { previewDigest: input.previewDigest } : {}) });
  return ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${p.workspaceId}`;
    const a = await attemptIn(tx, p, input.workId);
    if (!a.stopConfirmedAt || a.heldDirectory || a.workspaceMode !== "independent_worktree") throw new CallError("conflict", "Cleanup requires a stopped independent workspace");
    const row = await tx.executionDelivery.findUniqueOrThrow({ where: { attemptId: a.id }, include: deliveryInclude });
    const prior = await replayIn(tx, row, "cleanup", input.commandKey, input);
    const report = await tx.executionReceipt.findFirst({ where: { deliveryId: row.id, operation: "cleanup-report", payload: { path: "$.controlKey", equals: input.commandKey } } });
    if (prior) return report?.receipt ?? prior.receipt;
    // Cleanup is a drain operation for an already stopped workspace. The exact
    // original active receiver may be fenced against new launches.
    const receiver = await receiverIn(tx, { workspaceId: p.workspaceId, moduleId: row.receiverModuleId, hash: row.receiverHash, activationId: row.receiverActivationId }, false);
    if (receiver.status !== "active") throw new CallError("conflict", "Cleanup requires the original execution receiver to be active");
    if (input.op === "confirm") {
      const preview = await tx.executionReceipt.findFirst({ where: { deliveryId: row.id, operation: "cleanup-report", receipt: { path: "$.previewDigest", equals: input.previewDigest } } });
      const previewCommand = preview ? await tx.executionReceipt.findUnique({ where: { deliveryId_operation_requestKey: { deliveryId: row.id, operation: "cleanup", requestKey: (preview.payload as { controlKey: string }).controlKey } } }) : null;
      if (!preview || (previewCommand?.payload as { op?: string } | null)?.op !== "preview" || (preview.receipt as { state?: string }).state !== "retained") throw new CallError("conflict", "Cleanup preview is missing or changed");
    }
    const receipt = kernelCleanupReceiptSchema.parse({ workId: a.workId, workspaceRef: a.workspaceRef, state: "pending", reason: "Awaiting execution application's workspace receipt", previewDigest: input.op === "confirm" ? input.previewDigest : null, operationKey: input.commandKey });
    await receiptIn(tx, row, "cleanup", input.commandKey, input, receipt, ports.now(), "outbound");
    return receipt;
  });
}
