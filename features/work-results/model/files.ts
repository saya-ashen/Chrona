import { workResults as wr } from "@chrona/contracts";
import { resultRequest, type ResultScope } from "./client";

export type UploadRecovery = { scope: ResultScope; action: wr.ResultFileAction<"begin">; uploadId?: string };
export function uploadStorageKey(scope: ResultScope) { return `chrona.result-upload:${scope.taskId}:${scope.occurrenceId ?? "task"}`; }
export function readUploadRecovery(scope: ResultScope): UploadRecovery | null {
  try {
    const value = JSON.parse(localStorage.getItem(uploadStorageKey(scope)) ?? "null") as UploadRecovery | null;
    if (!value || value.scope.taskId !== scope.taskId || value.scope.occurrenceId !== scope.occurrenceId || !wr.resultFileSchema.safeParse({ ...scope, action: value.action }).success) return null;
    return value;
  } catch { return null; }
}
export function saveUploadRecovery(value: UploadRecovery) {
  try { localStorage.setItem(uploadStorageKey(value.scope), JSON.stringify(value)); return true; } catch { return false; }
}
export async function bytesHash(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function beginFile(file: File, scope: ResultScope): Promise<UploadRecovery> {
  if (file.size > wr.RESULT_FILE_MAX_BYTES || !wr.resultFilenameSchema.safeParse(file.name).success) throw new Error("invalid");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const action: wr.ResultFileAction<"begin"> = { type: "begin", requestId: crypto.randomUUID(), filename: file.name,
    mimeType: file.type || "application/octet-stream", sizeBytes: file.size, sha256: await bytesHash(bytes) };
  if (!wr.resultFileSchema.safeParse({ ...scope, action }).success) throw new Error("invalid");
  return { scope, action };
}
export async function restoreUpload(recovery: UploadRecovery) {
  return resultRequest<wr.ResultUploadStatus>("file", { ...recovery.scope, action: recovery.uploadId ? { type: "status", uploadId: recovery.uploadId } : recovery.action });
}
export async function sendFile(file: File, recovery: UploadRecovery, status: wr.ResultUploadStatus, progress: (status: wr.ResultUploadStatus) => void, signal: AbortSignal) {
  if (file.size !== recovery.action.sizeBytes || file.name !== recovery.action.filename) throw new Error("uploadMismatch");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (await bytesHash(bytes) !== recovery.action.sha256) throw new Error("uploadMismatch");
  let current = status;
  while (current.status === "open" && current.receivedBytes < bytes.length) {
    const chunk = bytes.slice(current.receivedBytes, current.receivedBytes + wr.RESULT_FILE_CHUNK_BYTES);
    current = await resultRequest<wr.ResultUploadStatus>("file", { ...recovery.scope, action: { type: "write", uploadId: current.uploadId,
      offset: current.receivedBytes, sha256: await bytesHash(chunk), base64: btoa(String.fromCharCode(...chunk)) } }, signal);
    progress(current);
  }
  if (current.status === "open") {
    current = await resultRequest<wr.ResultUploadStatus>("file", { ...recovery.scope, action: { type: "finish", uploadId: current.uploadId } }, signal);
    progress(current);
  }
  return current;
}
function downloadChunk(file: wr.ResultFileRead, first: wr.ResultFileRead, size: number) {
  if (file.sha256 !== first.sha256 || file.sizeBytes !== first.sizeBytes || file.offset !== size || file.sizeBytes > wr.RESULT_FILE_MAX_BYTES) throw new Error("downloadFailed");
  const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
  const next = size + bytes.length;
  if (next > first.sizeBytes || (file.nextOffset !== null && (file.nextOffset !== next || bytes.length === 0))) throw new Error("downloadFailed");
  return bytes;
}
export async function downloadResultFile(scope: ResultScope, versionId: string, artifactRef: string) {
  let offset: number | null = 0;
  let first: wr.ResultFileRead | null = null;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (let page = 0; offset !== null && page <= wr.RESULT_FILE_MAX_BYTES / wr.RESULT_FILE_CHUNK_BYTES; page++) {
    const file: wr.ResultFileRead = await resultRequest<wr.ResultFileRead>("file", { ...scope, action: { type: "read", versionId, artifactRef, offset } });
    first ??= file;
    const bytes = downloadChunk(file, first, size);
    size += bytes.length; chunks.push(bytes);
    offset = file.nextOffset;
  }
  if (!first || offset !== null || size !== first.sizeBytes || !wr.resultFilenameSchema.safeParse(first.filename).success) throw new Error("downloadFailed");
  const all = new Uint8Array(size); let cursor = 0;
  for (const chunk of chunks) { all.set(chunk, cursor); cursor += chunk.length; }
  if (await bytesHash(all) !== first.sha256) throw new Error("downloadFailed");
  // Untrusted MIME is metadata only: do not navigate, render HTML/SVG or open a preview.
  const url = URL.createObjectURL(new Blob([all], { type: "application/octet-stream" }));
  const link = document.createElement("a"); link.href = url; link.download = first.filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
