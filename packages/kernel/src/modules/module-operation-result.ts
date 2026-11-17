import { Prisma } from "@chrona/db";
import { lifecycleOperationSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";

type Invocation = Prisma.ModuleInvocationGetPayload<object>;

/** Use the same completion evidence and result for approval callbacks and operation queries. */
export async function approvedOperationOutput(db: Prisma.TransactionClient, row: Invocation, approvalId: string | undefined) {
  const { moduleId, hash } = row.args as { moduleId: string; hash?: string };
  const identity = { operationId: row.id, moduleId, approvalId };
  if (row.tool === "remove") {
    const removed = await db.moduleRemoval.findFirst({ where: { workspaceId: row.workspaceId, moduleId } });
    if (removed) return lifecycleOperationSchema.parse({ ...identity, status: "done", result: { moduleId, status: "removed" } });
  }
  const module = await db.module.findFirst({ where: { id: moduleId, workspaceId: row.workspaceId } });
  if (row.tool === "rollback" && module?.status === "active" && module.activeHash === hash) {
    return lifecycleOperationSchema.parse({ ...identity, status: "done", result: { moduleId, status: module.status, activeHash: module.activeHash } });
  }
  if (module?.status === "migrating") return lifecycleOperationSchema.parse({ ...identity, status: "running" });
  return lifecycleOperationSchema.parse({ ...identity, status: "unknown", error: { code: "unknown", message: "Approval exists but completion evidence is missing" } });
}

/** Retain approval completion independently of submission receipts and later activations. */
export async function completeApprovedOperations(ports: StewardPorts, workspaceId: string, approvalId: string) {
  await ports.db.$transaction(tx => completeApprovedOperationsIn(tx, workspaceId, approvalId));
}

/** Called inside the activation transaction so later pause/version changes cannot erase completion. */
export async function completeApprovedOperationsIn(tx: Prisma.TransactionClient, workspaceId: string, approvalId: string) {
  const rows = await tx.moduleInvocation.findMany({ where: { workspaceId, targetIdentity: "system:modules", tool: { in: ["remove", "rollback"] }, status: "succeeded", operationOutput: { equals: Prisma.DbNull } } });
  for (const row of rows) {
    const parsed = lifecycleOperationSchema.safeParse(row.output);
    if (!parsed.success || parsed.data.approvalId !== approvalId) continue;
    const output = await approvedOperationOutput(tx, row, approvalId);
    if (output.status !== "done") continue;
    await tx.moduleInvocation.updateMany({ where: { id: row.id, operationOutput: { equals: Prisma.DbNull } }, data: { operationOutput: output } });
  }
}
