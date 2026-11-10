import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Prisma } from "@chrona/db";
import type { ExecutionPrincipal } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError } from "./module-call-error";
import { createRuns, createRunSession } from "./runs";
import { createProviderControl, validateExecutionAnswer } from "./provider-channel";
import { assertExecutionPrincipal } from "./execution-principal";
import { selectContextTools } from "./agent-context-tools";
import { contextInteractions } from "./agent-context-read";
import { providerAnswerSchema } from "@chrona/contracts/steward";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type ModulePrincipal = ExecutionPrincipal & { caller: { kind: "module"; moduleId: string; hash: string } };
function modulePrincipal(principal: ExecutionPrincipal): ModulePrincipal {
  if (principal.caller.kind !== "module") throw new CallError("forbidden", "Agent context requires a module caller");
  return principal as ModulePrincipal;
}
async function ownedContext(tx: Prisma.TransactionClient, principal: ModulePrincipal, contextId: string) {
  const row = await tx.session.findFirst({ where: { id: contextId, workspaceId: principal.workspaceId, moduleId: principal.caller.moduleId, source: "module" } });
  const grant = await tx.agentContext.findUnique({ where: { sessionId: contextId } });
  if (!row || grant?.hash !== principal.caller.hash || grant.moduleId !== principal.caller.moduleId || grant.workspaceId !== principal.workspaceId) throw new CallError("not_found", "Agent context not found");
  return row;
}
async function ownedRun(tx: Prisma.TransactionClient, principal: ModulePrincipal, runId: string) {
  const row = await tx.run.findFirst({ where: { id: runId, workspaceId: principal.workspaceId, execution: null } });
  if (!row?.sessionId) throw new CallError("not_found", "Agent run not found");
  await ownedContext(tx, principal, row.sessionId);
  return row;
}
function view(run: { id: string; sessionId: string | null; status: string; stopStatus: string }) {
  const uncertain = run.stopStatus === "unknown";
  return { runId: run.id, contextId: run.sessionId!, status: uncertain ? "unknown" : run.status, active: uncertain || run.status === "queued" || run.status === "running" };
}
async function readContextPrimitive(ports: StewardPorts, principal: ModulePrincipal, name: string, args: Record<string, unknown>) {
  const run = await ownedRun(ports.db, principal, String(args.runId));
  if (name === "get") return view(run);
  const after = Number(args.after), limit = Number(args.limit);
  // Provider channel rows are already normalized and redacted before being committed.
  const rows = await ports.db.runEvent.findMany({ where: { runId: run.id, sequence: { gt: after } }, orderBy: { sequence: "asc" }, take: limit });
  const items = rows.map(row => ({ sequence: row.sequence, at: row.createdAt.toISOString(), kind: row.kind, payload: row.payload }));
  return { items, after: items.at(-1)?.sequence ?? after, ended: !view(run).active, interactions: await contextInteractions(ports, run), transcript: { sessionDir: join(ports.dataDir, "sessions", run.sessionId!, ".chrona", "sessions"), limit } };
}
/** Kernel retains only scoped context identity, admission receipts and durable Run evidence. */
export async function admitContextPrimitive(ports: StewardPorts, rawPrincipal: ExecutionPrincipal, name: string, args: Record<string, unknown>, settle = false) {
  const principal = modulePrincipal(rawPrincipal), { workspaceId } = principal;
  if (name === "get" || name === "stream") return readContextPrimitive(ports, principal, name, args);
  if (name === "run") {
    const selection = await selectContextTools(ports, principal, args.tools as string[]);
    if ((args.content as string[]).some(ref => !ref.startsWith(`${selection.caller.module}/`))) throw new CallError("forbidden", "Agent input content must belong to the originating module");
  }
  let answer: ReturnType<typeof providerAnswerSchema.parse> | undefined;
  if (name === "respond") {
    try { answer = providerAnswerSchema.parse(JSON.parse(String(args.answer))); }
    catch { throw new CallError("invalid", "Invalid Agent interaction answer"); }
  }
  const result = await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    await assertExecutionPrincipal(tx, principal);
    const key = `agent-command:${digest([workspaceId, principal.caller.moduleId, name, args.requestKey])}`;
    const hash = digest(args), previous = await tx.agentCommand.findUnique({ where: { id: key } });
    async function replayReceipt(receipt: NonNullable<typeof previous>) {
      if (receipt.hash !== principal.caller.hash) throw new CallError("forbidden", "Agent command belongs to another module version");
      if (receipt.requestDigest !== hash) throw new CallError("conflict", "Agent request identity changed");
      if (settle) {
        await tx.agentCommand.update({ where: { id: key }, data: { settled: true } });
      } else if (["write", "interrupt", "respond"].includes(name) && !receipt.settled) throw new CallError("unknown", "Agent control outcome requires reconciliation");
      return { output: receipt.output, duplicate: true };
    }
    if (previous) return replayReceipt(previous);
    if (settle) throw new CallError("not_found", "Agent control receipt not found");
    let output: unknown;
    if (name === "context") {
      const session = await createRunSession(tx, workspaceId, "module", ports.now(), { moduleId: principal.caller.moduleId });
      await tx.agentContext.create({ data: { sessionId: session.id, workspaceId, moduleId: principal.caller.moduleId, hash: principal.caller.hash } });
      output = { contextId: session.id };
    } else if (name === "run") {
      const context = await ownedContext(tx, principal, String(args.contextId));
      if (context.status !== "active") throw new CallError("conflict", "Agent context is not active");
      const active = await tx.run.findFirst({ where: { workspaceId, sessionId: context.id, OR: [{ status: { in: ["queued", "running"] } }, { stopStatus: "unknown" }] }, select: { id: true } });
      if (active) throw new CallError("conflict", "Agent context already has an active run");
      const run = await createRuns(ports, workspaceId).enqueue({ sessionId: context.id, lane: args.lane as "foreground" | "background", trigger: "source", prompt: String(args.prompt) }, tx);
      await tx.agentRunAdmission.create({ data: { runId: run.id, moduleId: principal.caller.moduleId, hash: principal.caller.hash, targets: args.tools as string[], content: args.content as string[] } });
      output = view(run);
    } else {
      const run = await ownedRun(tx, principal, String(args.runId));
      if (name === "respond") await validateExecutionAnswer(ports, tx, { workspaceId, runId: run.id, requestId: String(args.questionId), answer: answer! });
      if (name === "interrupt") {
        await tx.run.updateMany({ where: { id: run.id, cancelRequestedAt: null }, data: { cancelRequestedAt: ports.now() } });
        if (run.status === "queued") await tx.run.update({ where: { id: run.id }, data: { status: "cancelled", stopStatus: "confirmed", endedAt: ports.now() } });
        output = { perform: run.status === "running", operationId: run.id, result: view(run.status === "queued" ? { ...run, status: "cancelled", stopStatus: "confirmed" } : run) };
      } else {
        if (run.status !== "running") throw new CallError("conflict", "Agent run is not running");
        output = { perform: true, operationId: run.id, result: { accepted: true } };
      }
    }
    await tx.agentCommand.create({ data: { id: key, workspaceId, moduleId: principal.caller.moduleId, hash: principal.caller.hash, operation: name, requestDigest: hash, output: output as Prisma.InputJsonValue, settled: !["write", "interrupt", "respond"].includes(name), createdAt: ports.now() } });
    return { output, duplicate: false };
  });
  if (result.duplicate) {
    if (name === "respond") return { accepted: true };
    if (name === "write" || name === "interrupt") return { ...(result.output as object), perform: false };
    return result.output;
  }
  async function applyEffects() {
    if (name === "run") void ports.onQueued?.().catch(() => {});
    if (name === "respond") {
      await createProviderControl(ports, workspaceId).answer(String(args.questionId), answer!);
      await admitContextPrimitive(ports, principal, name, args, true);
      return { accepted: true };
    }
    if (name === "interrupt" && !(result.output as { perform: boolean }).perform) await ports.onRunFinished?.(workspaceId, String(args.runId));
    return result.output;
  }
  return applyEffects();
}
