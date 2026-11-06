import { isAbsolute, normalize } from "node:path";
import type { Prisma } from "@chrona/db";
import { executionStartV2Schema, type ExecutionProjectGrantP2 } from "@chrona/contracts/steward";
import type { PreparedServerWorkspace, ServerWorkspaceRequest } from "./ports";
import { executionBaseline, executionDigest, executionPrincipal } from "./execution-state";
import { CallError } from "./module-calls";

type Attempt = Prisma.ExecutionAttemptGetPayload<{ include: { run: true } }>;
export type ServerClaimPreparation = { request: ServerWorkspaceRequest; prepared: PreparedServerWorkspace; admissionDigest: string };
export function serverClaimRequest(row: Attempt, grant: Extract<ExecutionProjectGrantP2, { executor: "server" }>): ServerWorkspaceRequest {
  if (!row.queueExpiresAt || !row.workspaceRef) throw new CallError("unavailable", "Stored server workspace binding is missing");
  const parsed = executionStartV2Schema.safeParse({ kind: "execution", workId: row.workId, commandKey: row.commandKey, goal: row.run.prompt,
    placement: { executorId: row.executorId, projectRef: row.projectRef, mappingRevision: row.mappingRevision },
    workspace: { mode: row.workspaceMode, baseline: executionBaseline(row.baseline), ...(row.sourceManifest ? { source: row.sourceManifest } : {}) },
    queueExpiresAt: row.queueExpiresAt.toISOString(), budget: row.budget });
  if (!parsed.success) throw new CallError("unavailable", "Stored server workspace input is invalid");
  return { principal: executionPrincipal(row), input: parsed.data, grant, attemptId: row.id, workspaceRef: row.workspaceRef, phase: "claim" };
}
function assertRecent(at: string, now: Date) {
  const elapsed = now.getTime() - Date.parse(at);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 5000) throw new CallError("conflict", "Server workspace verification expired");
}
/** Host adapter holds the physical lock; freshness supplements it, never replaces it. */
export function assertPreparedServerWorkspace(request: ServerWorkspaceRequest, prepared: PreparedServerWorkspace, now: Date) {
  if (prepared.bindingDigest !== executionDigest(request) || prepared.projectDirectoryIdentity !== request.grant.directoryIdentity) throw new CallError("conflict", "Server workspace preparation binding mismatch");
  if (!isAbsolute(prepared.cwd) || normalize(prepared.cwd) !== prepared.cwd || !/^[a-f0-9]{64}$/.test(prepared.workspaceDirectoryIdentity)) throw new CallError("conflict", "Server workspace identity is invalid");
  const workspace = prepared.workspace;
  if (workspace.workspaceRef !== request.workspaceRef || workspace.mode !== request.input.workspace.mode || workspace.state !== "ready" || executionDigest(workspace.baseline) !== executionDigest(request.input.workspace.baseline)) throw new CallError("conflict", "Prepared workspace does not match the request");
  if (workspace.mode === "existing" && prepared.workspaceDirectoryIdentity !== prepared.projectDirectoryIdentity) throw new CallError("conflict", "Existing workspace physical identity changed");
  assertRecent(prepared.verifiedAt, now);
  assertPreparedSource(request, prepared, now);
}
function assertPreparedSource(request: ServerWorkspaceRequest, prepared: PreparedServerWorkspace, now: Date) {
  const files = request.input.workspace.source?.files ?? [], receipt = prepared.sourceReceipt;
  if (!files.length) {
    if (receipt !== null) throw new CallError("conflict", "An empty source manifest cannot have a verification receipt");
    return;
  }
  if (!receipt || receipt.fileCount !== files.length || executionDigest(receipt.placement) !== executionDigest(request.input.placement) || executionDigest(receipt.baseline) !== executionDigest(request.input.workspace.baseline)) throw new CallError("conflict", "Server source receipt binding mismatch");
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (receipt.manifestDigest !== executionDigest({ files: sorted })) throw new CallError("conflict", "Server source manifest digest mismatch");
  assertRecent(receipt.verifiedAt, now);
}
