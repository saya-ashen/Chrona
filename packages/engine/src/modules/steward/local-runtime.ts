import type { ProviderAdapter, ProviderRunInput } from "@chrona/contracts/steward";
import { runtimeOutcomeSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { callSync, kernelOrigin } from "./module-calls";
import { registerProviderCallbacks, retainProviderCallbacks } from "./local-provider";
import { registerBuiltins } from "./module-builtin";
import { CallError } from "./module-calls";

const active = new WeakMap<StewardPorts["db"], Set<ReturnType<ProviderAdapter["start"]>>>();
export async function stopAgentRuns(ports: StewardPorts) {
  await Promise.all([...(active.get(ports.db) ?? [])].map(async handle => { await handle.abort(); await handle.done; }));
}
export function registerLocalRuntime() { registerProviderCallbacks(); }
export async function runtimeCall<T>(ports: StewardPorts, workspaceId: string, target: string, args: Record<string, unknown>): Promise<T> {
  registerLocalRuntime();
  if (target.startsWith("agent.") && ports.agentApplication) {
    await registerBuiltins(ports, workspaceId);
    return (await callSync(ports, kernelOrigin(workspaceId), target, { input: JSON.stringify(args) })).output as T;
  }
  return (await callSync(ports, kernelOrigin(workspaceId), target, args)).output as T;
}
/** Only the module's final response proves Provider completion; cancelling a launch gate never does. */
export async function startLocalProvider(ports: StewardPorts, workspaceId: string, input: ProviderRunInput): Promise<ReturnType<ProviderAdapter["start"]>> {
  let settle!: (outcome: import("@chrona/contracts/steward").RuntimeEvent & { kind: "settled" }) => void;
  const completion = new Promise<import("@chrona/contracts/steward").RuntimeEvent & { kind: "settled" }>(resolve => { settle = resolve; });
  const callback = retainProviderCallbacks(ports, workspaceId, { events: input.events, detail: input.detail, operationId: input.runId, settled: settle });
  const { events: _events, detail: _detail, deadline, ...request } = input;
  const operationId = input.runId;
  try { await runtimeCall(ports, workspaceId, "agent.start", { ...request, operationId, deadline: deadline?.toISOString() ?? null, callbacks: callback.id }); }
  catch (error) { callback.release(); throw error; }
  const done = (async () => {
    try {
      if (!ports.agentApplication) return runtimeOutcomeSchema.parse(await runtimeCall(ports, workspaceId, "agent.wait", { operationId }));
      for (;;) {
        // Events are the fast path; a lost wake is reconciled against the durable Agent receipt.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const wake = await Promise.race([completion, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 5_000); })]).finally(() => clearTimeout(timer));
        if (wake) return wake.outcome;
        const status = await runtimeCall<{ outcome: unknown; failure: boolean }>(ports, workspaceId, "agent.status", { operationId });
        if (status.outcome) return runtimeOutcomeSchema.parse(status.outcome);
        if (status.failure) throw new CallError("unknown", "Agent completion requires reconciliation");
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
