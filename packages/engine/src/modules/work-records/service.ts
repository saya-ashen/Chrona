import { Prisma, db } from "@chrona/db";
import { withDatabaseTransaction } from "@chrona/db/db";
import { stableJsonHash } from "../ai";
import { withCommandActor } from "../events";
import { workCaptureSchema, workReadSchema, workSearchSchema, workUpdateSchema, WORK_REQUEST_BYTES, type WorkReceipt } from "@chrona/contracts/work";
import type { z } from "zod";
import { WorkResultError } from "../results/access";
import { authorized, type WorkPorts, type WorkActor } from "./access";
import { readWork, searchWork } from "./read";
import { captureWork, updateWork, json } from "./write";

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  try {
    if (Buffer.byteLength(JSON.stringify(raw)) > WORK_REQUEST_BYTES) throw new Error();
    return schema.parse(raw);
  } catch { throw new WorkResultError("VALIDATION_ERROR", "Invalid or oversized work-record request"); }
}
async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await withDatabaseTransaction(async () => {
      const result = await fn();
      if (Buffer.byteLength(JSON.stringify(result)) > 128 * 1024) throw new WorkResultError("PRECONDITION_FAILED", "Work response exceeds its budget");
      return result;
    });
  } catch (error) {
    if (error instanceof WorkResultError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw new WorkResultError("REVISION_CONFLICT", "Concurrent work change; read and reconcile");
    throw new WorkResultError("STORAGE_ERROR", "Work-record operation could not be completed");
  }
}
async function command(actor: WorkActor, operation: string, input: { requestId: string }, run: () => Promise<WorkReceipt["receipt"]>): Promise<WorkReceipt> {
  const payloadHash = stableJsonHash(input);
  const existing = await db.workCommand.findUnique({ where: { workspaceId_actorKey_operation_requestId: { workspaceId: actor.workspaceId, actorKey: actor.actorKey, operation, requestId: input.requestId } } });
  if (existing) {
    if (existing.payloadHash !== payloadHash) throw new WorkResultError("IDEMPOTENCY_CONFLICT", "Request ID is already bound to different arguments");
    return { replayed: true, receipt: existing.receipt as unknown as WorkReceipt["receipt"] };
  }
  if (await db.workCommand.count({ where: { workspaceId: actor.workspaceId } }) >= 10000) throw new WorkResultError("PRECONDITION_FAILED", "Work command limit reached");
  const receipt = await withCommandActor({ actorType: actor.actorKey.startsWith("external:") ? "agent" : "user", actorId: actor.actorKey, source: "work_record", correlationId: input.requestId }, run);
  await db.workCommand.create({ data: { taskId: receipt.taskId, workspaceId: actor.workspaceId, actorKey: actor.actorKey, operation, requestId: input.requestId, payloadHash, receipt: json(receipt) } });
  return { replayed: false, receipt };
}
export function createWorkRecordsService(ports: WorkPorts) {
  return {
    search(raw: unknown) { const input = parse(workSearchSchema, raw); return transaction(async () => searchWork(await authorized(ports, false), input)); },
    read(raw: unknown) { const input = parse(workReadSchema, raw); return transaction(async () => readWork(await authorized(ports, false), input)); },
    capture(raw: unknown) { const input = parse(workCaptureSchema, raw); return transaction(async () => { const actor = await authorized(ports, true); return command(actor, "capture", input, () => captureWork(actor, input)); }); },
    update(raw: unknown) { const input = parse(workUpdateSchema, raw); return transaction(async () => { const actor = await authorized(ports, true); return command(actor, "update", input, () => updateWork(actor, input)); }); },
  };
}
export type WorkRecordsService = ReturnType<typeof createWorkRecordsService>;
