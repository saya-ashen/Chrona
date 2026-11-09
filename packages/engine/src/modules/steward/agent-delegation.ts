import type { StewardPorts } from "./ports";
import type { CallOrigin } from "./module-call-types";
import { CallError } from "./module-call-error";
import { isAgentApplication } from "./agent-application";
import { callerManifest, json } from "./system/shared";
import { reserveCompletion, finishCompletion } from "./module-model-budget";
import { assertExecutionPrincipal } from "./execution-principal";
import type { ExecutionPrincipal, ExecutionStart, ExecutionView } from "@chrona/contracts/steward";
import { moduleAgentInput, primitiveInput, isAgentPrimitive, moduleManifestSchema } from "@chrona/contracts/steward";
import { agentCaller } from "./agent-caller-context";
import { admitContextPrimitive } from "./agent-context";
import { admitAgentPrimitive } from "./agent-primitives";
import { admitted } from "./module-call-admission";
import { admitAgentProjects } from "./agent-projects";

async function reserveModel(ports: StewardPorts, context: NonNullable<ReturnType<typeof agentCaller>>, input: Record<string, unknown>) {
  const { origin } = context, { caller } = origin;
  if (caller.kind !== "module") throw new CallError("forbidden", "Model admission requires a module caller");
  const manifest = await callerManifest(ports.db, caller);
  if (!manifest) throw new CallError("forbidden", "Agent caller manifest unavailable");
  const reservation = await reserveCompletion(ports, { workspaceId: origin.workspaceId, moduleId: caller.moduleId, hash: caller.hash, manifest, ...origin.run }, input as { prompt: string; system?: string; maxOutputTokens: number }, ports.now());
  if (reservation.error) throw new CallError(reservation.error === "unconfigured" ? "unavailable" : "forbidden", `${reservation.error}: module model call`);
  return json({ reservationId: reservation.id, declaredTier: reservation.declaredTier, effectiveHardLimits: reservation.effectiveHardLimits });
}
async function executionControl(ports: StewardPorts, principal: ExecutionPrincipal, name: string, input: Record<string, unknown>, ref?: ExecutionView) {
  const service = ports.executions;
  if (!service) throw new CallError("unavailable", "Execution service unavailable");
  if (name === "start") return json(await service.start(principal, input as ExecutionStart));
  if (!ref) throw new CallError("invalid", "Execution reference required");
  const current = await service.get(principal, ref.workId);
  if (current.attemptId !== ref.attemptId || current.runId !== ref.runId || current.sessionId !== ref.sessionId) throw new CallError("conflict", "Agent execution reference changed");
  if (name === "status") return json(current);
  if (name === "release") {
    if (!current.stopConfirmed) throw new CallError("conflict", "Agent completion remains unconfirmed");
    return { released: true };
  }
  if (name === "transcript") return executionHistory(ports, principal, ref, input);
  return executionEffect(service, principal, name, input, ref);
}
function executionEffect(service: NonNullable<StewardPorts["executions"]>, principal: ExecutionPrincipal, name: string, input: Record<string, unknown>, ref: ExecutionView) {
  const commandKey = String(input.commandKey);
  if (name === "inject" || name === "abort") {
    return service.admitControl(principal, name === "inject" ? { op: "send", ...ref, commandKey, text: String(input.message) } : { op: "cancel", ...ref, commandKey });
  }
  throw new CallError("not_found", "Unknown Agent admission operation");
}
async function executionHistory(ports: StewardPorts, principal: ExecutionPrincipal, ref: ExecutionView, input: Record<string, unknown>) {
  if (!ports.executionEvents) throw new CallError("unavailable", "Execution history unavailable");
  return json(await ports.executionEvents.read(principal, { workId: ref.workId, sessionId: ref.sessionId, runId: ref.runId, attemptId: ref.attemptId, ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}), limit: Number(input.limit), waitMs: 0 }));
}
export async function delegateAgent(ports: StewardPorts, workspaceId: string, caller: CallOrigin["caller"], name: string, args: Record<string, unknown>) {
  if (caller.kind !== "module" || !await isAgentApplication(ports, caller, workspaceId)) throw new CallError("forbidden", "Only the builtin Agent can delegate admission");
  if (name === "agent-settle") return settleModel(ports, workspaceId, args);
  const context = agentCaller(ports, String(args.callId));
  if (!context) throw new CallError("forbidden", "Agent caller context expired or mismatched");
  validateContext(context, workspaceId, args.operation);
  const { caller: original } = context.origin;
  if (context.name === "configure") {
    return authorizeConfiguration(ports, workspaceId, caller, original);
  }
  if (context.name === "projects") {
    return delegateProjects(ports, workspaceId, original, context.args, args);
  }
  if (original.kind !== "module") throw new CallError("forbidden", "Agent execution requires a module caller");
  const principal: ExecutionPrincipal = { workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: original.moduleId, hash: original.hash } };
  await assertExecutionPrincipal(ports.db, principal);
  if (args.settle === true) return settleControl(ports, principal, context);
  if (isAgentPrimitive(context.name)) return json(await admitAgentPrimitive(ports, principal, context.name, context.args));
  return delegateLegacyControl(ports, principal, context, args);
}

