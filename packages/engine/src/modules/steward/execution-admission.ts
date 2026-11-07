import { randomUUID } from "node:crypto";
import { prepareLocalWorkspace } from "./local-workspace";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { WORK_LIMITS, type ExecutionPlacementView, type ExecutionPrincipal, type ExecutionStartV2, type ExecutionProjectGrantP2 } from "@chrona/contracts/steward";
import type { PreparedServerWorkspace, ServerWorkspaceRequest, ExecutionV2Admission, StewardPorts } from "./ports";
import { executionAdmissionIntent } from "./execution-admission-intent";
import { assertPreparedServerWorkspace } from "./execution-server-workspace";
import { executionGrant, heldExecutionDirectory } from "./execution-claim";
import { CallError } from "./module-calls";
import { assertExecutionPrincipal } from "./execution-principal";
import { createRunSession, enqueueExecutionRunIn } from "./runs";
import { executionBaseline, executionCallerKey, executionDigest, executionEventStore, executionRef, executionView } from "./execution-state";

type Attempt = Prisma.ExecutionAttemptGetPayload<{ include: { run: true } }>;
export async function executionPlacementIn(tx: Prisma.TransactionClient, row: Attempt, online: boolean): Promise<ExecutionPlacementView> {
  if (!row.queueExpiresAt || !row.workspaceRef || !row.workspaceMode) throw new CallError("unavailable", "Execution placement facts are missing");
  const assignment = row.executorId === "server" ? null : await tx.executorAssignment.findUnique({ where: { attemptId: row.id } });
  const ready = row.executorId === "server" ? row.resolvedCwd !== null : !!assignment?.startedAt;
  const status = executionView(row).status;
  const state = row.stopConfirmedAt ? "retained" : status === "unknown" ? "unknown" : ready ? "ready" : "requested";
  return { ...executionRef(row), placement: { executorId: row.executorId, projectRef: row.projectRef, mappingRevision: row.mappingRevision }, queueExpiresAt: row.queueExpiresAt.toISOString(), online,
    workspace: { workspaceRef: row.workspaceRef, mode: row.workspaceMode as "existing" | "independent_worktree", baseline: executionBaseline(row.baseline), state, sourceReceipt: row.sourceReceipt as ExecutionPlacementView["workspace"]["sourceReceipt"], retained: true } };
}
async function originalStart(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, input: ExecutionStartV2) {
  const callerKey = executionCallerKey(principal);
  const row = await tx.executionAttempt.findUnique({ where: { workspaceId_ownerId_callerKey_commandKey: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey, commandKey: input.commandKey } }, include: { run: true } });
  if (row && (row.requestDigest !== executionDigest(input) || principal.caller.kind === "module" && row.callerHash !== principal.caller.hash)) throw new CallError("conflict", "Start key belongs to a different request or module version");
  return row;
}
async function authorizeStart(ports: StewardPorts, tx: Prisma.TransactionClient, principal: ExecutionPrincipal, input: ExecutionStartV2, now: Date) {
  await assertExecutionPrincipal(tx, principal);
  const expires = new Date(input.queueExpiresAt);
  if (expires <= now || expires.getTime() > now.getTime() + WORK_LIMITS.queueMs) throw new CallError("invalid", "Queue expiry must be within the next day");
  const grant = await executionGrant(ports, tx, principal, input.placement);
  if (executionDigest(grant.baseline) !== executionDigest(input.workspace.baseline)) throw new CallError("conflict", "Expected baseline does not match the authorized mapping");
  if (await tx.executionAttempt.count({ where: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey: executionCallerKey(principal), workId: input.workId } })) throw new CallError("conflict", "Work already has an execution");
  return grant;
}
function callerFields(principal: ExecutionPrincipal) {
  return principal.caller.kind === "module" ? { moduleId: principal.caller.moduleId, callerHash: principal.caller.hash } : { moduleId: null, callerHash: null };
}
async function reserveDirectory(tx: Prisma.TransactionClient, grant: ExecutionProjectGrantP2, input: ExecutionStartV2, workspaceRef: string, prepared?: PreparedServerWorkspace) {
  const heldDirectory = prepared ? heldExecutionDirectory("server", prepared.workspaceDirectoryIdentity) : heldExecutionDirectory(grant.executorId, grant.directoryIdentity, input.workspace.mode === "independent_worktree" ? workspaceRef : undefined);
  if (await tx.executionAttempt.count({ where: { OR: [{ heldDirectory }, ...(prepared ? [{ executorId: "server", resolvedCwd: prepared.cwd, stopConfirmedAt: null }] : [])] } })) throw new CallError("conflict", "Project directory is occupied");
  return heldDirectory;
}
async function admitExecutionIn(ports: StewardPorts, tx: Prisma.TransactionClient, principal: ExecutionPrincipal, input: ExecutionStartV2, state: { grant: ExecutionProjectGrantP2; now: Date; request?: ServerWorkspaceRequest; prepared?: PreparedServerWorkspace }) {
  const { grant, now, prepared } = state, workspaceRef = state.request?.workspaceRef ?? randomUUID(), caller = callerFields(principal);
  const heldDirectory = await reserveDirectory(tx, grant, input, workspaceRef, prepared);
  const session = await createRunSession(tx, principal.workspaceId, "module", now, caller.moduleId ? { moduleId: caller.moduleId } : {});
  const logDir = join(ports.dataDir, "sessions", session.id);
  const run = await enqueueExecutionRunIn(ports, tx, { workspaceId: principal.workspaceId, sessionId: session.id, prompt: input.goal, cwd: prepared?.cwd ?? logDir, now });
  const row = await tx.executionAttempt.create({ data: { ...(state.request ? { id: state.request.attemptId } : {}), workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey: executionCallerKey(principal), ...caller,
    workId: input.workId, commandKey: input.commandKey, requestDigest: executionDigest(input), runId: run.id, projectRef: grant.projectRef, projectDigest: executionDigest(grant), executorId: grant.executorId, executorGeneration: grant.executorGeneration, mappingRevision: grant.mappingRevision, directoryIdentity: grant.directoryIdentity,
    queueExpiresAt: new Date(input.queueExpiresAt), workspaceRef, workspaceMode: input.workspace.mode, ...(input.workspace.source ? { sourceManifest: input.workspace.source } : {}), resolvedCwd: prepared?.cwd ?? null, logDir, baseline: `${grant.baseline.kind}:${grant.baseline.digest}`, budget: input.budget, heldDirectory }, include: { run: true } });
  await executionEventStore(ports).admit(tx, principal, executionRef(row));
  await executionEventStore(ports).control(tx, principal, executionRef(row), { slot: "admission", at: now.toISOString(), status: "confirmed" });
  return row;
}
async function beginAdmission(ports: StewardPorts, principal: ExecutionPrincipal, input: ExecutionStartV2) {
  return ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
    const existing = await originalStart(tx, principal, input);
    if (existing) return { row: existing, queued: false };
    const now = ports.now(), grant = await authorizeStart(ports, tx, principal, input, now);
    if (grant.executor !== "server") return { row: await admitExecutionIn(ports, tx, principal, input, { grant, now }), queued: true };
    if (!ports.executionServerWorkspace) throw new CallError("unavailable", "Server workspace preparation is not configured");
    const intent = await executionAdmissionIntent(tx, principal, { commandKey: input.commandKey, requestDigest: executionDigest(input), grantDigest: executionDigest(grant), now });
    const request: ServerWorkspaceRequest = { principal, input, grant, attemptId: intent.attemptId, workspaceRef: intent.workspaceRef, phase: "admission" };
    return { request };
  });
}
async function completeServerAdmission(ports: StewardPorts, request: ServerWorkspaceRequest) {
  const prepared = await prepareLocalWorkspace(ports, request);
  try {
    return await ports.db.$transaction(async tx => {
      const { principal, input } = request;
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
      const existing = await originalStart(tx, principal, input);
      if (existing) return { row: existing, queued: false };
      const now = ports.now(), grant = await authorizeStart(ports, tx, principal, input, now);
      if (executionDigest(grant) !== executionDigest(request.grant)) throw new CallError("conflict", "Server grant changed during preparation");
      const intent = await executionAdmissionIntent(tx, principal, { commandKey: input.commandKey, requestDigest: executionDigest(input), grantDigest: executionDigest(grant), now });
      if (intent.attemptId !== request.attemptId || intent.workspaceRef !== request.workspaceRef) throw new CallError("conflict", "Server admission identity changed");
      assertPreparedServerWorkspace(request, prepared, now);
      return { row: await admitExecutionIn(ports, tx, principal, input, { grant, now, request, prepared }), queued: true };
    });
  } finally { await prepared.release(); }
}
export function createExecutionV2Admission(ports: StewardPorts): ExecutionV2Admission {
  return { async start(principal, input) {
    const begun = await beginAdmission(ports, principal, input);
    const result = "request" in begun && begun.request ? await completeServerAdmission(ports, begun.request) : begun;
    const { row, queued } = result;
    if (queued) await ports.onQueued?.();
    const placement = await ports.db.$transaction(async tx => {
      const online = row.executorId === "server" || !!await ports.executorAdmission?.online(tx, { executorId: row.executorId, now: ports.now() });
      return executionPlacementIn(tx, row, online);
    });
    return { execution: executionView(row), placement };
  } };
}
