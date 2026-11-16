import type { Prisma } from "@chrona/db";
import { executionReceiverSchema, type ExecutionReceiver, type ExecutionLaunch, type ExecutionDeliveryTarget } from "@chrona/contracts/steward";
import { executionDigest } from "./execution-delivery-digest";
import { CallError } from "../modules/module-call-error";

export type DeliveryRow = Prisma.ExecutionDeliveryGetPayload<{ include: { authority: true; attempt: { include: { run: true } } } }>;
export const deliveryInclude = { authority: true, attempt: { include: { run: true } } } as const;
export const json = (value: unknown) => value as Prisma.InputJsonValue;
export const capacitySubject = (workspaceId: string, ownerId: string, subjectId: string) => JSON.stringify([workspaceId, ownerId, subjectId]);
export async function receiverIn(tx: Prisma.TransactionClient, raw: ExecutionReceiver, live: boolean) {
  const who = executionReceiverSchema.parse(raw);
  const row = await tx.module.findFirst({ where: { id: who.moduleId, workspaceId: who.workspaceId, activeHash: who.hash, activationId: who.activationId, ...(live ? { status: "active", executionFenceAt: null } : {}) } });
  if (!row) throw new CallError("forbidden", "Execution receiver activation changed");
  return row;
}
export function targetOf(row: DeliveryRow): ExecutionDeliveryTarget { return { ...(row.launch as unknown as ExecutionLaunch).fence, launchDigest: row.launchDigest }; }
export async function deliveryIn(tx: Prisma.TransactionClient, who: ExecutionReceiver, target: ExecutionDeliveryTarget, live = false): Promise<DeliveryRow> {
  await receiverIn(tx, who, live);
  const row = await tx.executionDelivery.findUnique({ where: { id: target.deliveryId }, include: deliveryInclude });
  if (!row || row.attempt.workspaceId !== who.workspaceId || row.receiverModuleId !== who.moduleId || row.receiverHash !== who.hash || row.receiverActivationId !== who.activationId) throw new CallError("forbidden", "Execution delivery receiver denied");
  if (executionDigest(targetOf(row)) !== executionDigest(target)) throw new CallError("conflict", "Execution delivery fence changed");
  return row;
}
export async function liveDeliveryIn(tx: Prisma.TransactionClient, row: DeliveryRow, now: Date) {
  if (row.authority.revokedAt || row.attempt.capabilityRevokedAt || row.attempt.cancelRequestedAt || row.attempt.stopConfirmedAt || row.finalDigest || row.attempt.run.status !== "running" || !row.attempt.run.deadlineAt || row.attempt.run.deadlineAt <= now) throw new CallError("conflict", "Execution capabilities are revoked or expired");
  await receiverIn(tx, { workspaceId: row.attempt.workspaceId, moduleId: row.receiverModuleId, hash: row.receiverHash, activationId: row.receiverActivationId }, true);
  const a = row.attempt;
  if (a.moduleId) {
    const caller = await tx.module.findFirst({ where: { id: a.moduleId, workspaceId: a.workspaceId, activeHash: a.callerHash, activationId: a.callerActivationId!, status: "active", executionFenceAt: null } });
    if (!caller) throw new CallError("forbidden", "Execution caller activation changed");
  }
}
export async function replayIn(tx: Prisma.TransactionClient, row: DeliveryRow, operation: string, requestKey: string, payload: unknown) {
  const prior = await tx.executionReceipt.findUnique({ where: { deliveryId_operation_requestKey: { deliveryId: row.id, operation, requestKey } } });
  if (prior && prior.requestDigest !== executionDigest(payload)) throw new CallError("conflict", "Execution receipt key contains different content");
  return prior;
}
export async function receiptIn(tx: Prisma.TransactionClient, row: DeliveryRow, operation: string, requestKey: string, payload: unknown, receipt: unknown, now: Date, direction = "inbound") {
  const bytes = Buffer.byteLength(JSON.stringify({ operation, requestKey, payload, receipt }));
  const own = await tx.executionReceipt.aggregate({ where: { deliveryId: row.id }, _sum: { bytes: true }, _count: true });
  const global = await tx.executionReceipt.aggregate({ _sum: { bytes: true } });
  const reserve = ["final", "stop", "control", "ack"].includes(operation) ? 65_536 : 0;
  if (bytes > 262_144 || own._count >= (reserve ? 10_000 : 9_900) || (own._sum.bytes ?? 0) + bytes > 10 * 1024 * 1024 + reserve || (global._sum.bytes ?? 0) + bytes > 256 * 1024 * 1024 + reserve) throw new CallError("capacity", "Execution receipt storage limit exceeded");
  return tx.executionReceipt.create({ data: { deliveryId: row.id, operation, requestKey, requestDigest: executionDigest(payload), payload: json(payload), receipt: json(receipt), bytes, direction, createdAt: now } });
}
export async function replaceReceiptIn(tx: Prisma.TransactionClient, row: DeliveryRow, original: Prisma.ExecutionReceiptGetPayload<object>, receipt: unknown) {
  const bytes = Buffer.byteLength(JSON.stringify({ operation: original.operation, requestKey: original.requestKey, payload: original.payload, receipt }));
  const own = await tx.executionReceipt.aggregate({ where: { deliveryId: row.id }, _sum: { bytes: true } });
  const global = await tx.executionReceipt.aggregate({ _sum: { bytes: true } });
  const delta = bytes - original.bytes;
  if (bytes > 262_144 || (own._sum.bytes ?? 0) + delta > 10 * 1024 * 1024 || (global._sum.bytes ?? 0) + delta > 256 * 1024 * 1024) throw new CallError("capacity", "Execution receipt storage limit exceeded");
  return tx.executionReceipt.update({ where: { id: original.id }, data: { receipt: json(receipt), bytes } });
}
