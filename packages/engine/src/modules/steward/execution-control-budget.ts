import type { Prisma } from "@chrona/db";
import { EXECUTOR_LIMITS as limits, executionJsonBytes } from "@chrona/contracts/steward";
import { CallError } from "./module-calls";
import { sourceAttemptCapacity, sourceReceiptCapacity } from "./execution-source-budget";

type Receipt = { attemptId: string; commandKey: string; operation: string; requestDigest: string; receipt: Prisma.InputJsonValue };
export function deviceCommandBytes(data: Receipt) {
  return executionJsonBytes({ attemptId: data.attemptId, commandKey: data.commandKey, operation: data.operation, requestDigest: data.requestDigest, receipt: data.receipt });
}
/** Caller already checked the original key under its writer lock; no command body is retained. */
export async function reserveDeviceCommandIn(tx: Prisma.TransactionClient, executorId: string, data: Receipt) {
  const cancel = data.operation === "cancel", bytes = deviceCommandBytes(data);
  const count = await tx.executionCommand.count({ where: { attemptId: data.attemptId } });
  if (count >= limits.controlReceipts - Number(!cancel) || bytes > 1024) throw new CallError("capacity", "Device command receipt capacity exhausted");
  const assignment = await tx.executorAssignment.findUnique({ where: { attemptId: data.attemptId } });
  if (assignment) {
    if (cancel) {
      if (assignment.receiptBytes + bytes > limits.receiptBytes) throw new CallError("capacity", "Device cancellation receipt capacity exhausted");
    } else sourceAttemptCapacity(assignment, bytes, false);
  }
  await sourceReceiptCapacity(tx, executorId, bytes, { emergencyCancel: cancel });
  if (assignment) await tx.executorAssignment.update({ where: { attemptId: data.attemptId }, data: { receiptBytes: { increment: bytes } } });
}
