import type { ProviderAdapter, ProviderRunInput } from "@chrona/contracts/steward";
import { runtimeOutcomeSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { callSync, kernelOrigin } from "./module-calls";
import { registerProviderModule, registerProviderCallbacks, retainProviderCallbacks } from "./local-provider";
import { registerBuiltins } from "./module-builtin";
import { CallError } from "./module-calls";

const active = new WeakMap<StewardPorts["db"], Set<ReturnType<ProviderAdapter["start"]>>>();
export async function stopAgentRuns(ports: StewardPorts) {
  await Promise.all([...(active.get(ports.db) ?? [])].map(async handle => { await handle.abort(); await handle.done; }));
}
export function registerLocalRuntime() { registerProviderCallbacks(); }
export async function runtimeCall<T>(ports: StewardPorts, workspaceId: string, target: string, args: Record<string, unknown>): Promise<T> {
  registerLocalRuntime();
  if (target.startsWith("agent.")) {
    if (ports.agentApplication) {
      await registerBuiltins(ports, workspaceId);
      const result = (await callSync(ports, kernelOrigin(workspaceId), target, { input: JSON.stringify(args) })).output;
      if (target !== "agent.complete") return result as T;
      return await waitAgentCompletion(ports, workspaceId, result as { operationId: string }, Number(args.timeoutMs)) as T;
    }
    // In-memory Provider injection remains a test/embedding seam; released runtimes always use the SDK application.
    registerProviderModule(ports);
  }
  return (await callSync(ports, kernelOrigin(workspaceId), target, args)).output as T;
}
async function waitAgentCompletion(ports: StewardPorts, workspaceId: string, operation: { operationId: string }, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await runtimeCall<{ result: unknown; failure: boolean }>(ports, workspaceId, "agent.completion", operation);
    if (value.failure) throw new CallError("failed", "provider_error");
    if (value.result) return value.result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new CallError("failed", "timeout");
}
/** Only the module's final response proves Provider completion; cancelling a launch gate never does. */
export async function startLocalProvider(ports: StewardPorts, workspaceId: string, input: ProviderRunInput): Promise<ReturnType<ProviderAdapter["start"]>> {
  const callback = retainProviderCallbacks(ports, workspaceId, { events: input.events, detail: input.detail });
  const { events: _events, detail: _detail, deadline, ...request } = input;
  const operationId = input.runId;
  try { await runtimeCall(ports, workspaceId, "agent.start", { ...request, operationId, deadline: deadline.toISOString(), callbacks: callback.id }); }
  catch (error) { callback.release(); throw error; }
  const done = (async () => {
    try {
      if (!ports.agentApplication) return runtimeOutcomeSchema.parse(await runtimeCall(ports, workspaceId, "agent.wait", { operationId }));
      for (;;) {
        const status = await runtimeCall<{ outcome: unknown; failure: boolean }>(ports, workspaceId, "agent.status", { operationId });
        if (status.outcome) return runtimeOutcomeSchema.parse(status.outcome);
        if (status.failure) throw new CallError("unknown", "Agent completion requires reconciliation");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      callback.release();
      await runtimeCall(ports, workspaceId, "agent.release", { operationId }).catch(() => {});
    }
  })();
  void done.catch(() => {});
  const handle = { done,
    async inject(message: string, images?: ProviderRunInput["images"]) { await runtimeCall(ports, workspaceId, "agent.inject", { operationId, message, ...(images ? { images } : {}) }); },
    async abort() { await runtimeCall(ports, workspaceId, "agent.abort", { operationId }); },
  };
  let handles = active.get(ports.db);
  if (!handles) { handles = new Set(); active.set(ports.db, handles); }
  handles.add(handle);
  void done.finally(() => handles!.delete(handle)).catch(() => {});
  return handle;
}
