import type { Prisma } from "@chrona/db";
import { EXECUTOR_LIMITS as limits } from "@chrona/contracts/steward";
import { CallError } from "./module-calls";

// One last gap receipt remains possible when ordinary source metadata reaches its bound.
const gapHeadroom = 256, cancelHeadroom = 1024;
export async function sourceReceiptCapacity(tx: Prisma.TransactionClient, executorId: string, bytes: number, options: { gap?: boolean; additionalAssignment?: boolean; emergencyCancel?: boolean } = {}) {
  const active = { finalizedAt: null, tombstoneDigest: null };
  const all = await tx.executorAssignment.aggregate({ _sum: { receiptBytes: true } });
  const device = await tx.executorAssignment.aggregate({ where: { executorId }, _sum: { receiptBytes: true } });
  const pending = await tx.executorAssignment.count({ where: active });
  const local = await tx.executorAssignment.count({ where: { ...active, executorId } });
  const gaps = await tx.executorAssignment.count({ where: { ...active, receiptCount: { lt: limits.sourceReceipts } } });
  const localGaps = await tx.executorAssignment.count({ where: { ...active, executorId, receiptCount: { lt: limits.sourceReceipts } } });
  const reservations = (count: number, gapCount: number) => {
    const added = Number(options.additionalAssignment ?? false);
    return Math.max(0, (count + added) * cancelHeadroom + (gapCount + added) * gapHeadroom - (options.gap ? gapHeadroom : 0) - (options.emergencyCancel ? cancelHeadroom : 0));
  };
  const pendingGlobal = await unassignedDeviceCommandBytes(tx, null), pendingDevice = await unassignedDeviceCommandBytes(tx, executorId);
  if ((all._sum.receiptBytes ?? 0) + pendingGlobal + bytes + reservations(pending, gaps) > limits.globalReceiptBytes || (device._sum.receiptBytes ?? 0) + pendingDevice + bytes + reservations(local, localGaps) > limits.deviceReceiptBytes) throw new CallError("capacity", "Source receipt capacity exhausted");
}
export function sourceAttemptCapacity(row: { receiptCount: number; receiptBytes: number }, bytes: number, gap: boolean) {
  if (row.receiptCount >= limits.sourceReceipts - Number(!gap) || row.receiptBytes + bytes + cancelHeadroom + (gap ? 0 : gapHeadroom) > limits.receiptBytes) throw new CallError("capacity", "Source receipt capacity exhausted");
}

/** Commands for never-claimed devices have no assignment; count their retained bytes directly. */
export async function unassignedDeviceCommandBytes(tx: Prisma.TransactionClient, executorId: string | null) {
  const rows = await tx.$queryRaw<{ bytes: bigint | number }[]>`SELECT COALESCE(SUM(length(CAST(json_object('attemptId', c."attemptId", 'commandKey', c."commandKey", 'operation', c."operation", 'requestDigest', c."requestDigest", 'receipt', json(c."receipt")) AS BLOB))), 0) AS bytes FROM "ExecutionCommand" c JOIN "ExecutionAttempt" a ON a."id" = c."attemptId" LEFT JOIN "ExecutorAssignment" s ON s."attemptId" = a."id" WHERE a."executorId" <> 'server' AND s."attemptId" IS NULL AND (${executorId} IS NULL OR a."executorId" = ${executorId})`;
  return Number(rows[0]!.bytes);
}
