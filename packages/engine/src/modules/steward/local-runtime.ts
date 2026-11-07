import type { ProviderAdapter, ProviderRunInput } from "@chrona/contracts/steward";
import { runtimeOutcomeSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { callSync, kernelOrigin } from "./module-calls";
import { registerProviderModule, registerProviderCallbacks, retainProviderCallbacks } from "./local-provider";

export function registerLocalRuntime() { registerProviderModule(); registerProviderCallbacks(); }
export async function runtimeCall<T>(ports: StewardPorts, workspaceId: string, target: string, args: Record<string, unknown>): Promise<T> {
  registerLocalRuntime();
  return (await callSync(ports, kernelOrigin(workspaceId), target, args)).output as T;
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
      return runtimeOutcomeSchema.parse(await runtimeCall(ports, workspaceId, "agent.wait", { operationId }));
    } finally {
      callback.release();
      await runtimeCall(ports, workspaceId, "agent.release", { operationId }).catch(() => {});
    }
  })();
  void done.catch(() => {});
  return { done,
    async inject(message, images) { await runtimeCall(ports, workspaceId, "agent.inject", { operationId, message, ...(images ? { images } : {}) }); },
    async abort() { await runtimeCall(ports, workspaceId, "agent.abort", { operationId }); },
  };
}
