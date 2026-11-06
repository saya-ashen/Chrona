import { Prisma } from "@chrona/db";
import { executorCanonicalJson, type ExecutionPrincipal, type ExecutorCleanupOperation, type ExecutorPrincipal, type ExecutorRequests, type WorkCleanupInput, type WorkCleanupReceipt } from "@chrona/contracts/steward";
import type { ServerWorkspaceRequest, StewardPorts } from "./ports";
import { assertExecutionPrincipal } from "./execution-principal";
import { executionCallerKey, executionDigest, executionScope } from "./execution-state";
import { executionGrant } from "./execution-claim";
import { serverClaimRequest } from "./execution-server-workspace";
import { assertExecutorTarget } from "./executor-auth";
import { CallError } from "./module-calls";

type Tx = Prisma.TransactionClient;
type Envelope = { operation?: ExecutorCleanupOperation; result?: WorkCleanupReceipt; request?: ServerWorkspaceRequest; admissionDigest?: string };
export type WorkspaceCleanupHost = (request: ServerWorkspaceRequest, input: WorkCleanupInput, verify: () => Promise<string>) => Promise<WorkCleanupReceipt>;
const operationName = (input: WorkCleanupInput) => `workspace-cleanup-${input.action}`;
const json = (value: unknown) => value as Prisma.InputJsonValue;
function conflict(message: string): never { throw new CallError("conflict", message); }

