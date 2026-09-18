import { createHash } from "node:crypto";
import { db } from "@chrona/db";
import { RESULT_FILE_MAX_BYTES } from "@chrona/contracts/results";
import type { ResultScope } from "./access";

export function fileHash(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
/** Private bytes only. Never resolve a caller URI or arbitrary filesystem path.
 * Legacy Run imports intentionally remain unavailable through this adapter. */
export async function verifiedResultFile(artifactId: string, scope: ResultScope & { workspaceId: string }) {
  const artifact = await db.artifact.findFirst({ where: { id: artifactId, workspaceId: scope.workspaceId, taskId: scope.taskId, occurrenceId: scope.occurrenceId, ownerKind: "result", runId: null, type: "file",
    result: { workspaceId: scope.workspaceId, taskId: scope.taskId, occurrenceId: scope.occurrenceId } }, include: { resultBytes: true } });
  const bytes = artifact?.resultBytes;
  if (!bytes || artifact.uri !== `result-file://${artifact.id}` || bytes.sizeBytes > RESULT_FILE_MAX_BYTES ||
    bytes.data.byteLength !== bytes.sizeBytes || fileHash(bytes.data) !== bytes.sha256) return null;
  return bytes;
}
export async function resultFileAvailable(artifactId: string, scope: ResultScope & { workspaceId: string }) {
  return await verifiedResultFile(artifactId, scope) !== null;
}
