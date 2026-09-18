import { randomUUID } from "node:crypto";
import { db, type ResultFileUpload } from "@chrona/db";
import { RESULT_FILE_CHUNK_BYTES, RESULT_UPLOAD_TTL_MS, RESULT_WORKSPACE_FILE_BYTES, RESULT_WORKSPACE_UPLOADS, type ResultFileAction, type ResultUploadStatus } from "@chrona/contracts/results";
import { workResultRevision, workResultScopeKey } from "@chrona/domain/task/work-results";
import { resultActorKey, WorkResultError, type ResultPrincipal, type ResultScope } from "./access";
import { aiArtifactRef } from "./artifact-ref";
import { findWorkResult } from "./commands";
import { resultPayloadHash } from "./content-hash";
import { resultFileAvailable } from "./file-storage";

export async function uploadStatus(upload: ResultFileUpload): Promise<ResultUploadStatus> {
  const result = await db.taskResult.findUniqueOrThrow({ where: { id: upload.resultId } });
  return { uploadId: upload.id, resultId: result.id, editRevision: workResultRevision(result), status: upload.status as ResultUploadStatus["status"],
    receivedBytes: upload.receivedBytes, sizeBytes: upload.sizeBytes, filename: upload.filename, mimeType: upload.mimeType, sha256: upload.sha256,
    expiresAt: upload.expiresAt.toISOString(), chunkBytes: RESULT_FILE_CHUNK_BYTES, artifactRef: upload.finalArtifactId ? aiArtifactRef(upload.finalArtifactId) : null,
    artifactAvailable: upload.finalArtifactId ? await resultFileAvailable(upload.finalArtifactId, upload) : false };
}
export async function closeUpload(upload: ResultFileUpload, status: "cancelled" | "expired") {
  if (upload.status !== "open") return upload;
  const updated = await db.resultFileUpload.update({ where: { id: upload.id }, data: { status } });
  await db.resultFileChunk.deleteMany({ where: { uploadId: upload.id } });
  return updated;
}
export async function ownedUpload(principal: ResultPrincipal, scope: ResultScope, id: string) {
  const upload = await db.resultFileUpload.findFirst({ where: { id, workspaceId: principal.workspaceId, ...scope, actorKey: resultActorKey(principal) } });
  if (!upload) throw new WorkResultError("NOT_FOUND", "Upload not found in this scope");
  return upload.status === "open" && upload.expiresAt <= new Date() ? closeUpload(upload, "expired") : upload;
}
async function reserveWorkspaceBytes(workspaceId: string, sizeBytes: number) {
  // Bounded by the receipt cap. Terminal receipts survive cleanup so IDs never acquire new meaning.
  const expired = await db.resultFileUpload.findMany({ where: { workspaceId, status: "open", expiresAt: { lte: new Date() } }, take: RESULT_WORKSPACE_UPLOADS });
  for (const upload of expired) await closeUpload(upload, "expired");
  const pending = await db.resultFileUpload.aggregate({ where: { workspaceId, status: "open" }, _sum: { sizeBytes: true } });
  const stored = await db.resultArtifactBytes.aggregate({ where: { artifact: { workspaceId } }, _sum: { sizeBytes: true } });
  if (sizeBytes + (pending._sum.sizeBytes ?? 0) + (stored._sum.sizeBytes ?? 0) > RESULT_WORKSPACE_FILE_BYTES ||
    await db.resultFileUpload.count({ where: { workspaceId } }) >= RESULT_WORKSPACE_UPLOADS) {
    throw new WorkResultError("PRECONDITION_FAILED", "Workspace result-file quota reached");
  }
}
export async function beginUpload(principal: ResultPrincipal, scope: ResultScope, action: ResultFileAction<"begin">) {
  const payloadHash = resultPayloadHash({ ...scope, action });
  const existing = await db.resultFileUpload.findUnique({ where: { workspaceId_actorKey_requestId: { workspaceId: principal.workspaceId, actorKey: resultActorKey(principal), requestId: action.requestId } } });
  if (existing) {
    if (existing.payloadHash !== payloadHash) throw new WorkResultError("IDEMPOTENCY_CONFLICT", "Upload request ID records different input");
    return uploadStatus(await ownedUpload(principal, scope, existing.id));
  }
  await reserveWorkspaceBytes(principal.workspaceId, action.sizeBytes);
  const result = await findWorkResult(principal, scope) ?? await db.taskResult.create({ data: { id: randomUUID(), workspaceId: principal.workspaceId, ...scope, scopeKey: workResultScopeKey(scope.occurrenceId) } });
  const upload = await db.resultFileUpload.create({ data: { id: randomUUID(), workspaceId: principal.workspaceId, ...scope, resultId: result.id,
    actorKey: resultActorKey(principal), requestId: action.requestId, payloadHash, filename: action.filename, mimeType: action.mimeType,
    sizeBytes: action.sizeBytes, sha256: action.sha256, expiresAt: new Date(Date.now() + RESULT_UPLOAD_TTL_MS) } });
  return uploadStatus(upload);
}