/** Durable cleanup commands are transport intents for existing attempts, never an execution queue. */
// eslint-disable-next-line max-lines-per-function -- Keep the receipt-first owner path and its authenticated transport in one scoped factory.
export function createExecutionWorkspaceCleanup(ports: StewardPorts, host: WorkspaceCleanupHost) {
  // eslint-disable-next-line complexity -- Keep stop, grant and current-device checks together at the cleanup trust boundary.
  async function facts(tx: Tx, principal: ExecutionPrincipal, workId: string) {
    await assertExecutionPrincipal(tx, principal);
    const rows = await tx.executionAttempt.findMany({ where: { ...executionScope(principal), callerKey: executionCallerKey(principal), workId }, include: { run: true, assignment: true }, take: 2 });
    if (rows.length !== 1) conflict("Cleanup execution is missing or ambiguous");
    const row = rows[0]!;
    if (!row.workspaceRef || row.workspaceMode !== "independent_worktree" || !row.stopConfirmedAt || !row.stopEvidence || row.heldDirectory || ["queued", "running"].includes(row.run.status)) conflict("Workspace stop or ownership is unknown");
    if (await tx.executionAttempt.count({ where: { executorId: row.executorId, workspaceRef: row.workspaceRef, heldDirectory: { not: null } } })) conflict("Workspace is held");
    const grant = await executionGrant(ports, tx, principal, { executorId: row.executorId, projectRef: row.projectRef, mappingRevision: row.mappingRevision });
    if (executionDigest(grant) !== row.projectDigest) conflict("Cleanup mapping changed");
    let fence: unknown = null;
    if (row.executorId !== "server") {
      const online = await ports.executorAdmission?.online(tx, { executorId: row.executorId, now: ports.now() });
      if (!online || !row.assignment?.finalizedAt || !row.assignment.launchDigest || online.generation !== row.assignment.generation || online.incarnation !== row.assignment.incarnation) conflict("Cleanup device identity is offline or changed");
      fence = { generation: online!.generation, incarnation: online!.incarnation };
    }
    const digest = executionDigest({ attemptId: row.id, workspaceRef: row.workspaceRef, stop: row.stopEvidence, sourceReceipt: row.sourceReceipt, grant, fence });
    return { row, grant, digest };
  }
  async function lookup(tx: Tx, attemptId: string, input: WorkCleanupInput) {
    const old = await tx.executionCommand.findUnique({ where: { attemptId_commandKey: { attemptId, commandKey: input.commandKey } } });
    if (old && (old.operation !== operationName(input) || old.requestDigest !== executionDigest(input))) conflict("Cleanup command key conflict");
    return old;
  }
  async function persist(tx: Tx, attemptId: string, input: WorkCleanupInput, envelope: Envelope) {
    const bytes = Buffer.byteLength(executorCanonicalJson(envelope));
    if (bytes > 8192) throw new CallError("capacity", "Cleanup command exceeds byte budget");
    const commands = await tx.executionCommand.findMany({ where: { operation: { startsWith: "workspace-cleanup-" } }, select: { attemptId: true, receipt: true }, take: 4097 });
    if (commands.length >= 4096 || commands.filter(c => c.attemptId === attemptId).length >= 128 || (commands.length + 1) * 8192 > 4_194_304) throw new CallError("capacity", "Cleanup receipt capacity reached");
    await tx.executionCommand.create({ data: { attemptId, commandKey: input.commandKey, operation: operationName(input), requestDigest: executionDigest(input), receipt: json(envelope) } });
  }
  async function cleanup(principal: ExecutionPrincipal, input: WorkCleanupInput): Promise<WorkCleanupReceipt> {
    const prepared = await ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "ExecutionAttempt" SET "id" = "id" WHERE 0`;
      await assertExecutionPrincipal(tx, principal);
      const row = await tx.executionAttempt.findFirst({ where: { ...executionScope(principal), callerKey: executionCallerKey(principal), workId: input.workId } });
      if (!row) throw new CallError("not_found", "Cleanup execution not found");
      const old = await lookup(tx, row.id, input);
      if (old) {
        const envelope = old.receipt as Envelope;
        if (envelope.request && !envelope.result) return { request: envelope.request, digest: envelope.admissionDigest! };
        return { result: envelope.result ?? { workId: row.workId, workspaceRef: row.workspaceRef!, state: "unknown" as const, reason: "Awaiting original cleanup receipt", previewDigest: null } };
      }
      const current = await facts(tx, principal, input.workId);
      if (current.grant.executor === "device") {
        const a = current.row.assignment!;
        const operation = { target: { workId: row.workId, sessionId: current.row.run.sessionId!, runId: row.runId, attemptId: row.id, assignmentId: a.assignmentId, generation: a.generation }, launchDigest: a.launchDigest!, workspaceRef: row.workspaceRef!, mappingRevision: row.mappingRevision,
          sourceReceiptDigest: row.sourceReceipt ? executionDigest(row.sourceReceipt) : null, input };
        await persist(tx, row.id, input, { operation: { ...operation, requestDigest: executionDigest(operation) } });
        return { result: { workId: row.workId, workspaceRef: row.workspaceRef!, state: "unknown" as const, reason: "Awaiting fixed device cleanup receipt", previewDigest: null } };
      }
      const request = serverClaimRequest(current.row, current.grant);
      await persist(tx, row.id, input, { request, admissionDigest: current.digest });
      return { request, digest: current.digest };
    });
    if (prepared.result) return prepared.result;
    const verify = async () => {
      const current = await ports.db.$transaction(tx => facts(tx, principal, input.workId));
      if (current.digest !== prepared.digest) conflict("Cleanup admission changed");
      return current.digest;
    };
    const result = await host(prepared.request!, input, verify);
    await ports.db.$transaction(async tx => {
      const old = await lookup(tx, prepared.request!.attemptId, input);
      if (!old) conflict("Cleanup reservation missing");
      const envelope = old.receipt as Envelope;
      if (envelope.result && executionDigest(envelope.result) !== executionDigest(result)) conflict("Cleanup receipt is immutable");
      if (Buffer.byteLength(executorCanonicalJson({ ...envelope, result })) > 8192) throw new CallError("capacity", "Cleanup receipt exceeds reserved bytes");
      await tx.executionCommand.update({ where: { attemptId_commandKey: { attemptId: prepared.request!.attemptId, commandKey: input.commandKey } }, data: { receipt: json({ ...envelope, result }) } });
    });
    return result;
  }
  // eslint-disable-next-line complexity -- Isolate stale cleanup commands while preserving unexpected database failures.
  async function poll(tx: Tx, who: ExecutorPrincipal) {
    const commands = await tx.executionCommand.findMany({ where: { operation: { startsWith: "workspace-cleanup-" }, attempt: { executorId: who.executorId } }, orderBy: { createdAt: "asc" }, take: 4096 });
    const result: ExecutorCleanupOperation[] = [];
    for (const command of commands) {
      const envelope = command.receipt as Envelope;
      if (!envelope.operation || envelope.result) continue;
      const op = envelope.operation;
      try {
      const row = await assertExecutorTarget(tx, who, op.target, op.launchDigest);
      const principal: ExecutionPrincipal = { workspaceId: row.attempt.workspaceId, ownerId: row.attempt.ownerId, caller: row.attempt.moduleId ? { kind: "module", moduleId: row.attempt.moduleId, hash: row.attempt.callerHash! } : { kind: "owner" } };
      const current = await facts(tx, principal, row.attempt.workId);
      if (op.workspaceRef !== current.row.workspaceRef || op.mappingRevision !== current.row.mappingRevision || op.sourceReceiptDigest !== (current.row.sourceReceipt ? executionDigest(current.row.sourceReceipt) : null)) conflict("Cleanup operation facts changed");
      } catch (error) {
        if (!(error instanceof CallError) || !["conflict", "forbidden", "not_found"].includes(error.code)) throw error;
        await tx.executionCommand.update({ where: { attemptId_commandKey: { attemptId: command.attemptId, commandKey: command.commandKey } }, data: { receipt: json({ ...envelope, result: { workId: op.input.workId, workspaceRef: op.workspaceRef, state: "blocked", reason: error.message.slice(0, 500), previewDigest: null } }) } });
        continue;
      }
      result.push(op); if (result.length === 4) break;
    }
    return result;
  }
  // eslint-disable-next-line complexity -- Validate the complete immutable cleanup result binding before its single write.
  async function report(tx: Tx, who: ExecutorPrincipal, input: ExecutorRequests["report"]) {
    for (const item of input.cleanupResults ?? []) {
      const row = await assertExecutorTarget(tx, who, input.target);
      const command = await tx.executionCommand.findUnique({ where: { attemptId_commandKey: { attemptId: row.attemptId, commandKey: item.commandKey } } });
      const envelope = command?.receipt as Envelope | undefined, op = envelope?.operation;
      if (!command?.operation.startsWith("workspace-cleanup-") || !op || executionDigest(op.target) !== executionDigest(input.target) || item.requestDigest !== op.requestDigest || item.receipt.workId !== op.input.workId || item.receipt.workspaceRef !== op.workspaceRef) conflict("Cleanup result binding mismatch");
      if (envelope!.result) { if (executionDigest(envelope!.result) !== executionDigest(item.receipt)) conflict("Cleanup receipt is immutable"); continue; }
      const principal: ExecutionPrincipal = { workspaceId: row.attempt.workspaceId, ownerId: row.attempt.ownerId, caller: row.attempt.moduleId ? { kind: "module", moduleId: row.attempt.moduleId, hash: row.attempt.callerHash! } : { kind: "owner" } };
      const current = await facts(tx, principal, row.attempt.workId);
      if (op.launchDigest !== current.row.assignment?.launchDigest || op.workspaceRef !== current.row.workspaceRef || op.mappingRevision !== current.row.mappingRevision || op.sourceReceiptDigest !== (current.row.sourceReceipt ? executionDigest(current.row.sourceReceipt) : null)) conflict("Cleanup result facts changed");
      if (Buffer.byteLength(executorCanonicalJson({ ...envelope, result: item.receipt })) > 8192) throw new CallError("capacity", "Cleanup receipt exceeds reserved bytes");
      await tx.executionCommand.update({ where: { attemptId_commandKey: { attemptId: row.attemptId, commandKey: item.commandKey } }, data: { receipt: json({ ...envelope, result: item.receipt }) } });
    }
  }
  return { cleanup, poll, report };
}
