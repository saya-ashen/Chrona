import type { ResultFileInput, ResultFileRead, ResultFileAction } from "@chrona/contracts/results";
import { authorizeResult, requireResultPermission, WorkResultError, type TaskResultsPorts, type ResultPrincipal, type ResultScope } from "./access";
import { boundResultArtifactId } from "./artifacts";
import { scopeOf } from "./commands";
import { verifiedResultFile } from "./file-storage";
import { beginUpload, closeUpload, ownedUpload, uploadStatus } from "./file-uploads";
import { finishUpload, writeUpload } from "./file-write";

async function readFile(principal: ResultPrincipal, scope: ResultScope, action: ResultFileAction<"read">): Promise<ResultFileRead> {
  const artifactId = await boundResultArtifactId(principal, scope, action.versionId, action.artifactRef);
  const file = await verifiedResultFile(artifactId, { ...scope, workspaceId: principal.workspaceId });
  if (!file) throw new WorkResultError("PRECONDITION_FAILED", "Result file bytes are unavailable or unverifiable");
  if (action.offset > file.sizeBytes) throw new WorkResultError("VALIDATION_ERROR", "Offset exceeds file size");
  const end = Math.min(action.offset + action.limit, file.sizeBytes);
  return { artifactRef: action.artifactRef, versionId: action.versionId, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256: file.sha256,
    offset: action.offset, base64: Buffer.from(file.data).subarray(action.offset, end).toString("base64"), nextOffset: end < file.sizeBytes ? end : null };
}

/** Shared transaction includes auth, binary writes and stable upload receipts. */
export async function resultFile(ports: TaskResultsPorts, input: ResultFileInput) {
  const scope = scopeOf(input);
  const action = input.action;
  // Status/cancel only inspect or remove the caller's reservation, even when work is closed
  // or new writes disabled. They never publish, allocate or alter finalized artifacts.
  const cleanup = action.type === "status" || action.type === "cancel";
  const principal = await authorizeResult(ports, scope, cleanup ? "results:read" : action.type === "read" ? "artifacts:read" : "artifacts:write");
  requireResultPermission(principal, "results:read");
  if (cleanup) requireResultPermission(principal, "artifacts:write");
  if (action.type === "read") {
    return readFile(principal, scope, action);
  }
  if (action.type === "begin") return beginUpload(principal, scope, action);
  const upload = await ownedUpload(principal, scope, action.uploadId);
  if (action.type === "write") return writeUpload(upload, action);
  if (action.type === "finish") return finishUpload(upload);
  return uploadStatus(action.type === "cancel" ? await closeUpload(upload, "cancelled") : upload);
}
