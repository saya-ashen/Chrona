import { RESULT_REQUEST_BYTES, RESULT_RESPONSE_BYTES, RESULT_SCOPES, ARTIFACT_SCOPES, RESULT_FILE_CHUNK_BYTES, RESULT_FILE_MAX_BYTES, RESULT_VERSION_FILE_BYTES, RESULT_WORKSPACE_FILE_BYTES, RESULT_WORKSPACE_UPLOADS, RESULT_UPLOAD_TTL_MS } from "@chrona/contracts/results";
import { WorkResultError, type ResultPermission } from "./access";
import { pageWritesEnabled } from "./page-policy";

/** New write entries are opt-in. Disabling them preserves stored results and reads.
 * This flag never starts execution, enrolls credentials or widens legacy scopes. */
export function resultWritesEnabled() {
  return process.env.CHRONA_RESULT_WRITES_ENABLED === "true";
}
export function assertResultEntryEnabled(permission: ResultPermission) {
  if (permission.startsWith("pages:")) {
    if (permission !== "pages:read" && !pageWritesEnabled()) throw new WorkResultError("PRECONDITION_FAILED", "Work page writes are disabled; existing pages remain readable");
    return;
  }
  if (permission !== "results:read" && permission !== "artifacts:read" && !resultWritesEnabled()) {
    throw new WorkResultError("PRECONDITION_FAILED", "New result writes are disabled; existing results remain readable");
  }
}
export function readWorkResultCapabilities(scopes: readonly string[]) {
  const canRead = scopes.includes("tasks:read") && scopes.includes("results:read");
  return {
    available: true, contractVersion: 1, stage: "result_files", writesEnabled: resultWritesEnabled(),
    canRead, canSubmit: canRead && resultWritesEnabled() && scopes.includes("results:write"),
    canReview: canRead && resultWritesEnabled() && scopes.includes("results:review"),
    permissions: [...RESULT_SCOPES, ...ARTIFACT_SCOPES], requestBytes: RESULT_REQUEST_BYTES, responseEnvelopeBytes: RESULT_RESPONSE_BYTES,
    sources: ["human", "external"], providerRequired: false, lifecycleChanges: false, goalAchievement: false,
    selection: ["latest", "accepted", "version"], views: ["content", "versions", "reviews"],
    uploads: canRead && resultWritesEnabled() && scopes.includes("artifacts:write"),
    artifactLinking: canRead && resultWritesEnabled() && scopes.includes("results:write") && scopes.includes("artifacts:read"),
    artifactBytes: canRead && scopes.includes("artifacts:read"), legacyRunImport: false, goalInbox: false,
    fileLimits: { chunkBytes: RESULT_FILE_CHUNK_BYTES, fileBytes: RESULT_FILE_MAX_BYTES, versionBytes: RESULT_VERSION_FILE_BYTES,
      workspaceBytes: RESULT_WORKSPACE_FILE_BYTES, workspaceUploadReceipts: RESULT_WORKSPACE_UPLOADS, uploadTtlMs: RESULT_UPLOAD_TTL_MS },
  };
}
