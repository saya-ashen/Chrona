import { randomUUID } from "node:crypto";
import { z } from "zod";
import { chrona, on, onDisconnect, ModelError } from "chrona";
import { providerAnswerSchema, runtimeStartSchema, runtimeCompletionSchema, type RuntimeEvent, type ProviderRunInput } from "@chrona/contracts/steward";
import { createPiProvider, PI_MODEL_ENVIRONMENT_KEYS, type PiProviderOptions } from "@chrona/pi";
import { createBrowsers } from "./browser";
import { createAgentOperations, AgentError } from "./operations";
import { agentInput, isModuleAgentTool, isAgentPrimitive, projectsInput, projectsOutput } from "@chrona/contracts/steward";
import { createModuleAgentOperations } from "./module-operations";
import { createAgentPrimitives } from "./primitives";
import { createModelPolicy } from "./model-policy";
import { settingsRegistration } from "./settings-page";

type Configuration = { backend: string; pi: Omit<PiProviderOptions, "browsers" | "launch">; browser: Parameters<typeof createBrowsers>[0] };
const configuration: Configuration | undefined = process.env.CHRONA_AGENT_CONFIGURATION ? JSON.parse(process.env.CHRONA_AGENT_CONFIGURATION) : undefined;
const modelEnvironment = JSON.parse(process.env.CHRONA_AGENT_MODEL_ENV ?? "{}");
for (const key of PI_MODEL_ENVIRONMENT_KEYS) if (typeof modelEnvironment[key] === "string") process.env[key] = modelEnvironment[key];
delete process.env.CHRONA_AGENT_MODEL_ENV;
const provider = configuration?.backend === "pi" ? createPiProvider({ ...configuration.pi, browsers: createBrowsers(configuration.browser) }) : undefined;
async function event(callbackId: string, value: RuntimeEvent) {
  return chrona.call("runtime-callback.event", { callbackId, event: value });
}
function input(raw: unknown): ProviderRunInput {
  const { operationId: _id, callbacks, deadline, ...request } = runtimeStartSchema.parse(raw);
  return { ...request, deadline: new Date(deadline), ...(callbacks ? {
    events: {
      async progress(value) { await event(callbacks, { kind: "progress", value }); },
      async usage(value) { await event(callbacks, { kind: "usage", value }); },
      async resources(value) { await event(callbacks, { kind: "resources", value }); },
      async question(value, signal) {
        const requestId = randomUUID();
        const abort = () => { void event(callbacks, { kind: "interrupt", requestId }).catch(() => {}); };
        signal.addEventListener("abort", abort, { once: true });
        try { const answer = event(callbacks, { kind: "question", requestId, value }); if (signal.aborted) abort(); return providerAnswerSchema.parse(await answer); }
        finally { signal.removeEventListener("abort", abort); }
      },
    },
    detail: { async append(value) { await event(callbacks, { kind: "detail", value }); } },
  } : {}) };
}
const operations = createAgentOperations(provider, chrona.paths.data, input);
const policy = createModelPolicy(chrona.paths.data, callId => chrona.call("runtime-callback.agent-admit", { callId, operation: "configure" }), async () => !!provider?.complete && !!(await provider.health()).available);
const settingsPage = settingsRegistration((target, args) => chrona.call(target, args));
on("activated", async () => { await settingsPage.activate(); return {}; });
setInterval(() => void settingsPage.refresh(), 60_000).unref();
const completions = new Map<string, { result: unknown; failure: boolean }>();
function complete(args: Record<string, unknown>) {
  if (!provider?.complete) throw new AgentError("unavailable", "Completion unconfigured");
  if (completions.size >= 64) throw new AgentError("capacity", "Agent completions full");
  const operationId = randomUUID(), row = { result: null as unknown, failure: false };
  completions.set(operationId, row);
  const timeout = setTimeout(() => completions.delete(operationId), 360000);
  void provider.complete(args as unknown as Parameters<NonNullable<typeof provider.complete>>[0]).then(result => { row.result = runtimeCompletionSchema.parse(result); }).catch(error => { if ((error as { code?: string } | null)?.code !== "unknown") row.failure = true; }).finally(() => timeout.unref());
  return { operationId };
}
function completion(operationId: string) {
  const row = completions.get(operationId);
  if (!row) throw new AgentError("not_found", "Completion not found");
  if (row.result || row.failure) completions.delete(operationId);
  return row;
}
const moduleOperations = createModuleAgentOperations(chrona.paths.data, (target, args) => chrona.call(target, args), async args => {
  if (!provider?.complete) throw new AgentError("unavailable", "Completion unconfigured");
  return provider.complete(args as unknown as Parameters<NonNullable<typeof provider.complete>>[0]);
}, policy);
const primitive = createAgentPrimitives((target, args) => chrona.call(target, args), (name, args) => operations.control(name, args), async input => await provider?.transcript?.(input) ?? []);
async function health() {
  return { name: provider?.name ?? "unconfigured", supportsRunModel: provider?.supportsRunModel ?? false, complete: await policy.ready(), ...await (provider?.health() ?? { available: false, sandboxed: false, error: null }) };
}
async function kernelTool(name: string, raw: unknown) {
  const args = agentInput(name, JSON.parse(String(raw)));
  if (name === "health") return health();
  if (name === "start") return operations.start(args);
  if (["status", "abort", "inject", "release"].includes(name)) return operations.control(name, args as { operationId: string });
  if (!provider) throw new AgentError("unavailable", "Agent backend unconfigured");
  if (name === "complete") {
    if (typeof args.declaredTier === "string") {
      const target = await policy.select(args.declaredTier, args.effectiveHardLimits as Parameters<typeof policy.select>[1], Number(args.maxOutputTokens));
      return complete({ prompt: args.prompt, system: args.system, ...target });
    }
    return complete(args);
  }
  if (name === "completion") return completion(String(args.operationId));
  if (name === "transcript") return await provider.transcript?.(args as { sessionDir: string; limit: number }) ?? [];
  throw new AgentError("not_found", "Agent tool not found");
}
function toolError(error: unknown) {
  if (error instanceof AgentError) return new ModelError(error.code, error.message);
  if (error instanceof ModelError) return error;
  if (error instanceof z.ZodError) return new ModelError("invalid", "Invalid Agent arguments");
  if (error instanceof Error) {
    const code = /^(forbidden|conflict|not_found|invalid|unknown|capacity|unconfigured|unavailable):/.exec(error.message)?.[1];
    if (code) return new ModelError(code, error.message);
  }
  return new ModelError("unknown", "Agent operation remains unconfirmed");
}
async function configure(call: { id: string } | undefined, caller: { kind: string } | undefined, args: unknown) {
  const callId = call?.id;
  if (!callId || !caller || !["owner", "module"].includes(caller.kind)) throw new ModelError("forbidden", "Agent configuration requires an admitted owner caller");
  try { return { result: await policy.configure(args, callId) }; }
  catch (error) {
    if (error instanceof z.ZodError) throw new ModelError("invalid", "Agent 设置无效：请检查模型、思考强度及 1–600000 毫秒的整数超时");
    throw error;
  }
}
async function projects(call: { id: string } | undefined, caller: { kind: string } | undefined, args: unknown) {
  if (caller?.kind !== "module" || !call?.id) throw new ModelError("forbidden", "Agent projects requires an admitted module caller");
  projectsInput.parse(args);
  return { result: projectsOutput.parse(await chrona.call("runtime-callback.agent-admit", { callId: call.id, operation: "projects" })) };
}
async function moduleTool(id: string, args: Record<string, unknown>, caller: { kind: "module"; module: string; moduleId: string; hash: string }, callId: string) {
  if (id === "health") { agentInput("health", args); return { result: await health() }; }
  if (isAgentPrimitive(id)) return { result: await primitive(id, args, callId) };
  if (!isModuleAgentTool(id)) throw new ModelError("forbidden", "Agent tool is not available to modules");
  return { result: await moduleOperations.handle(id, args, caller, callId) };
}
on("tool", async trigger => {
  const caller = trigger.caller;
  try {
    if (trigger.id === "projects") return await projects(trigger.call, caller, trigger.args);
    if (caller?.kind === "kernel") return { result: await kernelTool(trigger.id, trigger.args.input) };
    if (trigger.id === "configure") return await configure(trigger.call, caller, trigger.args);
    if (caller?.kind !== "module" || !trigger.call?.id) throw new ModelError("forbidden", "Agent tools require an admitted caller");
    return await moduleTool(trigger.id, trigger.args, caller, trigger.call.id);
  } catch (error) { throw toolError(error); }
});
// Socket loss stops backend work even when Chrona cannot receive the final receipt.
const stop = () => { void operations.stop().finally(() => process.exit(0)); };
onDisconnect(stop);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
