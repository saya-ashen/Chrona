import { randomUUID, createHash } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";
import { moduleManifestSchema, runtimeStartSchema, runtimeOperationSchema, runtimeOutcomeSchema, runtimeHealthSchema, runtimeTranscriptSchema, runtimeCompletionSchema, providerAnswerSchema, THINKING_LEVELS, type ModuleTool, type ProviderAdapter, type ProviderRunInput, type RuntimeEvent } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { CallError } from "../modules/module-calls";
import { testModuleProcess } from "./module-test-process";

type Outcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
type Operation = { digest: string; handle: ReturnType<ProviderAdapter["start"]>; outcome?: Outcome; failure?: boolean };
const moduleName = "test-provider";
const operationInput = runtimeOperationSchema.extend({ message: z.string().max(2 * 1024 * 1024).optional(), images: runtimeStartSchema.shape.images });
const completionInput = z.object({ commandKey: z.string(), prompt: z.string(), system: z.string().optional(), model: z.string().optional(), thinking: z.enum(THINKING_LEVELS).optional(), configurationRevision: z.string().optional(), maxOutputTokens: z.number().int().positive(), timeoutMs: z.number().int().positive() }).strict();
const declarations = [
  ["health", z.object({}).strict(), runtimeHealthSchema], ["start", runtimeStartSchema, runtimeOperationSchema],
  ["status", runtimeOperationSchema, runtimeOperationSchema.extend({ outcome: runtimeOutcomeSchema.nullable(), failure: z.boolean() })],
  ["inject", operationInput, z.object({ accepted: z.literal(true) }).strict()], ["abort", runtimeOperationSchema, z.object({ requested: z.literal(true) }).strict()], ["release", runtimeOperationSchema, z.object({ released: z.literal(true) }).strict()],
  ["transcript", z.object({ sessionDir: z.string().max(8192), limit: z.number().int().min(1).max(300) }).strict(), runtimeTranscriptSchema],
  ["complete", completionInput, runtimeCompletionSchema],
] as const;
function manifestSchema(schema: z.ZodType, input = false) {
  const allowed = new Set(["type", "description", "properties", "required", "additionalProperties", "items", "enum", "anyOf", ...(input ? [] : ["const", "allOf", "title"])]);
  const result = z.toJSONSchema(schema, { override: ({ jsonSchema }) => {
    for (const key of Object.keys(jsonSchema)) if (!allowed.has(key)) delete jsonSchema[key];
    if (jsonSchema.type === "integer") jsonSchema.type = "number";
    if (jsonSchema.type === "object") {
      jsonSchema.properties ??= {};
      if (typeof jsonSchema.additionalProperties === "object") jsonSchema.additionalProperties = true;
    }
  } });
  delete result.$schema;
  delete result.$defs;
  if (input) delete result.additionalProperties;
  return result;
}
export const testProviderManifest = moduleManifestSchema.parse({ name: moduleName, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["agent.register", "runtime-callback.event"],
  tools: declarations.map(([name, input, output]) => ({ name, description: "Test Provider operation", visibility: ["kernel"], parameters: manifestSchema(input, true) as ModuleTool["parameters"], output: manifestSchema(output) as ModuleTool["output"] })),
});


