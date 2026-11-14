import { Prisma } from "@chrona/db";
import { type ExecutionPrincipal, type WorkCleanupInput, type WorkCleanupReceipt } from "@chrona/contracts/steward";
import type { ServerWorkspaceRequest, StewardPorts } from "./ports";
import { assertRetainedExecutionPrincipal } from "./execution-module-guard";
import { assertExecutionPrincipal } from "./execution-principal";
import { executionCallerKey, executionDigest, executionScope } from "./execution-state";
import { executionGrant } from "./execution-claim";
import { serverClaimRequest } from "./execution-server-workspace";
import { CallError } from "./module-calls";

type Tx = Prisma.TransactionClient;
type Envelope = { result?: WorkCleanupReceipt; request?: ServerWorkspaceRequest; admissionDigest?: string };
export type WorkspaceCleanupHost = (request: ServerWorkspaceRequest, input: WorkCleanupInput, verify: () => Promise<string>) => Promise<WorkCleanupReceipt>;
const operationName = (input: WorkCleanupInput) => `workspace-cleanup-${input.action}`;
const json = (value: unknown) => value as Prisma.InputJsonValue;
function conflict(message: string): never { throw new CallError("conflict", message); }

/** Durable cleanup commands are transport intents for existing attempts, never an execution queue. */
export function createExecutionWorkspaceCleanup(ports: StewardPorts, host: WorkspaceCleanupHost) {
  async function facts(tx: Tx, principal: ExecutionPrincipal, workId: string, retained = false) {
    await (retained ? assertRetainedExecutionPrincipal : assertExecutionPrincipal)(tx, principal);
    const rows = await tx.executionAttempt.findMany({ where: { ...executionScope(principal), callerKey: executionCallerKey(principal), workId }, include: { run: true }, take: 2 });
    if (rows.length !== 1) conflict("Cleanup execution is missing or ambiguous");
    const row = rows[0]!;
    if (!row.workspaceRef || row.workspaceMode !== "independent_worktree" || !row.stopConfirmedAt || !row.stopEvidence || row.heldDirectory || ["queued", "running"].includes(row.run.status)) conflict("Workspace stop or ownership is unknown");
    if (await tx.executionAttempt.count({ where: { executorId: row.executorId, workspaceRef: row.workspaceRef, heldDirectory: { not: null } } })) conflict("Workspace is held");
    const grant = await executionGrant(ports, tx, principal, { executorId: row.executorId, projectRef: row.projectRef, mappingRevision: row.mappingRevision });
    if (executionDigest(grant) !== row.projectDigest) conflict("Cleanup mapping changed");
    const digest = executionDigest({ attemptId: row.id, workspaceRef: row.workspaceRef, stop: row.stopEvidence, sourceReceipt: row.sourceReceipt, grant });
    return { row, grant, digest };
  }
  async function lookup(tx: Tx, attemptId: string, input: WorkCleanupInput) {
    const old = await tx.executionCommand.findUnique({ where: { attemptId_commandKey: { attemptId, commandKey: input.commandKey } } });
    if (old && (old.operation !== operationName(input) || old.requestDigest !== executionDigest(input))) conflict("Cleanup command key conflict");
    return old;
  }
  async function persist(tx: Tx, attemptId: string, input: WorkCleanupInput, envelope: Envelope) {
    const bytes = Buffer.byteLength(JSON.stringify(envelope));
    if (bytes > 8192) throw new CallError("capacity", "Cleanup command exceeds byte budget");
    const commands = await tx.executionCommand.findMany({ where: { operation: { startsWith: "workspace-cleanup-" } }, select: { attemptId: true, receipt: true }, take: 4097 });
    if (commands.length >= 4096 || commands.filter(c => c.attemptId === attemptId).length >= 128 || (commands.length + 1) * 8192 > 4_194_304) throw new CallError("capacity", "Cleanup receipt capacity reached");
    await tx.executionCommand.create({ data: { attemptId, commandKey: input.commandKey, operation: operationName(input), requestDigest: executionDigest(input), receipt: json(envelope) } });
  }
  async function cleanup(principal: ExecutionPrincipal, input: WorkCleanupInput): Promise<WorkCleanupReceipt> {
    const prepared = await ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
      await assertRetainedExecutionPrincipal(tx, principal);
      const row = await tx.executionAttempt.findFirst({ where: { ...executionScope(principal), callerKey: executionCallerKey(principal), workId: input.workId } });
      if (!row) throw new CallError("not_found", "Cleanup execution not found");
      const old = await lookup(tx, row.id, input);
      if (old) {
        const envelope = old.receipt as Envelope;
        if (envelope.request && !envelope.result) return { request: envelope.request, digest: envelope.admissionDigest! };
        return { result: envelope.result ?? { workId: row.workId, workspaceRef: row.workspaceRef!, state: "unknown" as const, reason: "Awaiting original cleanup receipt", previewDigest: null } };
      }
      const current = await facts(tx, principal, input.workId);
      const request = serverClaimRequest(current.row, current.grant);
      await persist(tx, row.id, input, { request, admissionDigest: current.digest });
      return { request, digest: current.digest };
    });
    if (prepared.result) return prepared.result;
    const verify = async () => {
      const current = await ports.db.$transaction(tx => facts(tx, principal, input.workId, true));
      if (current.digest !== prepared.digest) conflict("Cleanup admission changed");
      return current.digest;
    };
    const result = await host(prepared.request!, input, verify);
    await ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
      await assertRetainedExecutionPrincipal(tx, principal);
      const old = await lookup(tx, prepared.request!.attemptId, input);
      if (!old) conflict("Cleanup reservation missing");
      const envelope = old.receipt as Envelope;
      if (envelope.result && executionDigest(envelope.result) !== executionDigest(result)) conflict("Cleanup receipt is immutable");
      if (Buffer.byteLength(JSON.stringify({ ...envelope, result })) > 8192) throw new CallError("capacity", "Cleanup receipt exceeds reserved bytes");
      await tx.executionCommand.update({ where: { attemptId_commandKey: { attemptId: prepared.request!.attemptId, commandKey: input.commandKey } }, data: { receipt: json({ ...envelope, result }) } });
    });
    return result;
  }
  return { cleanup };
}
