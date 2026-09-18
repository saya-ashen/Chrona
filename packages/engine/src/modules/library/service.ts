import { randomUUID } from "node:crypto";
import { db, Prisma } from "@chrona/db";
import { withDatabaseTransaction } from "@chrona/db/db";
import { LIBRARY_LIMITS, libraryReadSchema, libraryWriteSchema, type LibraryWrite, type LibraryReceipt, type LibraryWriteResult } from "@chrona/contracts/library";
import type { z } from "zod";
import { stableJsonHash } from "../ai";
import { WorkResultError } from "../results/access";
import { authorizeLibrary, libraryRevision, type LibraryPorts, type LibraryActor } from "./access";
import { readLibrary } from "./read";
import { applyLibraryAction } from "./write";
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  try { if (Buffer.byteLength(JSON.stringify(raw)) > LIBRARY_LIMITS.requestBytes) throw new Error(); return schema.parse(raw); }
  catch { throw new WorkResultError("VALIDATION_ERROR", "Invalid or oversized library request"); }
}
async function transaction<T>(work: () => Promise<T>) {
  try { return await withDatabaseTransaction(work); }
  catch (error) {
    if (error instanceof WorkResultError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw new WorkResultError("REVISION_CONFLICT", "Library changed concurrently; read and reconcile");
    throw new WorkResultError("STORAGE_ERROR", "Library operation could not be completed");
  }
}
async function command(actor: LibraryActor, input: LibraryWrite): Promise<LibraryWriteResult> {
  const payloadHash = stableJsonHash(input).slice("sha256:".length);
  const old = await db.libraryCommand.findUnique({ where: { workspaceId_actorKey_requestId: { workspaceId: actor.workspaceId, actorKey: actor.actorKey, requestId: input.requestId } } });
  if (old) {
    if (old.payloadHash !== payloadHash) throw new WorkResultError("IDEMPOTENCY_CONFLICT", "Request ID is already bound to different arguments");
    return { replayed: true, receipt: old.receipt as unknown as LibraryReceipt };
  }
  const state = await db.libraryState.findUnique({ where: { workspaceId: actor.workspaceId } });
  const revision = state?.revision ?? 0;
  if (input.expectedRevision !== libraryRevision(actor.workspaceId, revision)) throw new WorkResultError("REVISION_CONFLICT", "Library changed; read, compare and reconcile before saving");
  if (await db.libraryCommand.count({ where: { workspaceId: actor.workspaceId } }) >= LIBRARY_LIMITS.commands) throw new WorkResultError("PRECONDITION_FAILED", "Library receipt storage limit reached");
  if (!state) await db.libraryState.create({ data: { workspaceId: actor.workspaceId } });
  const changes = await applyLibraryAction(actor, input.action);
  const changed = await db.libraryState.updateMany({ where: { workspaceId: actor.workspaceId, revision }, data: { revision: revision + 1 } });
  if (changed.count !== 1) throw new WorkResultError("REVISION_CONFLICT", "Library changed concurrently");
  const receipt: LibraryReceipt = { commandId: randomUUID(), revision: libraryRevision(actor.workspaceId, revision + 1), taskId: input.action.type === "assign" ? input.action.taskId : null,
    actorKey: actor.actorKey, recordedAt: new Date().toISOString(), changes, contentChanged: false, executionStarted: false };
  await db.libraryCommand.create({ data: { id: receipt.commandId, workspaceId: actor.workspaceId, actorKey: actor.actorKey, requestId: input.requestId, payloadHash, taskId: receipt.taskId, receipt: JSON.parse(JSON.stringify(receipt)) as Prisma.InputJsonValue } });
  return { replayed: false, receipt };
}
export function createLibraryService(ports: LibraryPorts) {
  return {
    read(raw: unknown) { const input = parse(libraryReadSchema, raw); return transaction(async () => readLibrary(await authorizeLibrary(ports, "read"), input)); },
    write(raw: unknown) {
      const input = parse(libraryWriteSchema, raw);
      const permission = input.action.type === "assign" || input.action.type === "folder_create" ? "organize" : "configure";
      return transaction(async () => command(await authorizeLibrary(ports, permission), input));
    },
  };
}
