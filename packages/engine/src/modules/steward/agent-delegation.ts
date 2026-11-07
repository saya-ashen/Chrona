import { z } from "zod";
import type { StewardPorts } from "./ports";
import type { CallOrigin } from "./module-calls";
import { CallError } from "./module-call-error";
import { isAgentApplication } from "./agent-application";
import { callerManifest, json, tool } from "./system/shared";
import { reserveCompletion, finishCompletion } from "./module-model-budget";
import { assertExecutionPrincipal } from "./execution-principal";
import type { ExecutionPrincipal, ExecutionStart, ExecutionView } from "@chrona/contracts/steward";
import { moduleAgentInput } from "./builtin/agent/module-contracts";
import { agentCaller } from "./agent-caller-context";

export const agentDelegationTools = [tool("agent-admit", "Builtin Agent execution admission for a live module call", {}, [], { visibility: ["modules"], input: z.object({ callId: z.string(), operation: z.enum(["start", "status", "inject", "abort", "release", "transcript", "complete"]), execution: z.unknown().optional() }).strict(), output: z.unknown() }),
  tool("agent-settle", "Builtin Agent model reservation settlement", {}, [], { visibility: ["modules"], input: z.object({ reservationId: z.string(), result: z.object({ text: z.string(), inputTokens: z.number().nullable(), outputTokens: z.number().nullable() }).strict().optional(), failed: z.boolean() }).strict(), output: z.null() })];
async function reserveModel(ports: StewardPorts, context: NonNullable<ReturnType<typeof agentCaller>>, input: Record<string, unknown>) {
  const { origin } = context, { caller } = origin;
  const manifest = await callerManifest(ports.db, caller);
  if (!manifest) throw new CallError("forbidden", "Agent caller manifest unavailable");
  const reservation = await reserveCompletion(ports, { workspaceId: origin.workspaceId, moduleId: caller.moduleId, hash: caller.hash, manifest, ...origin.run }, input as { prompt: string; system?: string; maxOutputTokens: number }, ports.now());
  if (reservation.error) throw new CallError(reservation.error === "unconfigured" ? "unavailable" : "forbidden", `${reservation.error}: module model call`);
  return json({ reservationId: reservation.id, model: reservation.model, thinking: reservation.thinking, timeoutMs: reservation.settings!.timeoutMs });
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
  if (name === "agent-settle") {
    await finishCompletion(ports, workspaceId, { id: String(args.reservationId), result: args.result as { text: string; inputTokens: number | null; outputTokens: number | null } | undefined, error: args.failed ? "provider_error" : null });
    return null;
  }
  const context = agentCaller(ports, String(args.callId));
  if (!context || context.origin.workspaceId !== workspaceId || context.name !== args.operation) throw new CallError("forbidden", "Agent caller context expired or mismatched");
  const { caller: original } = context.origin;
  const principal: ExecutionPrincipal = { workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: original.moduleId, hash: original.hash } };
  await assertExecutionPrincipal(ports.db, principal);
  const input = moduleAgentInput(context.name, context.args) as Record<string, unknown>;
  if (context.name === "complete") return reserveModel(ports, context, input);
  if (context.name === "release" && !args.execution) return { released: true };
  return executionControl(ports, principal, context.name, input, args.execution as ExecutionView | undefined);
}
