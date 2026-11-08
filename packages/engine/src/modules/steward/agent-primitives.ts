import { admitContextPrimitive } from "./agent-context";
import { providerAnswerSchema } from "@chrona/contracts/steward";
import type { ExecutionPrincipal, ExecutionStart, ExecutionStartV2 } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError } from "./module-call-error";
import { handleExecutionV2Tool } from "./execution-v2-tools";
import { primitiveInput, type AgentPrimitive } from "./builtin/agent/primitives";

/** Admission and durable evidence only. Business sessions and result organization belong to callers. */
export async function admitAgentPrimitive(ports: StewardPorts, principal: ExecutionPrincipal, name: AgentPrimitive, raw: unknown) {
  const input = primitiveInput(name, raw);
  if (name === "context" || "contextId" in input || ("runId" in input && !("executionId" in input))) return admitContextPrimitive(ports, principal, name, input);
  const service = ports.executions;
  if (!service) throw new CallError("unavailable", "Execution service unavailable");
  if (name === "run") {
    const { executionId, requestKey, prompt, ...scope } = input as ReturnType<typeof primitiveInput> & { executionId: string; requestKey: string; prompt: string };
    const request = { ...scope, workId: executionId, commandKey: requestKey, goal: prompt };
    if ("placement" in scope) return handleExecutionV2Tool(ports, principal, "start-v2", request as ExecutionStartV2);
    return { execution: await service.start(principal, request as ExecutionStart) };
  }
  if (name === "lookup") return service.lookupStart(principal, (input as { requestKey: string }).requestKey);
  if (name === "locations" || name === "cleanup") return handleExecutionV2Tool(ports, principal, name === "cleanup" ? "workspace-cleanup" : name, input);
  const args = input as { executionId: string; runId?: string; attemptId?: string; requestKey?: string; text?: string; questionId?: string; answer?: unknown; cursor?: string; limit?: number };
  const view = await service.get(principal, args.executionId);
  if (name === "get") {
    if ((args.runId && args.runId !== view.runId) || (args.attemptId && args.attemptId !== view.attemptId)) throw new CallError("conflict", "Agent execution reference changed");
    return view;
  }
  if (name === "placement") return handleExecutionV2Tool(ports, principal, name, { workId: view.workId });
  if (args.runId !== view.runId || args.attemptId !== view.attemptId) throw new CallError("conflict", "Agent execution reference changed");
  const ref = { workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId };
  if (name === "stream" || name === "inspect") {
    if (!ports.executionEvents) throw new CallError("unavailable", "Execution events unavailable");
    if (name === "stream") return ports.executionEvents.read(principal, { ...ref, cursor: args.cursor, limit: args.limit!, waitMs: 0 });
    return { snapshot: await ports.executionEvents.snapshot(principal, ref), source: await service.resultSource(principal, ref) };
  }
  if (name === "respond") {
    await service.answer(principal, { ...ref, op: "answer", commandKey: args.requestKey!, requestId: args.questionId!, answer: parseAnswer(args.answer) });
    return { accepted: true };
  }
  const command = name === "write" ? { ...ref, op: "send" as const, commandKey: args.requestKey!, text: args.text! } : { ...ref, op: "cancel" as const, commandKey: args.requestKey! };
  // Server handles live in Agent. Remote controls use the existing authenticated executor transport.
  const attempt = await ports.db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId }, select: { executorId: true } });
  if (attempt.executorId !== "server") {
    if (command.op === "send") await service.send(principal, command); else await service.cancel(principal, command);
    return { perform: false, operationId: view.runId, execution: await service.get(principal, view.workId) };
  }
  const admitted = await service.admitControl(principal, command);
  return { ...admitted, execution: await service.get(principal, view.workId) };
}

function parseAnswer(raw: unknown) {
  try { return providerAnswerSchema.parse(JSON.parse(String(raw))); }
  catch { throw new CallError("invalid", "Invalid Agent interaction answer"); }
}
