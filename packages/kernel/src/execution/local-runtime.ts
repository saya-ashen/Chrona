import type { ProviderAdapter, ProviderRunInput, RoutedTarget } from "@chrona/contracts/steward";
import { runtimeOutcomeSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { callSync, kernelOrigin, CallError } from "../modules/module-calls";
import { registerProviderCallbacks, retainProviderCallbacks } from "../agent/local-provider";
import { callProviderEndpoint, runProviderBinding, assertProviderBinding, providerDigest } from "../agent/agent-provider";
import { authenticateRun } from "./run-auth";
import { startProviderCompletion } from "./local-runtime-completion";

const active = new WeakMap<StewardPorts["db"], Set<ReturnType<ProviderAdapter["start"]>>>();
export async function stopAgentRuns(ports: StewardPorts) {
  await Promise.all([...(active.get(ports.db) ?? [])].map(async handle => { await handle.abort(); await handle.done; }));
}
export function registerLocalRuntime() { registerProviderCallbacks(); }
export async function runtimeCall<T>(ports: StewardPorts, workspaceId: string, target: RoutedTarget, args: Record<string, unknown>, options: { key?: string; expectedTarget?: { moduleId: string }; private?: boolean; expectedHash?: string } = {}): Promise<T> {
  registerLocalRuntime();
  return (await callSync(ports, kernelOrigin(workspaceId), target, args, options)).output as T;
}
/** Only a recorded backend outcome proves completion; cancelling a launch gate never does. */
export async function startLocalProvider(ports: StewardPorts, workspaceId: string, input: ProviderRunInput): Promise<ReturnType<ProviderAdapter["start"]>> {
  registerProviderCallbacks();
  const binding = await runProviderBinding(ports, workspaceId, input.runId);
  const declaration = await assertProviderBinding(ports.db, workspaceId, binding);
  const operationId = input.runId;
  const endpoint = <T>(name: keyof typeof declaration.endpoints, args: Record<string, unknown>, key?: string) => callProviderEndpoint<T>(ports, workspaceId, binding, name, args, key);
  let settle!: (outcome: import("@chrona/contracts/steward").RuntimeEvent & { kind: "settled" }) => void;
  const completion = new Promise<import("@chrona/contracts/steward").RuntimeEvent & { kind: "settled" }>(resolve => { settle = resolve; });
  const callback = retainProviderCallbacks(ports, workspaceId, { provider: binding, events: input.events, detail: input.detail, operationId, settled: settle });
  const { events: _events, detail: _detail, deadline, ...request } = input;
  const start = { ...request, providerOptions: binding.providerOptions, ...(declaration.configuration?.revision ? { configurationRevision: declaration.configuration.revision } : {}), operationId, deadline: deadline?.toISOString() ?? null, callbacks: callback.id };
  try { await ports.db.$transaction(async tx => {
    const authenticated = await authenticateRun(tx, input.token, ports.now());
    const run = authenticated.run;
    if (authenticated.workspaceId !== workspaceId || run.id !== operationId || run.cwd !== input.cwd || run.lane !== input.lane || run.deadlineAt && (!deadline || deadline > run.deadlineAt)) throw new CallError("forbidden", "Provider launch exceeds the claimed Run");
    await assertProviderBinding(tx, workspaceId, binding);
    if (await tx.providerLaunch.findUnique({ where: { runId: operationId } })) throw new CallError("unknown", "Provider operation was already launched and requires reconciliation");
    await tx.providerLaunch.create({ data: { runId: operationId, digest: providerDigest(start), createdAt: ports.now() } });
  }); } catch (error) { callback.release(); throw error; }
  let done: ReturnType<ProviderAdapter["start"]>["done"];
  if (binding.kind === "completion") {
    done = startProviderCompletion({ ports, workspaceId, input, operationId, deadline, binding, declaration, endpoint, releaseCallback: callback.release });
  } else {
    try { await endpoint("start", start, `provider-start:${operationId}`); }
    catch (error) { callback.release(); throw error; }
    done = (async () => {
      try {
        for (;;) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const wake = await Promise.race([completion, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 5_000); })]).finally(() => clearTimeout(timer));
          if (wake) return wake.outcome;
          const status = await endpoint<{ outcome: unknown; failure: boolean }>("status", { operationId });
          if (status.outcome) return runtimeOutcomeSchema.parse(status.outcome);
          if (status.failure) throw new CallError("unknown", "Provider completion requires reconciliation");
        }
      } finally {
        callback.release();
        await endpoint("release", { operationId }).catch(() => {});
      }
    })();
  }
  void done.catch(() => {});
  const handle = { done,
    async inject(message: string, images?: ProviderRunInput["images"]) { await endpoint("inject", { operationId, message, ...(images ? { images } : {}) }); },
    async abort() { await endpoint("abort", { operationId }); },
  };
  let handles = active.get(ports.db);
  if (!handles) { handles = new Set(); active.set(ports.db, handles); }
  handles.add(handle);
  void done.finally(() => handles!.delete(handle)).catch(() => {});
  return handle;
}
