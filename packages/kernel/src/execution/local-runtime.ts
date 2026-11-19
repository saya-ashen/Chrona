import type { ProviderAdapter, ProviderRunInput, RoutedTarget } from "@chrona/contracts/steward";
import { runtimeOutcomeSchema, runtimeToolSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { callSync, kernelOrigin, CallError } from "../modules/module-calls";
import { registerProviderCallbacks, retainProviderCallbacks } from "../agent/local-provider";
import { callProviderEndpoint, runProviderBinding, assertProviderBinding, providerDigest } from "../agent/agent-provider";
import { authenticateRun } from "./run-auth";
import { startProviderCompletion } from "./local-runtime-completion";
import { contextRunTools } from "../agent/agent-context-tools";
import { createTools } from "../tools";
import { json } from "../system/shared";
import { registerToolDelegations, retainToolDelegation } from "../modules/tool-delegation";

const active = new WeakMap<StewardPorts["db"], Set<ReturnType<ProviderAdapter["start"]>>>();
export async function stopAgentRuns(ports: StewardPorts) {
  await Promise.all([...(active.get(ports.db) ?? [])].map(async handle => { await handle.abort(); await handle.done; }));
}
export function registerLocalRuntime() { registerProviderCallbacks(); registerToolDelegations(); }
export async function runtimeCall<T>(ports: StewardPorts, workspaceId: string, target: RoutedTarget, args: Record<string, unknown>,
  options: { key?: string; expectedTarget?: { moduleId: string }; private?: boolean; expectedHash?: string } = {}): Promise<T> {
  registerLocalRuntime();
  return (await callSync(ports, kernelOrigin(workspaceId), target, args, options)).output as T;
}
async function retainRunTools(ports: StewardPorts, workspaceId: string, { runId: operationId, token }: ProviderRunInput,
  binding: { moduleId: string; hash: string }) {
  const { run } = await authenticateRun(ports.db, token, ports.now());
  if (run.id !== operationId || run.workspaceId !== workspaceId) throw new CallError("forbidden", "Provider launch exceeds the claimed Run");
  const admission = await ports.db.agentRunAdmission.findUnique({ where: { runId: operationId }, select: { targets: true } });
  const context = Array.isArray(admission?.targets) && admission.targets.length ? await contextRunTools(ports, run) : null;
  const grants: ReturnType<typeof retainToolDelegation>[] = [];
  const schema = runtimeToolSchema.omit({ reference: true });
  const definitions = context?.catalog.map(({ name, description, inputSchema }) => schema.parse({ name, description, parameters: inputSchema }));
  const tools = context && definitions?.map((definition, index) => {
    const entry = context.entries[index]!;
    const grant = retainToolDelegation(ports, { workspaceId, authorizer: context.caller, recipient: binding,
      target: `${entry.module.name}.${entry.tool.name}`, async invoke({ args, key, timeoutSeconds, delegate, active }) {
        const result = await createTools(ports).call(token, definition.name, args, { key, timeoutSeconds,
          delegate: { caller: delegate, hash: entry.module.activeHash!, active } });
        return json(result.result);
      } });
    grants.push(grant);
    return { ...definition, reference: grant.reference };
  });
  return { tools, grants };
}
/** Only a recorded backend outcome proves completion; cancelling a launch gate never does. */
export async function startLocalProvider(ports: StewardPorts, workspaceId: string, input: ProviderRunInput): Promise<ReturnType<ProviderAdapter["start"]>> {
  registerLocalRuntime();
  const binding = await runProviderBinding(ports, workspaceId, input.runId);
  const declaration = await assertProviderBinding(ports.db, workspaceId, binding);
  const operationId = input.runId;
  const endpoint = <T>(name: keyof typeof declaration.endpoints, args: Record<string, unknown>,
    key?: string) => callProviderEndpoint<T>(ports, workspaceId, { ...binding, requestKey: key }, name, args);
  let settle!: (outcome: import("@chrona/contracts/steward").RuntimeEvent & { kind: "settled" }) => void;
  const completion = new Promise<import("@chrona/contracts/steward").RuntimeEvent & { kind: "settled" }>(resolve => { settle = resolve; });
  const { tools, grants } = await retainRunTools(ports, workspaceId, input, binding);
  const callback = retainProviderCallbacks(ports, workspaceId, { provider: binding, events: input.events, operationId, settled: settle });
  const release = () => { callback.release(); for (const grant of grants) grant.release(); };
  const { events: _events, callTool: _callTool, token: _token, deadline, tools: _tools, ...request } = input;
  const start = { ...request, ...(tools?.length ? { tools } : {}), providerOptions: binding.providerOptions, ...(declaration.configuration?.revision ? {
    configurationRevision: declaration.configuration.revision } : {}), operationId, deadline: deadline?.toISOString() ?? null,
    callbacks: callback.id };
  try { await ports.db.$transaction(async tx => {
    const authenticated = await authenticateRun(tx, input.token, ports.now());
    const current = authenticated.run;
    if (authenticated.workspaceId !== workspaceId || current.id !== operationId || current.cwd !== input.cwd || current.lane !== input.lane ||
      current.deadlineAt && (!deadline || deadline > current.deadlineAt)) throw new CallError("forbidden", "Provider launch exceeds the claimed Run");
    await assertProviderBinding(tx, workspaceId, binding);
    if (await tx.providerLaunch.findUnique({ where: { runId: operationId } })) throw new CallError("unknown",
      "Provider operation was already launched and requires reconciliation");
    await tx.providerLaunch.create({ data: { runId: operationId, digest: providerDigest(start), createdAt: ports.now() } });
  }); } catch (error) { release(); throw error; }
  let done: ReturnType<ProviderAdapter["start"]>["done"];
  if (binding.kind === "completion") {
    done = startProviderCompletion({ ports, workspaceId, input, operationId, deadline, binding, declaration, endpoint, releaseCallback: release });
  } else {
    try { await endpoint("start", start, `provider-start:${operationId}`); }
    catch (error) { release(); throw error; }
    done = (async () => {
      try {
        for (;;) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const wake = await Promise.race([completion, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 5_000);
            })]).finally(() => clearTimeout(timer));
          if (wake) return wake.outcome;
          const status = await endpoint<{ outcome: unknown; failure: boolean }>("status", { operationId });
          if (status.outcome) return runtimeOutcomeSchema.parse(status.outcome);
          if (status.failure) throw new CallError("unknown", "Provider completion requires reconciliation");
        }
      } finally {
        release();
        await endpoint("release", { operationId }).catch(error => {
          console.error(JSON.stringify({ component: "local-runtime", event: "release.failed", operationId, error: String(error) }));
        });
      }
    })();
  }
  void done.catch(error => {
    console.error(JSON.stringify({ component: "local-runtime", event: "completion.failed", operationId, error: String(error) }));
  });
  const handle = { done,
    async inject(message: string, images?: ProviderRunInput["images"]) { await endpoint("inject", { operationId, message, ...(images ? { images } : {}) }); },
    async abort() { await endpoint("abort", { operationId }); },
  };
  let handles = active.get(ports.db);
  if (!handles) { handles = new Set(); active.set(ports.db, handles); }
  handles.add(handle);
  void done.then(() => handles!.delete(handle), () => handles!.delete(handle));
  return handle;
}
