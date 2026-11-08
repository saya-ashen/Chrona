import { randomUUID } from "node:crypto";
import { z } from "zod";
import { chrona, on, onDisconnect, ModelError } from "chrona";
import { providerAnswerSchema, runtimeStartSchema, runtimeCompletionSchema, type RuntimeEvent, type ProviderRunInput } from "@chrona/contracts/steward";
import { createPiProvider, type PiProviderOptions } from "../../../../../../integrations/src/steward/pi-provider";
import { createBrowsers } from "../../../../../../integrations/src/steward/browser";
import { createAgentOperations, AgentError } from "./operations";
import { agentInput } from "./contracts";
import { createModuleAgentOperations } from "./module-operations";
import type { ModuleAgentTool } from "./module-contracts";
import { createAgentPrimitives, isAgentPrimitive } from "./primitives";
import { PI_MODEL_ENVIRONMENT_KEYS } from "../../../../../../integrations/src/steward/pi-launch";

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
const completions = new Map<string, { result: unknown; failure: boolean }>();
function complete(args: Record<string, unknown>) {
  if (!provider?.complete) throw new AgentError("unavailable", "Completion unconfigured");
  if (completions.size >= 64) throw new AgentError("capacity", "Agent completions full");
  const operationId = randomUUID(), row = { result: null as unknown, failure: false };
  completions.set(operationId, row);
  const timeout = setTimeout(() => completions.delete(operationId), 360000);
  void provider.complete(args as unknown as Parameters<NonNullable<typeof provider.complete>>[0]).then(result => { row.result = runtimeCompletionSchema.parse(result); }).catch(() => { row.failure = true; }).finally(() => timeout.unref());
  return { operationId };
}
function completion(operationId: string) {
  const row = completions.get(operationId);
  if (!row) throw new AgentError("not_found", "Completion not found");
  if (row.result || row.failure) completions.delete(operationId);
  return row;
}
on("health", async () => {
  const health = await provider?.health();
  await chrona.reportHealth({ status: health?.available ? "ready" : "needs_configuration", summary: health?.available ? "Agent 后端已通过只读检查。" : "Agent 后端尚未配置或当前不可用。", nextAction: "在服务启动配置中检查 CHRONA_STEWARD_AGENT、CHRONA_STEWARD_PI_COMMAND、CHRONA_STEWARD_PI_AGENT_DIR 与版本设置；修改后重启服务。模型选择与预算在全局设置中调整。" });
});
const moduleOperations = createModuleAgentOperations(chrona.paths.data, (target, args) => chrona.call(target, args), async args => {
  if (!provider?.complete) throw new AgentError("unavailable", "Completion unconfigured");
  return provider.complete(args as unknown as Parameters<NonNullable<typeof provider.complete>>[0]);
}, (name, args) => operations.control(name, args));
const primitive = createAgentPrimitives((target, args) => chrona.call(target, args), (name, args) => operations.control(name, args), async input => await provider?.transcript?.(input) ?? []);
async function health() {
  return { name: provider?.name ?? "unconfigured", supportsRunModel: provider?.supportsRunModel ?? false, complete: !!provider?.complete, ...await (provider?.health() ?? { available: false, sandboxed: false, error: null }) };
}
async function kernelTool(name: string, raw: unknown) {
  const args = agentInput(name, JSON.parse(String(raw)));
  if (name === "health") return health();
  if (name === "start") return operations.start(args);
  if (["status", "abort", "inject", "release"].includes(name)) return operations.control(name, args as { operationId: string });
  if (!provider) throw new AgentError("unavailable", "Agent backend unconfigured");
  if (name === "complete") return complete(args);
  if (name === "completion") return completion(String(args.operationId));
  if (name === "transcript") return await provider.transcript?.(args as { sessionDir: string; limit: number }) ?? [];
  throw new AgentError("not_found", "Agent tool not found");
}
function toolError(error: unknown) {
  if (error instanceof AgentError) return new ModelError(error.code, error.message);
  if (error instanceof ModelError) return error;
  if (error instanceof z.ZodError) return new ModelError("invalid", "Invalid Agent arguments");
  if (error instanceof Error) {
    const code = /^(forbidden|conflict|not_found|invalid|unknown|capacity):/.exec(error.message)?.[1];
    if (code) return new ModelError(code, error.message);
  }
  return new ModelError("unknown", "Agent operation remains unconfirmed");
}
on("tool", async trigger => {
  const caller = trigger.caller;
  try {
    if (caller?.kind === "kernel") return { result: await kernelTool(trigger.id, trigger.args.input) };
    if (caller?.kind !== "module" || !trigger.call?.id) throw new ModelError("forbidden", "Agent tools require an admitted caller");
    if (trigger.id === "health") { agentInput("health", trigger.args); return { result: await health() }; }
    if (isAgentPrimitive(trigger.id)) return { result: await primitive(trigger.id, trigger.args, trigger.call.id) };
    return { result: await moduleOperations.handle(trigger.id as ModuleAgentTool, trigger.args, caller, trigger.call.id) };
  } catch (error) { throw toolError(error); }
});
// Socket loss stops backend work even when Chrona cannot receive the final receipt.
const stop = () => { void operations.stop().finally(() => process.exit(0)); };
onDisconnect(stop);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
