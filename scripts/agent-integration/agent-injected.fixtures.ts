import { CallError } from "../../packages/engine/src/modules/steward/module-call-error";
import { z } from "zod";
import { admitContextPrimitive } from "../../packages/engine/src/modules/steward/agent-context";
import { liveRuns } from "../../packages/engine/src/modules/steward/runs";
import { createAgentPrimitives } from "../../packages/engine/src/modules/steward/builtin/agent/primitives";
import { primitiveInputs, primitiveOutputs, primitiveInput, type AgentPrimitive } from "@chrona/contracts/steward";
import { resolveExecutionPrincipal } from "../../packages/engine/src/modules/steward/execution-principal";
import { admitAgentPrimitive } from "../../packages/engine/src/modules/steward/agent-primitives";
import type { SystemTool, SystemModule } from "../../packages/engine/src/modules/steward/module-system-types";
import { json } from "../../packages/engine/src/modules/steward/system/shared";

/** Explicit in-memory Provider embedding seam; shipped runtimes use the independent SDK Agent. */
export const injectedAgentTools: SystemTool[] = Object.keys(primitiveInputs).map(name => ({ name, description: "Injected Agent execution primitive", visibility: ["modules"], idempotent: false, parameters: { type: "object", properties: {}, required: [] }, input: z.record(z.string(), z.unknown()), output: primitiveOutputs[name as AgentPrimitive] }));
export const injectedAgentPrimitive: SystemModule["handle"] = async ({ ports, workspaceId, caller }, operation, raw) => {
  const name = operation as AgentPrimitive;
  let input: ReturnType<typeof primitiveInput>;
  try { input = primitiveInput(name, raw); }
  catch { throw new CallError("invalid", "Invalid Agent primitive input"); }
  const resolved = await resolveExecutionPrincipal(ports, workspaceId, caller);
  const context = name === "context" || "contextId" in input || ("runId" in input && !("executionId" in input));
  const principal = context && caller.kind === "module" ? { ...resolved, caller: { kind: "module" as const, moduleId: caller.moduleId, hash: caller.hash } } : resolved;
  if (!("executionId" in input) && ["stream", "write", "interrupt"].includes(name)) {
    const invoke = createAgentPrimitives(async (_target, args) => args.settle
      ? admitContextPrimitive(ports, principal, name, input, true)
      : admitAgentPrimitive(ports, principal, name, input), async (control, args) => {
      const handle = liveRuns.get(args.operationId);
      if (!handle) throw new CallError("unknown", "Injected Agent handle is unavailable");
      if (control === "inject") await handle.inject(args.message!); else await handle.abort();
    }, descriptor => ports.provider?.transcript?.(descriptor) ?? Promise.resolve([]));
    return json(await invoke(name, input, "injected"));
  }
  // The injected Provider lives in the kernel process, so its existing control service owns the effect.
  if ("executionId" in input && ["write", "interrupt"].includes(name)) {
    const scope = input as { executionId: string; runId: string; attemptId: string; requestKey: string; text?: string };
    const service = ports.executions!;
    const view = await service.get(principal, scope.executionId);
    const ref = { workId: view.workId, sessionId: view.sessionId, runId: scope.runId, attemptId: scope.attemptId, commandKey: scope.requestKey };
    if (name === "write") { await service.send(principal, { op: "send", ...ref, text: scope.text! }); return { accepted: true }; }
    return json(await service.cancel(principal, { op: "cancel", ...ref }));
  }
  return json(await admitAgentPrimitive(ports, principal, name, input));
};