async function delegateLegacyControl(ports: StewardPorts, principal: ExecutionPrincipal, context: NonNullable<ReturnType<typeof agentCaller>>, args: Record<string, unknown>) {
  const input = moduleAgentInput(context.name, context.args) as Record<string, unknown>;
  if (context.name === "complete") return reserveModel(ports, context, input);
  if (context.name === "release" && !args.execution) return { released: true };
  return executionControl(ports, principal, context.name, input, args.execution as ExecutionView | undefined);
}

async function delegateProjects(ports: StewardPorts, workspaceId: string, original: CallOrigin["caller"], input: Record<string, unknown>, admission: Record<string, unknown>) {
  if ("settle" in admission || "execution" in admission) throw new CallError("invalid", "Unexpected Agent projects admission arguments");
  return json(await admitAgentProjects(ports, workspaceId, original, input));
}

async function settleModel(ports: StewardPorts, workspaceId: string, args: Record<string, unknown>) {
  await finishCompletion(ports, workspaceId, { id: String(args.reservationId), result: args.result as { text: string; inputTokens: number | null; outputTokens: number | null } | undefined, error: args.failed ? "provider_error" : null });
  return null;
}

async function settleControl(ports: StewardPorts, principal: ExecutionPrincipal, context: NonNullable<ReturnType<typeof agentCaller>>) {
    if (context.name !== "write" && context.name !== "interrupt") throw new CallError("invalid", "Unexpected Agent settlement");
    const input = primitiveInput(context.name, context.args);
    if ("executionId" in input) throw new CallError("invalid", "Unexpected execution settlement");
    await admitContextPrimitive(ports, principal, context.name, input, true);
    return null;
  }

function validateContext(context: NonNullable<ReturnType<typeof agentCaller>>, workspaceId: string, operation: unknown) {
  if (context.origin.workspaceId !== workspaceId || context.name !== operation) throw new CallError("forbidden", "Agent caller context expired or mismatched");
}

async function authorizeConfiguration(ports: StewardPorts, workspaceId: string, caller: Extract<CallOrigin["caller"], { kind: "module" }>, original: CallOrigin["caller"]) {
    const module = await ports.db.module.findFirst({ where: { workspaceId, id: caller.moduleId, name: "agent", builtin: true, status: "active", activeHash: caller.hash } });
    const version = module ? await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: caller.hash } } }) : null;
    const manifest = version?.status === "approved" ? moduleManifestSchema.safeParse(version.manifest).data : undefined;
    const tool = manifest?.tools.find(tool => tool.name === "configure");
    if (!tool?.visibility.includes("owner") || !await admitted(ports.db, original, tool, workspaceId)) throw new CallError("forbidden", "Agent configuration requires current owner authority");
    return { authorized: true };
}
