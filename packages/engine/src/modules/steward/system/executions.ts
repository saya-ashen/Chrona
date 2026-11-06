import { executionToolContracts, EXECUTION_UNRECORDED_TOOLS, type ExecutionStart, type ExecutionCommand, type ExecutionPrincipal } from "@chrona/contracts/steward";
import { CallError, type SystemModule } from "../module-calls";
import { resolveExecutionPrincipal } from "../execution-principal";
import { handleExecutionV2Tool } from "../execution-v2-tools";
import type { StewardPorts } from "../ports";
import { json } from "./shared";

async function history(ports: StewardPorts, principal: ExecutionPrincipal, service: NonNullable<StewardPorts["executions"]>, name: string, args: Record<string, unknown>) {
  if (!ports.executionEvents) throw new CallError("unavailable", "Execution history unavailable");
  const view = await service.get(principal, args.workId as string);
  if (view.runId !== args.runId || view.attemptId !== args.attemptId) throw new CallError("conflict", "Execution reference mismatch");
  const ref = { workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId };
  if (name === "snapshot") return json(await ports.executionEvents.snapshot(principal, ref));
  return json(await ports.executionEvents.read(principal, { ...ref, cursor: args.cursor as string | undefined, limit: args.limit as number, waitMs: args.waitMs as number }));
}

export const executions: SystemModule = {
  name: "executions", description: "Run-backed project execution and bounded normalized history.",
  tools: executionToolContracts, unrecorded: [...EXECUTION_UNRECORDED_TOOLS],
  async handle({ ports, workspaceId, caller }, name, args) {
    const principal = await resolveExecutionPrincipal(ports, workspaceId, caller);
    if (["start-v2", "placement", "locations", "workspace-cleanup"].includes(name)) return json(await handleExecutionV2Tool(ports, principal, name, args));
    const service = ports.executions;
    if (!service) throw new CallError("unavailable", "Execution service unavailable");
    if (name === "start") return json(await service.start(principal, args as ExecutionStart));
    if (name === "get") return json(await service.get(principal, args.workId as string));
    if (name === "lookup-start") return json(await service.lookupStart(principal, args.commandKey as string));
    if (name === "result-source") return json(await service.resultSource(principal, args as { workId: string; runId: string; attemptId: string }));
    if (name === "list") return json(await service.list(principal, args as { after?: string; limit: number }));
    if (name === "send") { await service.send(principal, { ...args, op: "send" } as Extract<ExecutionCommand, { op: "send" }>); return { accepted: true }; }
    if (name === "answer") { await service.answer(principal, { ...args, op: "answer" } as Extract<ExecutionCommand, { op: "answer" }>); return { accepted: true }; }
    if (name === "cancel") return json(await service.cancel(principal, { ...args, op: "cancel" } as Extract<ExecutionCommand, { op: "cancel" }>));
    if (["events", "snapshot"].includes(name)) return history(ports, principal, service, name, args);
    throw new CallError("not_found", "Execution tool not found");
  },
};