type Call = Parameters<Parameters<typeof testModuleProcess>[0]>[1];
async function event(call: Call, callbackId: string, value: RuntimeEvent) {
  const reply = await call("call", { target: "runtime-callback.event", args: { callbackId, event: value }, mode: "sync", reply: true, key: randomUUID() }) as { result?: { output: unknown }; error?: { code: string; message: string } };
  if (reply.error) throw new CallError(reply.error.code as ConstructorParameters<typeof CallError>[0], reply.error.message);
  return reply.result?.output;
}
function providerInput(call: Call, raw: unknown): ProviderRunInput {
  const { callbacks, operationId: _id, configurationRevision: _revision, deadline, ...input } = runtimeStartSchema.parse(raw);
  return { ...input, deadline: deadline === null ? null : new Date(deadline), ...(callbacks ? {
    events: {
      raw: async value => { await event(call, callbacks, { kind: "raw", value: z.record(z.string(), z.json()).parse(value) }); },
      progress: async value => { await event(call, callbacks, { kind: "progress", value }); },
      usage: async value => { await event(call, callbacks, { kind: "usage", value }); },
      resources: async value => { await event(call, callbacks, { kind: "resources", value }); },
      async question(value, signal) {
        const requestId = randomUUID();
        const abort = () => { void event(call, callbacks, { kind: "interrupt", requestId }).catch(() => {}); };
        signal.addEventListener("abort", abort, { once: true });
        try {
          const answer = event(call, callbacks, { kind: "question", requestId, value });
          if (signal.aborted) abort();
          return providerAnswerSchema.parse(await answer);
        } finally { signal.removeEventListener("abort", abort); }
      },
    },
    detail: { async append(value) { await event(call, callbacks, { kind: "detail", value }); } },
  } : {}) };
}
async function controlOperation(operations: Map<string, Operation>, key: string, name: string, args: Record<string, unknown>) {
  const row = operations.get(key);
  if (!row) throw new CallError("not_found", "Provider operation not found");
  if (name === "status") return { result: { operationId: args.operationId, outcome: row.outcome ?? null, failure: row.failure ?? false } };
  if (name === "inject") {
    if (row.outcome || row.failure) throw new CallError("conflict", "Provider operation ended");
    const request = operationInput.parse(args);
    if (request.message === undefined) throw new CallError("invalid", "Message required");
    await row.handle.inject(request.message, request.images);
    return { result: { accepted: true } };
  }
  if (name === "abort") { await row.handle.abort(); return { result: { requested: true } }; }
  if (name === "release") {
    if (!row.outcome) throw new CallError("conflict", "Provider completion remains unconfirmed");
    operations.delete(key);
    return { result: { released: true } };
  }
  throw new CallError("not_found", "Provider tool not found");
}
async function completion(provider: ProviderAdapter, args: unknown) {
  if (!provider.complete) throw new CallError("unavailable", "Provider completion unconfigured");
  const { commandKey: _key, configurationRevision: _revision, ...request } = completionInput.parse(args);
  if (!request.model) throw new CallError("invalid", "Completion model required");
  return { result: runtimeCompletionSchema.parse(await provider.complete({ ...request, model: request.model })) };
}
async function health(provider: ProviderAdapter | undefined) {
  return { result: runtimeHealthSchema.parse({ name: provider?.name ?? "unconfigured", supportsRunModel: provider?.supportsRunModel ?? false, complete: !!provider?.complete, ...(provider ? await provider.health() : { available: false, sandboxed: false, error: null }) }) };
}
export function testProviderProcess(ports: StewardPorts, modules: Map<string, string>) {
  const operations = new Map<string, Operation>();
  const completed = new Set<string>();
  function startOperation(key: string, provider: ProviderAdapter, args: unknown, call: Call) {
    const request = runtimeStartSchema.parse(args), digest = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const previous = operations.get(key);
    if (previous) {
      if (previous.digest !== digest) throw new CallError("conflict", "Provider operation identity changed");
      return { result: { operationId: request.operationId } };
    }
    // The kernel authenticates the launch and reserves ProviderLaunch before routing here.
    const handle = provider.start(providerInput(call, request));
    const row: Operation = { digest, handle };
    operations.set(key, row);
    void handle.done.then(async outcome => {
      row.outcome = runtimeOutcomeSchema.parse(outcome);
      if (request.callbacks) await event(call, request.callbacks, { kind: "settled", operationId: request.operationId, outcome: row.outcome });
    }).catch(() => { row.failure = true; });
    return { result: { operationId: request.operationId } };
  }
  return testModuleProcess(async (message, call, input) => {
    const workspaceId = modules.get(basename(input.dataDir));
    if (!workspaceId) throw new CallError("not_found", "Test Provider workspace not found");
    if (message.trigger.kind !== "tool") return {};
    const { id: name, args } = message.trigger;
    const provider = ports.provider;
    if (name === "health") return health(provider);
    if (!provider) throw new CallError("unavailable", "Provider unconfigured");
    if (name === "transcript") return { result: runtimeTranscriptSchema.parse(provider.transcript ? await provider.transcript(args as { sessionDir: string; limit: number }) : []) };
    if (name === "complete") {
      const result = await completion(provider, args);
      completed.add(`${workspaceId}:${String(args.commandKey)}`);
      return result;
    }
    const key = `${workspaceId}:${String(args.operationId)}`;
    if (name === "release" && completed.delete(key)) return { result: { released: true } };
    if (name === "start") return startOperation(key, provider, args, call);
    return controlOperation(operations, key, name, args);
  });
}
