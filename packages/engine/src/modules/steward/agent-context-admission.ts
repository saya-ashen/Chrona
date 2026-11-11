import type { Prisma } from "@chrona/db";
import { moduleManifestSchema, type providerAnswerSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError } from "./module-call-error";
import { assertExecutionPrincipal } from "./execution-principal";
import { createRuns, createRunSession } from "./runs";
import { validateExecutionAnswer } from "./provider-channel";
import { moduleCallbackContractHash } from "./module-tool-contract";
import type { selectContextTools } from "./agent-context-tools";
import { assertProviderBinding, providerSnapshot, type ProviderBinding } from "./agent-provider";
import { reserveCompletionIn, refused } from "./module-model-budget";
import { contextDigest, contextRequestDigest, view, ownedContext, ownedRun, type ModulePrincipal } from "./agent-context-state";

export type ContextCommand = {
  principal: ModulePrincipal;
  name: string;
  args: Record<string, unknown>;
  settle: boolean;
  settledOutput?: Prisma.InputJsonValue;
  selection?: Awaited<ReturnType<typeof selectContextTools>>;
  binding?: ProviderBinding;
  answer?: ReturnType<typeof providerAnswerSchema.parse>;
};
type CommandReceipt = Prisma.AgentCommandGetPayload<Record<string, never>>;

/** A lifecycle fence may block new work, but not cancellation of this exact version's own admitted Run. */
export async function assertAgentInterruptPrincipal(tx: Prisma.TransactionClient, principal: ModulePrincipal, runId: string) {
  const { workspaceId, caller } = principal;
  const module = await tx.module.findFirst({ where: { workspaceId, id: caller.moduleId, activeHash: caller.hash, status: "active", versions: { some: { hash: caller.hash, status: "approved" } } }, select: { id: true } });
  if (!module) throw new CallError("forbidden", "Agent stop caller is no longer its approved active module");
  await ownedRun(tx, principal, runId);
}

async function replayReceipt(tx: Prisma.TransactionClient, receipt: CommandReceipt, command: ContextCommand) {
  const { principal, name, args, settle, settledOutput } = command;
  if (receipt.hash !== principal.caller.hash) throw new CallError("forbidden", "Agent command belongs to another module version");
  if (receipt.requestDigest !== contextRequestDigest(args)) throw new CallError("conflict", "Agent request identity changed");
  if (settle) {
    await tx.agentCommand.update({ where: { id: receipt.id }, data: { settled: true, ...(settledOutput === undefined ? {} : { output: settledOutput }) } });
  } else if (["write", "interrupt", "respond", "native"].includes(name) && !receipt.settled) throw new CallError("unknown", "Agent control outcome requires reconciliation");
  return { output: receipt.output, duplicate: true };
}

async function createContext(ports: StewardPorts, tx: Prisma.TransactionClient, principal: ModulePrincipal) {
  const session = await createRunSession(tx, principal.workspaceId, "module", ports.now(), { moduleId: principal.caller.moduleId });
  await tx.agentContext.create({ data: { sessionId: session.id, workspaceId: principal.workspaceId, moduleId: principal.caller.moduleId, hash: principal.caller.hash } });
  return { contextId: session.id };
}

async function runContext(ports: StewardPorts, tx: Prisma.TransactionClient, command: ContextCommand) {
  const { principal, args, binding } = command;
  if (!binding || args.contextId) return ownedContext(tx, principal, String(args.contextId));
  const session = await createRunSession(tx, principal.workspaceId, "module", ports.now(), { moduleId: principal.caller.moduleId });
  await tx.agentContext.create({ data: { sessionId: session.id, workspaceId: principal.workspaceId, moduleId: principal.caller.moduleId, hash: principal.caller.hash, providerId: binding.providerId, providerRevision: binding.revision } });
  return { ...session, providerId: binding.providerId, providerRevision: binding.revision };
}

async function assertRunProvider(tx: Prisma.TransactionClient, context: Awaited<ReturnType<typeof runContext>>, command: ContextCommand) {
  const { principal, binding, args } = command;
  if (!binding) return;
  const declaration = await assertProviderBinding(tx, principal.workspaceId, binding);
  if (context.providerId !== binding.providerId || context.providerRevision !== binding.revision) throw new CallError("conflict", "Context provider revision cannot change");
  const kind = args.kind === "completion" ? "completion" : "conversation";
  if (!declaration.capabilities[kind]) throw new CallError("unavailable", `Provider does not support ${kind}`);
  if (args.contextId && !declaration.capabilities.resume && kind === "conversation") throw new CallError("unavailable", "Provider does not support context continuation");
  if ((args.content as string[]).length && !declaration.capabilities.images) throw new CallError("unavailable", "Provider does not support images");
}

async function reserveCompletion(ports: StewardPorts, tx: Prisma.TransactionClient, command: ContextCommand): Promise<Prisma.InputJsonValue | undefined> {
  const { principal, args } = command;
  const { workspaceId } = principal;
  if (args.kind !== "completion") return;
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: principal.caller.moduleId, hash: principal.caller.hash } } });
  const manifest = version?.status === "approved" ? moduleManifestSchema.parse(version.manifest) : null;
  if (!manifest) throw new CallError("forbidden", "Agent caller manifest is unavailable");
  const options = (args.providerOptions ?? {}) as Record<string, unknown>;
  const maxOutputTokens = options.maxOutputTokens === undefined ? 1024 : Number(options.maxOutputTokens);
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 32000) throw new CallError("invalid", "Invalid completion output budget");
  const scope = args.callScope as { moduleRunId?: string; eventKey?: string } | undefined;
  const reservation = await reserveCompletionIn(tx, { workspaceId, moduleId: principal.caller.moduleId, hash: principal.caller.hash, manifest, ...scope }, { prompt: String(args.prompt), maxOutputTokens, ...(typeof options.system === "string" ? { system: options.system } : {}) }, ports.now());
  if (reservation.error) throw refused(reservation.error);
  return { reservationId: reservation.id, limits: reservation.effectiveHardLimits!, maxOutputTokens };
}

