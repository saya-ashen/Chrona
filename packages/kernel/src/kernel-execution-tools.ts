import { kernelCleanupInputSchema, kernelCleanupReceiptSchema, type ExecutionPrincipal, type KernelCleanupInput } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { assertExecutionPrincipal } from "./execution/execution-principal";
import { executionCallerKey, executionScope } from "./execution/execution-state";
import { receiptIn, replayIn, deliveryInclude, receiverIn } from "./execution/execution-delivery-records";
import { handleExecutionV2Tool } from "./execution/execution-v2-tools";
import { CallError } from "./modules/module-call-error";

async function attemptIn(tx: Prisma.TransactionClient, p: ExecutionPrincipal, workId: string) {
  await assertExecutionPrincipal(tx, p);
  const row = await tx.executionAttempt.findFirst({ where: { ...executionScope(p), callerKey: executionCallerKey(p), workId }, include: { run: true } });
  if (!row) throw new CallError("not_found", "Execution not found");
  return row;
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
