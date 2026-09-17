import { db } from "@chrona/db";
import { workResultWritesAllowed } from "@chrona/domain/task/work-results";
import type { WorkResultContent } from "@chrona/contracts/results";

export type ResultPermission = "results:read" | "results:write" | "results:review" | "artifacts:read";
export type ResultPrincipal = {
  workspaceId: string; actorKind: "human" | "external"; actorId: string;
  permissions: readonly ResultPermission[];
};
export type ResultScope = { taskId: string; occurrenceId: string | null };
export type TaskResultsPorts = {
  /** Trusted composition only. Re-read current identity, revocation and scopes on EVERY call,
   * inside the DB transaction. DB/local-only: never call providers or network services here.
   * Request JSON cannot set this principal. No mounted transport exists until B2. */
  authorize(scope: ResultScope, permission: ResultPermission): Promise<ResultPrincipal | null>;
  /** Verify accessible, finalized local bytes, not just a stored URI. Missing adapter = unavailable.
   * No paths/URIs from the submitting agent are accepted. B2 owns the production adapter. */
  artifactAvailable?(artifactId: string, scope: ResultScope & { workspaceId: string }): Promise<boolean>;
};

export type WorkResultErrorCode = "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" | "REVISION_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "PRECONDITION_FAILED" | "STORAGE_ERROR";
export class WorkResultError extends Error {
  constructor(public readonly code: WorkResultErrorCode, message: string) { super(message); this.name = "WorkResultError"; }
}
export function requireResultPermission(principal: ResultPrincipal, permission: ResultPermission) {
  if (!principal.permissions.includes(permission)) throw new WorkResultError("FORBIDDEN", "Result permission is required");
}
export function resultActorKey(principal: ResultPrincipal) { return `${principal.actorKind}:${principal.actorId}`; }

export async function authorizeResult(ports: TaskResultsPorts, scope: ResultScope, permission: ResultPermission) {
  const principal = await ports.authorize(scope, permission);
  if (!principal || !["human", "external"].includes(principal.actorKind) || !principal.actorId || principal.actorId.length > 128) {
    throw new WorkResultError("AUTH_REQUIRED", "Current result authorization is required");
  }
  requireResultPermission(principal, permission);
  const task = await db.task.findFirst({ where: { id: scope.taskId, workspaceId: principal.workspaceId }, include: { workspace: { select: { status: true } } } });
  if (!task) throw new WorkResultError("NOT_FOUND", "Task not found");
  if (scope.occurrenceId !== null && !await db.taskOccurrence.findFirst({ where: { id: scope.occurrenceId, taskId: task.id, workspaceId: principal.workspaceId }, select: { id: true } })) {
    throw new WorkResultError("NOT_FOUND", "Task occurrence not found");
  }
  if (permission !== "results:read" && !workResultWritesAllowed(task, task.workspace.status)) {
    throw new WorkResultError("PRECONDITION_FAILED", "Closed work does not accept result writes");
  }
  return principal;
}

export function contentArtifactRefs(content: WorkResultContent): string[] {
  return [...new Set([...content.deliverables.map((item) => item.artifactRef), ...content.evidence.flatMap((item) => item.artifactRef ? [item.artifactRef] : [])])];
}