async function bindProviderRun(ports: StewardPorts, tx: Prisma.TransactionClient, runId: string, command: ContextCommand) {
  const { binding, args } = command;
  if (!binding) return;
  const completion = await reserveCompletion(ports, tx, command);
  await tx.agentRunProvider.create({ data: { runId, providerId: binding.providerId, moduleId: binding.moduleId, hash: binding.hash, revision: binding.revision, declaration: binding.declaration as Prisma.InputJsonValue, providerOptions: (args.providerOptions ?? {}) as Prisma.InputJsonValue, kind: args.kind === "completion" ? "completion" : "conversation", ...(completion ? { completion } : {}) } });
  await tx.run.update({ where: { id: runId }, data: { provider: providerSnapshot(binding.declaration).id } });
}

async function admitRun(ports: StewardPorts, tx: Prisma.TransactionClient, command: ContextCommand) {
  const { principal, args, selection } = command;
  const { workspaceId } = principal;
  const context = await runContext(ports, tx, command);
  await assertRunProvider(tx, context, command);
  if (context.status !== "active") throw new CallError("conflict", "Agent context is not active");
  const active = await tx.run.findFirst({ where: { workspaceId, sessionId: context.id, OR: [{ status: { in: ["queued", "running"] } }, { stopStatus: "unknown" }] }, select: { id: true } });
  if (active) throw new CallError("conflict", "Agent context already has an active run");
  const run = await createRuns(ports, workspaceId).enqueue({ sessionId: context.id, lane: args.lane as "foreground" | "background", trigger: "source", prompt: String(args.prompt) }, tx);
  await tx.agentRunAdmission.create({ data: { runId: run.id, moduleId: principal.caller.moduleId, hash: principal.caller.hash, targets: selection!.entries.map(entry => ({ target: `${entry.module.name}.${entry.tool.name}`, moduleId: entry.module.id, contractHash: moduleCallbackContractHash(entry.tool) })), content: args.content as string[] } });
  await bindProviderRun(ports, tx, run.id, command);
  return view(run);
}

async function controlRun(ports: StewardPorts, tx: Prisma.TransactionClient, command: ContextCommand) {
  const { principal, name, args, answer } = command;
  const { workspaceId } = principal;
  const run = await ownedRun(tx, principal, String(args.runId));
  if (name === "respond") await validateExecutionAnswer(ports, tx, { workspaceId, runId: run.id, requestId: String(args.questionId), answer: answer! });
  if (name === "interrupt") {
    await tx.run.updateMany({ where: { id: run.id, cancelRequestedAt: null }, data: { cancelRequestedAt: ports.now() } });
    if (run.status === "queued") await tx.run.update({ where: { id: run.id }, data: { status: "cancelled", stopStatus: "confirmed", endedAt: ports.now() } });
    return { perform: run.status === "running" || run.stopStatus === "unknown", operationId: run.id, result: view(run.status === "queued" ? { ...run, status: "cancelled", stopStatus: "confirmed" } : run) };
  }
  if (run.status !== "running" || run.stopStatus === "unknown" || run.cancelRequestedAt) throw new CallError("conflict", "Agent run is not running");
  return { perform: true, operationId: run.id, result: { accepted: true } };
}

async function applyCommand(ports: StewardPorts, tx: Prisma.TransactionClient, command: ContextCommand) {
  if (command.name === "context") return createContext(ports, tx, command.principal);
  if (command.name === "run") return admitRun(ports, tx, command);
  return controlRun(ports, tx, command);
}

function controlSettled(name: string, output: unknown) {
  return !["write", "interrupt", "respond", "native"].includes(name) || name === "interrupt" && !(output as { perform: boolean }).perform;
}

export async function executeContextCommand(ports: StewardPorts, tx: Prisma.TransactionClient, command: ContextCommand) {
  const { principal, name, args, settle } = command;
  const { workspaceId } = principal;
  await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
  if (name === "interrupt") await assertAgentInterruptPrincipal(tx, principal, String(args.runId));
  else await assertExecutionPrincipal(tx, principal);
  const key = `agent-command:${contextDigest([workspaceId, principal.caller.moduleId, name, args.requestKey])}`;
  const hash = contextRequestDigest(args), previous = await tx.agentCommand.findUnique({ where: { id: key } });
  if (previous) return replayReceipt(tx, previous, command);
  if (settle) throw new CallError("not_found", "Agent control receipt not found");
  const output = await applyCommand(ports, tx, command);
  await tx.agentCommand.create({ data: { id: key, workspaceId, moduleId: principal.caller.moduleId, hash: principal.caller.hash, operation: name, requestDigest: hash, output: output as Prisma.InputJsonValue, settled: controlSettled(name, output), createdAt: ports.now() } });
  return { output, duplicate: false };
}
