import { startKernelExecution, kernelExecutionPlacement, kernelExecutionLocations, kernelExecutionCleanup } from "./kernel-execution-tools";
import { createExecutionDelivery } from "./execution-delivery";
import { admitContextPrimitive } from "./agent-context";
import { providerAnswerSchema, primitiveInput, type AgentPrimitive } from "@chrona/contracts/steward";
import type { ExecutionPrincipal, ExecutionStart, KernelExecutionStart } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError } from "./module-call-error";
import { isExecutionControlRejected } from "./execution-control-error";

type ExecutionService = NonNullable<StewardPorts["executions"]>;
type ExecutionView = Awaited<ReturnType<ExecutionService["get"]>>;
type ExecutionArgs = { executionId: string; runId?: string; attemptId?: string; requestKey?: string; text?: string; questionId?: string; answer?: unknown; cursor?: string; limit?: number };

function assertOptionalReference(args: ExecutionArgs, view: ExecutionView) {
  if ((args.runId && args.runId !== view.runId) || (args.attemptId && args.attemptId !== view.attemptId)) throw new CallError("conflict", "Agent execution reference changed");
}

/** Admission and durable evidence only. Business sessions and result organization belong to callers. */
export async function admitAgentPrimitive(ports: StewardPorts, principal: ExecutionPrincipal, name: AgentPrimitive, raw: unknown) {
  const input = primitiveInput(name, raw);
  if (name === "context" || "contextId" in input || ("runId" in input && !("executionId" in input))) return admitContextPrimitive(ports, principal, name, input);
  const service = ports.executions;
  if (!service) throw new CallError("unavailable", "Execution service unavailable");
  if (name === "run") {
    const { executionId, requestKey, prompt, ...scope } = input as ReturnType<typeof primitiveInput> & { executionId: string; requestKey: string; prompt: string };
    const request = { ...scope, workId: executionId, commandKey: requestKey, goal: prompt };
    if ("placement" in scope) return startKernelExecution(ports, principal, request as KernelExecutionStart);
    return { execution: await service.start(principal, request as ExecutionStart) };
  }
  if (name === "lookup") return service.lookupStart(principal, (input as { requestKey: string }).requestKey);
  if (name === "locations") return kernelExecutionLocations(ports, principal, input as { after?: string; limit: number });
  if (name === "cleanup") return kernelExecutionCleanup(ports, principal, input as import("@chrona/contracts/steward").KernelCleanupInput);
  return admitExistingExecution(ports, service, principal, name, input as ExecutionArgs);
}

async function admitExistingExecution(ports: StewardPorts, service: ExecutionService, principal: ExecutionPrincipal, name: AgentPrimitive, args: ExecutionArgs) {
  const view = await service.get(principal, args.executionId);
  if (name === "get") {
    assertOptionalReference(args, view);
    return view;
  }
  if (name === "placement") return kernelExecutionPlacement(ports, principal, view.workId);
  if (args.runId !== view.runId || args.attemptId !== view.attemptId) throw new CallError("conflict", "Agent execution reference changed");
  const ref = { workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId };
  if (name === "stream" || name === "inspect") {
    if (!ports.executionEvents) throw new CallError("unavailable", "Execution events unavailable");
    if (name === "stream") return ports.executionEvents.read(principal, { ...ref, cursor: args.cursor, limit: args.limit!, waitMs: 0 });
    return { snapshot: await ports.executionEvents.snapshot(principal, ref), source: await service.resultSource(principal, ref) };
  }
  if (name === "respond") {
    const attempt = await ports.db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } });
    if (attempt.targetBinding) { await createExecutionDelivery(ports).control(principal, view.workId, args.requestKey!, { operation: "answer", requestId: args.questionId!, answer: parseAnswer(args.answer) }); return { accepted: true }; }
    return respondToExecution(service, principal, ref, args);
  }
  const command = name === "write" ? { ...ref, op: "send" as const, commandKey: args.requestKey!, text: args.text! } : { ...ref, op: "cancel" as const, commandKey: args.requestKey! };
  return admitExecutionControl(ports, service, principal, command, view);
}

async function respondToExecution(service: ExecutionService, principal: ExecutionPrincipal, ref: Pick<ExecutionView, "workId" | "sessionId" | "runId" | "attemptId">, args: ExecutionArgs) {
  try {
    await service.answer(principal, { ...ref, op: "answer", commandKey: args.requestKey!, requestId: args.questionId!, answer: parseAnswer(args.answer) });
    return { accepted: true };
  } catch (error) {
    if (isExecutionControlRejected(error)) return { accepted: false, error: { code: error.code, message: error.message } };
    throw error;
  }
}

async function admitExecutionControl(ports: StewardPorts, service: ExecutionService, principal: ExecutionPrincipal, command: Parameters<ExecutionService["admitControl"]>[1], view: ExecutionView) {
  // Local handles live in Agent; application controls use the durable delivery journal.
  const attempt = await ports.db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId }, select: { executorId: true, targetBinding: true } });
  if (attempt.targetBinding) {
    await createExecutionDelivery(ports).control(principal, view.workId, command.commandKey, command.op === "send" ? { operation: "write", text: command.text } : { operation: "cancel" });
    return { perform: false, operationId: view.runId, execution: await service.get(principal, view.workId) };
  }
  const admitted = await service.admitControl(principal, command);
  return { ...admitted, execution: await service.get(principal, view.workId) };
}

function parseAnswer(raw: unknown) {
  try { return providerAnswerSchema.parse(JSON.parse(String(raw))); }
  catch { throw new CallError("invalid", "Invalid Agent interaction answer"); }
}
