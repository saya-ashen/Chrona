import { randomUUID } from "node:crypto";
import { db, type ResultFileUpload } from "@chrona/db";
import { RESULT_FILE_CHUNK_BYTES, type ResultFileAction } from "@chrona/contracts/results";
import { WorkResultError } from "./access";
import { fileHash, verifiedResultFile } from "./file-storage";
import { uploadStatus } from "./file-uploads";

function decodeChunk(upload: ResultFileUpload, action: ResultFileAction<"write">) {
  const data = Buffer.from(action.base64, "base64");
  if (data.length < 1 || data.length !== Math.min(RESULT_FILE_CHUNK_BYTES, upload.sizeBytes - action.offset) ||
    action.offset % RESULT_FILE_CHUNK_BYTES !== 0 || data.toString("base64") !== action.base64 || fileHash(data) !== action.sha256) {
    throw new WorkResultError("VALIDATION_ERROR", "Invalid chunk encoding, size or digest");
  }
  return data;
}
export async function writeUpload(upload: ResultFileUpload, action: ResultFileAction<"write">) {
  const data = decodeChunk(upload, action);
  if (upload.status === "completed" && upload.finalArtifactId) {
    const bytes = await verifiedResultFile(upload.finalArtifactId, upload);
    if (bytes && Buffer.from(bytes.data).subarray(action.offset, action.offset + data.length).equals(data)) return uploadStatus(upload);
    throw new WorkResultError("IDEMPOTENCY_CONFLICT", "Completed upload does not contain this chunk");
  }
  if (upload.status !== "open") return uploadStatus(upload);
  const previous = await db.resultFileChunk.findUnique({ where: { uploadId_offset: { uploadId: upload.id, offset: action.offset } } });
  if (previous) {
    if (previous.sha256 !== action.sha256 || !Buffer.from(previous.data).equals(data)) throw new WorkResultError("IDEMPOTENCY_CONFLICT", "Chunk offset already records different bytes");
    return uploadStatus(upload);
  }
  if (action.offset !== upload.receivedBytes || action.offset + data.length > upload.sizeBytes) throw new WorkResultError("PRECONDITION_FAILED", "Read upload status and resume at the contiguous offset");
  await db.resultFileChunk.create({ data: { uploadId: upload.id, offset: action.offset, sizeBytes: data.length, sha256: action.sha256, data } });
  const updated = await db.resultFileUpload.update({ where: { id: upload.id, receivedBytes: action.offset, status: "open" }, data: { receivedBytes: { increment: data.length } } });
  return uploadStatus(updated);
}

export async function finishUpload(upload: ResultFileUpload) {
  if (upload.status !== "open") return uploadStatus(upload);
  if (upload.receivedBytes !== upload.sizeBytes) throw new WorkResultError("PRECONDITION_FAILED", "Upload is incomplete");
  const chunks = await db.resultFileChunk.findMany({ where: { uploadId: upload.id }, orderBy: { offset: "asc" } });
  let offset = 0;
  for (const chunk of chunks) {
    if (chunk.offset !== offset || chunk.sizeBytes !== chunk.data.length || fileHash(chunk.data) !== chunk.sha256) throw new WorkResultError("PRECONDITION_FAILED", "Upload chunk integrity check failed");
    offset += chunk.sizeBytes;
  }
  const data = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data)));
  if (offset !== upload.sizeBytes || fileHash(data) !== upload.sha256) throw new WorkResultError("PRECONDITION_FAILED", "Upload file integrity check failed");
  const id = randomUUID();
  await db.artifact.create({ data: { id, workspaceId: upload.workspaceId, taskId: upload.taskId, occurrenceId: upload.occurrenceId,
    runId: null, resultId: upload.resultId, ownerKind: "result", title: upload.filename, type: "file", uri: `result-file://${id}`, metadata: {},
    resultBytes: { create: { sizeBytes: upload.sizeBytes, sha256: upload.sha256, filename: upload.filename, mimeType: upload.mimeType, data } } } });
  const completed = await db.resultFileUpload.update({ where: { id: upload.id, status: "open" }, data: { status: "completed", finalArtifactId: id } });
  await db.resultFileChunk.deleteMany({ where: { uploadId: upload.id } });
  return uploadStatus(completed);
}
