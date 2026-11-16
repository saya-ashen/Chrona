import type { Prisma } from "@chrona/db";
import { providerAnswerSchema, type ExecutionPrincipal } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError } from "./module-call-error";
import { createProviderControl } from "./provider-channel";
import { assertApprovedAgentPrincipal } from "./agent-context-admission";
import { selectContextTools } from "./agent-context-tools";
import { selectAgentProvider, providerView, type ProviderBinding } from "./agent-provider";
import { contextDigest, contextRequestDigest, modulePrincipal, ownedContext, type ModulePrincipal } from "./agent-context-state";
import { executeContextCommand, type ContextCommand } from "./agent-context-admission";

export { ownedRun, view, type ModulePrincipal } from "./agent-context-state";

async function selectContextProvider(ports: StewardPorts, principal: ModulePrincipal, args: Record<string, unknown>) {
  let providerId = args.providerId as string | undefined;
  if (args.contextId) {
    const context = await ownedContext(ports.db, principal, String(args.contextId));
    if (!context.providerId || !context.providerRevision) throw new CallError("conflict", "Context has no registered provider binding");
    if (providerId && context.providerId !== providerId) throw new CallError("conflict", "Context provider cannot change");
    providerId = context.providerId;
    const previous = await ports.db.agentRunProvider.findFirst({ where: { run: { workspaceId: principal.workspaceId, sessionId: context.id }, providerId, revision: context.providerRevision }, orderBy: { run: { createdAt: "desc" } } });
    if (!previous || !(await providerView(ports, principal.workspaceId, previous)).available) throw new CallError("unavailable", "Context provider revision is unavailable");
    return previous;
  }
  return selectAgentProvider(ports, principal.workspaceId, providerId);
}

async function registeredRunReceipt(ports: StewardPorts, principal: ModulePrincipal, args: Record<string, unknown>) {
  const prior = await ports.db.agentCommand.findUnique({ where: { id: `agent-command:${contextDigest([principal.workspaceId, principal.caller.moduleId, "run", args.requestKey])}` } });
  if (!prior) return;
  await assertApprovedAgentPrincipal(ports.db, principal);
  if (prior.hash !== principal.caller.hash || prior.requestDigest !== contextRequestDigest(args)) throw new CallError("conflict", "Agent request identity changed");
  return prior;
}

async function selectRunTools(ports: StewardPorts, principal: ModulePrincipal, args: Record<string, unknown>) {
  const selection = await selectContextTools(ports, principal, args.tools as import("@chrona/contracts/steward").RoutedTarget[]);
  if ((args.content as string[]).some(ref => !ref.startsWith(`${selection.caller.module}/`))) throw new CallError("forbidden", "Agent input content must belong to the originating module");
  return selection;
}

function parseAnswer(raw: unknown) {
  try { return providerAnswerSchema.parse(raw); }
  catch { throw new CallError("invalid", "Invalid Agent interaction answer"); }
}

function duplicateOutput(name: string, output: unknown) {
  if (name === "respond") return { accepted: true };
  if (name === "write" || name === "interrupt" || name === "native") return { ...(output as object), perform: false };
  return output;
}

async function applyEffects(ports: StewardPorts, command: ContextCommand, output: unknown) {
  const { principal, name, args, answer } = command;
  const { workspaceId } = principal;
  if (name === "run") void ports.onQueued?.().catch(() => {});
  if (name === "respond") {
    await createProviderControl(ports, workspaceId).answer(String(args.questionId), answer!);
    await admitContextPrimitive(ports, principal, name, args, true);
    return { accepted: true };
  }
  if (name === "interrupt" && !(output as { perform: boolean }).perform) await ports.onRunFinished?.(workspaceId, String(args.runId));
  return output;
}

/** Kernel retains only scoped context identity, admission receipts and durable Run evidence. */
export async function admitContextPrimitive(ports: StewardPorts, rawPrincipal: ExecutionPrincipal, name: string, args: Record<string, unknown>, ...[settle = false, settledOutput]: [settle?: boolean, settledOutput?: Prisma.InputJsonValue]) {
  const principal = modulePrincipal(rawPrincipal);
  let binding: ProviderBinding | undefined;
  if (name === "run" && args.providerRegistration === true) {
    const prior = await registeredRunReceipt(ports, principal, args);
    if (prior) return prior.output;
    binding = await selectContextProvider(ports, principal, args);
  }
  const selection = name === "run" ? await selectRunTools(ports, principal, args) : undefined;
  const answer = name === "respond" ? parseAnswer(args.answer) : undefined;
  const command: ContextCommand = { principal, name, args, settle, settledOutput, binding, selection, answer };
  const result = await ports.db.$transaction(tx => executeContextCommand(ports, tx, command));
  if (result.duplicate) return duplicateOutput(name, result.output);
  return applyEffects(ports, command, result.output);
}
