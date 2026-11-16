import { afterEach, expect, spyOn, test } from "bun:test";
import "./module-effects";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createScriptSandbox } from "../../../../../integrations/src/steward/runtime/script-sandbox";
import { moduleManifestSchema, moduleCallSchema, type ModuleEvent } from "@chrona/contracts/steward";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "../test-db";
import { admitted, CallError, callStatus, callSync, callsSettled, enqueueCall, kernelOrigin, moduleToolExampleError, runDueCalls, validateToolArgs } from "./module-calls";
import { callModuleTool, moduleToolCatalog } from "./module-tools";
import { moduleIncidents, recordModuleFailure } from "./module-diagnostics";
import { registerSystemModules } from "../system-modules";
import { PAUSED_MODULE_NAMES } from "./module-availability";
import type { StewardPorts } from "../ports";
import { pruneHistory } from "../retention";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
type Handler = Parameters<typeof testModuleProcess>[0];
const tool = (name: string, extra: Record<string, unknown> = {}) => ({ name, description: name, output: {}, parameters: { type: "object", properties: { text: { type: "string" } } }, visibility: ["modules"], ...extra });
const startEvent = { trigger: { id: "pong", kind: "tool", args: {}, caller: { kind: "kernel" }, firedAt: "2026-10-24T00:00:00Z" }, now: "2026-10-24T00:00:00Z", params: {} } satisfies ModuleEvent;

/** Two modules, alpha (the caller) and beta (the callee), on the real supervisor, socket and database. */
async function fixture(handlers: { alpha: Handler; beta: Handler }) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/cmc-test-");
  const workspace = await db.workspace.create({ data: { name: "calls" } });
  const manifests = {
    alpha: { name: "alpha", entry: "index.ts", tests: ["test.ts"], effects: [],
      uses: ["beta.echo", "beta.look", "beta.private", "beta.hidden", "beta.bounce", "beta.crash", "beta.again", "modules.contributions"], tools: [tool("pong"), tool("start")] },
    beta: { name: "beta", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["alpha.pong"],
      tools: [tool("echo", { visibility: ["modules", "kernel"] }), tool("look", { idempotent: true, readOnly: true }), tool("private", { visibility: ["kernel"] }), tool("hidden", { visibility: ["owner"] }), tool("bounce", { visibility: ["modules", "kernel"] }), tool("crash", { visibility: ["modules", "kernel"] }), tool("again", { idempotent: true, visibility: ["modules", "kernel"] }), tool("unlisted")],
    },
  };
  const modules: Record<string, { id: string }> = {};
  for (const [name, manifest] of Object.entries(manifests)) {
    const module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: `${name}-v1` } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: `${name}-v1`, manifest: moduleManifestSchema.parse(manifest), source: "user", intent: {}, report: {}, status: "approved" } });
    modules[name] = module;
  }
  const peer = testModuleProcess((event, call, input) => (input.codeDir.endsWith("alpha-v1") ? handlers.alpha : handlers.beta)(event, call, input));
  let time = Date.parse("2026-10-24T00:00:00Z");
  const ports: StewardPorts = { db, dataDir, now: () => new Date(time), publicUrl: null, sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  return { db, ports, workspace, alpha: modules.alpha!, beta: modules.beta!, ...peer, advance: (ms: number) => { time += ms; },
    fire: (id = "pong") => moduleSupervisor(ports).deliver(modules.alpha!.id, "alpha-v1", { ...startEvent, trigger: { ...startEvent.trigger, id } }) };
}
const output = (reply: unknown) => (reply as { result: { result: unknown } }).result.result;

test("keyless unrecorded system reads return results and failures without touching invocation storage", async () => {
  registerSystemModules();
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({}) });
  const guarded = new Proxy(f.db, { get(db, property, receiver) {
    if (property === "moduleInvocation") throw new Error("Keyless read touched invocation storage");
    return Reflect.get(db, property, receiver);
  } });
  const ports = { ...f.ports, db: guarded }, origin = { ...kernelOrigin(f.workspace.id), caller: { kind: "owner" as const, via: null } };
  const first = await callSync(ports, origin, "modules.list", {});
  expect(first).toMatchObject({ callId: expect.any(String), output: { items: expect.arrayContaining([expect.objectContaining({ id: f.alpha.id })]) } });
  expect((await callSync(ports, origin, "modules.list", {})).callId).not.toBe(first.callId);
  await expect(callSync(ports, origin, "modules.health", { moduleId: "missing" })).rejects.toMatchObject({ code: "not_found" });
  await expect(callSync(ports, origin, "modules.list", { unexpected: true })).rejects.toMatchObject({ code: "invalid" });
  await expect(callSync(ports, origin, "modules.list", {}, { expectedTarget: { moduleId: "reinstalled" } })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.moduleInvocation.count()).toBe(0);
  expect(await f.db.runEvent.count({ where: { kind: "tool-result" } })).toBe(0);
});

test("keyed unrecorded system reads retain finished receipts and deduplicate", async () => {
  registerSystemModules();
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({}) });
  const origin = { ...kernelOrigin(f.workspace.id), caller: { kind: "owner" as const, via: null } };
  const first = await callSync(f.ports, origin, "modules.list", {}, { key: "read-once" });
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: first.callId } })).toMatchObject({ targetIdentity: "system:modules", tool: "list", mode: "sync", key: "read-once", status: "succeeded", finishedAt: f.ports.now() });
  await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "later" } });
  expect(await callSync(f.ports, origin, "modules.list", {}, { key: "read-once" })).toEqual(first);
  await expect(callSync(f.ports, origin, "modules.list", { limit: 1 }, { key: "read-once" })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.moduleInvocation.count()).toBe(1);
});

test("expired application receipt refuses original and changed requests without another dispatch", async () => {
  let deliveries = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async () => { deliveries++; return { result: { text: "exact first reply" } }; } });
  const origin = kernelOrigin(f.workspace.id), args = { text: "old request" }, options = { key: "consumed-forever" };
  const first = await callSync(f.ports, origin, "beta.echo", args, options);
  expect(await callSync(f.ports, origin, "beta.echo", args, options)).toEqual(first);
  f.advance(91 * 86400_000);
  await pruneHistory(f.db, f.ports.now());
  for (const request of [args, { text: "changed request" }]) await expect(callSync(f.ports, origin, "beta.echo", request, options)).rejects.toMatchObject({ code: "conflict" });
  expect(deliveries).toBe(1);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: first.callId } })).toMatchObject({ key: options.key, output: null, status: "failed" });
});

test("shipped files capability examples match its input and output contracts", async () => {
  const raw = JSON.parse(await readFile(new URL("../applications/files/module.json", import.meta.url), "utf8"));
  const manifest = moduleManifestSchema.parse(raw);
  expect(manifest.tools.map(moduleToolExampleError)).toEqual(manifest.tools.map(() => null));
});

test("routed argument validation rejects non-JSON numbers and preserves open nested object keys", () => {
  const schema = { name: "input", description: "input", visibility: ["modules"], idempotent: false, parameters: {
    type: "object" as const, properties: { value: { type: "number" as const }, metadata: { type: "object" as const, properties: {}, required: [], additionalProperties: true } }, required: ["value", "metadata"],
  },
      output: {}
} as Parameters<typeof validateToolArgs>[0];
  for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    expect(() => validateToolArgs(schema, { value, metadata: { arbitrary_key: [1, null] } })).toThrow();
  }
  expect(validateToolArgs(schema, { value: 1, metadata: { arbitrary_key: [1, null] } })).toEqual({ value: 1, metadata: { arbitrary_key: [1, null] } });
});

test("declared examples are checked against input and output contracts without invoking a module", () => {
  const manifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "search", description: "Search", visibility: ["owner"],
    parameters: { type: "object", properties: { filters: { type: "array", items: { type: "object", properties: { state: { type: "string", enum: ["open", "closed"] } }, required: ["state"] } } }, required: ["filters"] },
    output: { type: "object", properties: { count: { type: "integer" } }, required: ["count"], additionalProperties: false },
    examples: [{ args: { filters: [{ state: "open" }] }, result: { count: 1 } }] }] });
  const tool = manifest.tools[0]!;
  expect(moduleToolExampleError(tool)).toBeNull();
  expect(moduleToolExampleError({ ...tool, examples: [{ args: { filters: [{ state: "invalid" }] } }] })).toContain("arguments are invalid");
  expect(moduleToolExampleError({ ...tool, examples: [{ args: { filters: [{ state: "open" }] }, result: { count: "one" } }] })).toContain("result does not match output schema");
});

test("structured native arguments survive sync and async routed delivery", async () => {
  const f = await fixture({ alpha: async () => ({}), beta: async event => ({ result: (event.trigger as { args: unknown }).args }) });
  const row = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(row.manifest);
  manifest.tools[0]!.parameters = {
    type: "object", properties: { filters: { type: "array", items: {
      type: "object", properties: { states: { type: "array", items: { type: "string", enum: ["open", "closed"] } } }, required: ["states"]
    } } }, required: ["filters"]
  };
  await f.db.moduleVersion.update({ where: { id: row.id }, data: { manifest } });
  const args = { filters: [{ states: ["open", "closed"] }] }, origin = { workspaceId: f.workspace.id, caller: { kind: "module" as const, module: "alpha", moduleId: f.alpha.id, hash: "alpha-v1" }, chain: [], path: [] };
  expect((await callSync(f.ports, origin, "beta.echo", args)).output).toEqual(args);
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: args }, { key: "native-args", reply: false });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({ status: "succeeded", output: args });
});

test("expectedTarget is an optional strict routed identity contract", () => {
  const params = { target: { moduleId: "module-fixture", tool: "echo" }, args: {}, mode: "sync" };
  expect(moduleCallSchema.safeParse({ id: "fixture", method: "call", params }).success).toBe(true);
  const expectedTarget = { moduleId: "module-fixture" };
  expect(moduleCallSchema.safeParse({ id: "fixture", method: "call", params: { ...params, expectedTarget } }).success).toBe(true);
  expect(moduleCallSchema.safeParse({ id: "fixture", method: "call", params: { ...params, expectedTarget: { ...expectedTarget, hash: "v1" } } }).success).toBe(true);
  for (const expected of [{ ...expectedTarget, extra: true }, { ...expectedTarget, moduleId: "" }, { ...expectedTarget, hash: "" }, { ...expectedTarget, hash: null }, { ...expectedTarget, hash: 1 }, { hash: "v1" }, { ...expectedTarget, expectedHash: "v1" }]) {
    expect(moduleCallSchema.safeParse({ id: "fixture", method: "call", params: { ...params, expectedTarget: expected } }).success).toBe(false);
  }
});

test("saved target expectations fence sync, enqueue and duplicate keys without granting visibility", async () => {
  let calls = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; return { result: "matched" }; } });
  const expectedTarget = { moduleId: f.beta.id };
  const origin = kernelOrigin(f.workspace.id);
  for (const expected of [{ ...expectedTarget, moduleId: "reinstalled-id" }]) {
    await expect(callSync(f.ports, origin, "beta.echo", {}, { expectedTarget: expected })).rejects.toMatchObject({ code: "conflict" });
    await expect(enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "expectation", expectedTarget: expected })).rejects.toMatchObject({ code: "conflict" });
  }
  expect(await f.db.moduleInvocation.count()).toBe(0);
  expect(calls).toBe(0);
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "expectation", expectedTarget });
  expect(await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "expectation", expectedTarget })).toMatchObject({ callId: queued.callId, duplicate: true });
  await expect(enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "expectation", expectedTarget: { ...expectedTarget, moduleId: "new-id" } })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.moduleInvocation.count()).toBe(1);
  await expect(callSync(f.ports, { ...origin, caller: { kind: "owner", via: null } }, "beta.echo", {}, { expectedTarget })).rejects.toMatchObject({ code: "forbidden" });
  await runDueCalls(f.ports, f.workspace.id);
  expect((await callSync(f.ports, origin, "beta.echo", {}, { expectedTarget })).output).toBe("matched");
  expect(calls).toBe(2);
});

test("a saved sync target survives a schema update while waiting in the supervisor queue", async () => {
  let calls = 0, release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; entered(); await blocked; return { result: 42 }; } });
  const origin = kernelOrigin(f.workspace.id);
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  const expectedTarget = { moduleId: f.beta.id };
  const first = callSync(f.ports, origin, "beta.echo", {});
  await started;
  const second = callSync(f.ports, origin, "beta.echo", {}, { expectedTarget }).then(value => ({ value }), error => ({ error }));
  try {
    for (let i = 0; i < 100 && await f.db.moduleInvocation.count() < 2; i++) await Bun.sleep(1);
    expect(await f.db.moduleInvocation.count()).toBe(2);
    manifest.tools[0]!.output = { type: "number" };
    await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
  } finally { release(); }
  await first;
  expect(await second).toMatchObject({ value: { output: 42 } });
  expect(calls).toBe(2);
  expect(await f.db.moduleInvocation.findMany({ orderBy: { createdAt: "asc" }, select: { status: true } })).toEqual([{ status: "succeeded" }, { status: "succeeded" }]);
});

test("new unsent sync calls persist and replay proof without granting it to duplicate conflicts", async () => {
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({}) });
  let starts = 0;
  const startModule = f.ports.sandbox!.startModule!;
  f.ports.sandbox!.startModule = () => { starts++; throw new Error("runtime unavailable"); };
  const origin = { ...kernelOrigin(f.workspace.id), caller: { kind: "module" as const, module: "alpha", moduleId: f.alpha.id, hash: "alpha-v1" } };
  const target = { moduleId: f.beta.id, tool: "echo" }, options = { key: "unsent", expectedTarget: { moduleId: f.beta.id, hash: "beta-v1" } };
  await expect(callSync(f.ports, origin, target, {}, options)).rejects.toMatchObject({ code: "unavailable", reason: "not_dispatched" });
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { key: "unsent" } })).toMatchObject({ status: "failed", errorCode: "unavailable", errorReason: "not_dispatched", attempts: 1 });
  f.ports.sandbox!.startModule = startModule;
  await expect(callSync(f.ports, origin, target, {}, options)).rejects.toMatchObject({ code: "unavailable", reason: "not_dispatched" });
  await expect(callSync(f.ports, origin, target, { text: "changed" }, options)).rejects.toMatchObject({ code: "conflict", reason: undefined });
  await expect(callSync(f.ports, origin, target, {}, { ...options, expectedTarget: { moduleId: "another" } })).rejects.toMatchObject({ code: "conflict", reason: undefined });
  await expect(callSync(f.ports, origin, target, {}, { ...options, expectedTarget: { moduleId: f.beta.id, hash: "beta-v2" } })).rejects.toMatchObject({ code: "conflict", reason: undefined });
  await expect(callSync(f.ports, { ...origin, caller: { ...origin.caller, hash: "alpha-v2" } }, target, {}, options)).rejects.toMatchObject({ code: "forbidden", reason: undefined });
  expect(starts).toBe(1);
  expect(await f.db.moduleInvocation.count()).toBe(1);
  expect(f.processes).toHaveLength(0);
});

test("pre-claim routing failures carry no dispatch proof", async () => {
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({}) });
  const origin = kernelOrigin(f.workspace.id);
  await expect(callSync(f.ports, origin, "beta.echo", {}, { expectedTarget: { moduleId: "reinstalled" } })).rejects.toMatchObject({ code: "conflict", reason: undefined });
  await f.db.module.update({ where: { id: f.beta.id }, data: { status: "paused" } });
  await expect(callSync(f.ports, origin, "beta.echo", {}, { key: "not-claimed" })).rejects.toMatchObject({ code: "unavailable", reason: undefined });
  expect(await f.db.moduleInvocation.count()).toBe(0);
  expect(f.processes).toHaveLength(0);
});

test("claimed activation conflicts stay unmarked on failure and replay", async () => {
  let release!: () => void, entered!: () => void, calls = 0;
  const blocked = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; entered(); await blocked; return { result: 42 }; } });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...moduleManifestSchema.parse(version.manifest), activated: true } } });
  const origin = kernelOrigin(f.workspace.id), now = f.ports.now().toISOString();
  const first = moduleSupervisor(f.ports).deliver(f.beta.id, "beta-v1", {
    trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {},
  });
  await started;
  const second = callSync(f.ports, origin, "beta.echo", {}, { key: "activation-conflict" }).then(value => ({ value }), error => ({ error }));
  try {
    for (let i = 0; i < 100 && await f.db.moduleInvocation.count() < 1; i++) await Bun.sleep(1);
    expect(await f.db.moduleInvocation.count()).toBe(1);
    await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v2" } });
  } finally { release(); }
  await first;
  expect(await second).toMatchObject({ error: { code: "conflict", reason: undefined } });
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { key: "activation-conflict" } })).toMatchObject({ status: "failed", errorCode: "conflict", errorReason: null });
  await expect(callSync(f.ports, origin, { moduleId: f.beta.id, tool: "echo" }, {}, { key: "activation-conflict" })).rejects.toMatchObject({ code: "conflict", reason: undefined });
  expect(calls).toBe(1);
});

test("sync lost replies persist unknown without proof and never redispatch on replay", async () => {
  let calls = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async (_event, _call, input) => {
    calls++;
    f.processes.find(process => process.input === input)!.kill();
    await new Promise(() => {});
  } });
  const origin = kernelOrigin(f.workspace.id), options = { key: "lost-reply" };
  await expect(callSync(f.ports, origin, "beta.echo", {}, options)).rejects.toMatchObject({ code: "unknown", reason: undefined });
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { key: options.key } })).toMatchObject({ status: "unknown", errorCode: "unknown", errorReason: null });
  await expect(callSync(f.ports, origin, "beta.echo", {}, options)).rejects.toMatchObject({ code: "unknown", reason: undefined });
  expect(calls).toBe(1);
});

test.each([
  { code: "unavailable", reason: "not_dispatched", expected: undefined },
  { code: "unavailable", reason: "submission_refused", expected: "submission_refused" },
  { code: "unknown", reason: "submission_refused", expected: undefined },
  { code: "timeout", reason: "submission_refused", expected: undefined },
  { code: "unavailable", reason: "unconfigured", expected: "unconfigured" },
] as const)("handler $code/$reason persists and replays only valid reasons", async ({ code, reason, expected }) => {
  let calls = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; throw new CallError(code, "Structured handler failure", reason); } });
  const origin = kernelOrigin(f.workspace.id), options = { key: "handler-proof" }, expectedCode = code === "timeout" ? "unknown" : code;
  for (let attempt = 0; attempt < 2; attempt++) await expect(callSync(f.ports, origin, "beta.echo", {}, options)).rejects.toMatchObject({ code: expectedCode, reason: expected });
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { key: options.key } })).toMatchObject({ status: expectedCode === "unknown" ? "unknown" : "failed", errorCode: expectedCode, errorReason: expected ?? null });
  expect(calls).toBe(1);
});

test.each(["not_dispatched", "submission_refused"] as const)("real SDK receives inner %s and scopes its rethrow at the outer handler", async reason => {
  let innerCalls = 0;
  const f = await fixture({ alpha: async () => { innerCalls++; throw new CallError("unavailable", "Inner refusal", "submission_refused"); }, beta: async () => ({}) });
  const runtime = createScriptSandbox({ executionMode: "trusted-local", dataDir: f.ports.dataDir });
  const peerStart = f.ports.sandbox!.startModule!;
  f.ports.sandbox = { ...runtime.health, startModule: input => {
    if (input.codeDir.endsWith("alpha-v1")) {
      if (reason === "not_dispatched") throw new Error("Inner runtime unavailable");
      return peerStart(input);
    }
    return runtime.startModule(input);
  } };
  const codeDir = join(f.ports.dataDir, "platform/store/beta-v1");
  await mkdir(codeDir, { recursive: true });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  await writeFile(join(codeDir, "module.json"), JSON.stringify(version.manifest));
  await writeFile(join(codeDir, "index.ts"), `import { on, chrona, ModelError } from "chrona";
    on("tool", async event => {
      try { await chrona.call({ moduleId: chrona.dependencies.alpha, tool: "pong" }, {}, { mode: "sync", key: event.args.text }); }
      catch (error) {
        if (!(error instanceof ModelError)) throw error;
        if (event.args.text === "observe") return { result: { code: error.code, reason: error.reason } };
        throw error;
      }
    });`);
  const origin = kernelOrigin(f.workspace.id);
  expect((await callSync(f.ports, origin, "beta.echo", { text: "observe" })).output).toEqual({ code: "unavailable", reason });
  const expected = reason === "submission_refused" ? reason : undefined, options = { key: "outer-forward" };
  for (let attempt = 0; attempt < 2; attempt++) await expect(callSync(f.ports, origin, "beta.echo", { text: "forward" }, options)).rejects.toMatchObject({ code: "unavailable", reason: expected });
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { target: "beta", key: options.key } })).toMatchObject({ status: "failed", errorReason: expected ?? null });
  expect(await f.db.moduleInvocation.findMany({ where: { target: "alpha" }, select: { errorReason: true } })).toEqual([{ errorReason: reason }, { errorReason: reason }]);
  expect(await f.db.moduleRun.count({ where: { moduleId: f.beta.id } })).toBe(2);
  expect(innerCalls).toBe(reason === "submission_refused" ? 2 : 0);
});

test("missing callbacks keep explicit never-sent attribution across several unavailable retries", async () => {
  let calls = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; return { result: "late-bound" }; } });
  const original = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  await f.db.module.delete({ where: { id: f.beta.id } });
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspace.id), target: "beta.echo", raw: {} }, { key: "missing-target" });
  expect(await f.db.moduleInvocation.findUnique({ where: { id: queued.callId } })).toMatchObject({ targetModuleId: null, targetContractHash: null });
  for (let i = 0; i < 2; i++) { await runDueCalls(f.ports, f.workspace.id); f.advance(120_000); }
  expect(calls).toBe(0);
  const replacement = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "beta", activeHash: "beta-v1" } });
  await f.db.moduleVersion.create({ data: { moduleId: replacement.id, hash: "beta-v1", manifest: moduleManifestSchema.parse(original.manifest), source: "user", intent: {}, report: {}, status: "approved" } });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({ status: "succeeded", attempts: 3, output: "late-bound" });
  expect(await f.db.moduleInvocation.findUnique({ where: { id: queued.callId } })).toMatchObject({ targetModuleId: replacement.id, targetContractHash: null });
  expect(calls).toBe(1);
});

test("legacy unattributed callbacks fail closed on their first or recovered delivery", async () => {
  for (const attempts of [0, 2]) {
    let calls = 0;
    const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; return { result: "unexpected" }; } });
    const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspace.id), target: "beta.echo", raw: {} }, { key: `legacy-${attempts}` });
    await f.db.moduleInvocation.update({ where: { id: queued.callId }, data: { targetBound: false } });
    await f.db.moduleInvocation.update({ where: { id: queued.callId }, data: { attempts } });
    await runDueCalls(f.ports, f.workspace.id);
    expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({ status: "failed", error: expect.stringContaining("target identity or contract changed") });
    expect(calls).toBe(0);
    expect(await f.db.moduleInvocation.findUnique({ where: { id: queued.callId } })).toMatchObject({ targetBound: false });
  }
});

test("paused callbacks retain their app identity across a tool schema update", async () => {
  let calls = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; return { result: 42 }; } });
  await f.db.module.update({ where: { id: f.beta.id }, data: { status: "paused" } });
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspace.id), target: "beta.echo", raw: {} }, { key: "paused-target" });
  expect(await f.db.moduleInvocation.findUnique({ where: { id: queued.callId } })).toMatchObject({ targetModuleId: f.beta.id, targetContractHash: null });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  manifest.tools[0]!.output = { type: "number" };
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
  await f.db.module.update({ where: { id: f.beta.id }, data: { status: "active" } });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({ status: "succeeded", output: 42 });
  expect(calls).toBe(1);
});

test("callback delivery survives a schema update between resolution and binding", async () => {
  let calls = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; return { result: 42 }; } });
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspace.id), target: "beta.echo", raw: {} }, { key: "racing-contract" });
  let armed = true;
  f.ports.db = f.db.$extends({ query: { moduleVersion: { async findUnique({ args, query }) {
    const version = await query(args);
    if (armed && version?.moduleId === f.beta.id) {
      armed = false;
      const manifest = moduleManifestSchema.parse(version.manifest);
      manifest.tools[0]!.output = { type: "number" };
      await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
    }
    return version;
  } } } }) as typeof f.db;
  await runDueCalls(f.ports, f.workspace.id);
  expect(armed).toBe(false);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({ status: "succeeded", output: 42 });
  expect(calls).toBe(1);
});

test("expired callbacks recover only attributed idempotent delivery; unknown work is never replayed", async () => {
  for (const scenario of ["idempotent", "unknown", "legacy", "changed"] as const) {
    let calls = 0;
    const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; return { result: "recovered" }; } });
    const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspace.id), target: scenario === "unknown" ? "beta.echo" : "beta.again", raw: {} }, { key: `recovery-${scenario}` });
    if (scenario === "legacy") await f.db.moduleInvocation.update({ where: { id: queued.callId }, data: { targetBound: false } });
    if (scenario === "changed") {
      const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
      const manifest = moduleManifestSchema.parse(version.manifest);
      manifest.tools.find(tool => tool.name === "again")!.output = { type: "number" };
      await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
    }
    await f.db.moduleInvocation.update({ where: { id: queued.callId }, data: { status: "running", attempts: 1, leaseToken: "expired", leaseUntil: new Date(f.ports.now().getTime() - 1) } });
    await runDueCalls(f.ports, f.workspace.id);
    const expected = scenario === "idempotent" ? "succeeded" : scenario === "changed" ? "failed" : "unknown";
    expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({ status: expected });
    await runDueCalls(f.ports, f.workspace.id);
    expect(calls).toBe(scenario === "idempotent" || scenario === "changed" ? 1 : 0);
  }
});

test("a tool description change keeps registered callers working", async () => {
  let calls = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; return { result: "compatible" }; } });
  const expectedTarget = { moduleId: f.beta.id }, origin = kernelOrigin(f.workspace.id);
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "compatible-code", expectedTarget });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  manifest.tools[0]!.description = "Updated tool documentation";
  await f.db.moduleVersion.create({ data: { moduleId: f.beta.id, hash: "beta-v2", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v2" } });
  expect(await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "compatible-code", expectedTarget })).toMatchObject({ callId: queued.callId, duplicate: true });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({ status: "succeeded", output: "compatible" });
  expect((await callSync(f.ports, origin, "beta.echo", {}, { expectedTarget })).output).toBe("compatible");
  expect(calls).toBe(2);
});

test("an incompatible argument shape fails with invalid, not conflict", async () => {
  const f = await fixture({ alpha: async () => ({}), beta: async event => ({ result: (event.trigger as { args: unknown }).args }) });
  const expectedTarget = { moduleId: f.beta.id }, origin = kernelOrigin(f.workspace.id);
  expect((await callSync(f.ports, origin, "beta.echo", { text: "before" }, { expectedTarget })).output).toEqual({ text: "before" });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  manifest.tools[0]!.parameters = { type: "object", properties: { message: { type: "string" } }, required: ["message"] };
  await f.db.moduleVersion.create({ data: { moduleId: f.beta.id, hash: "beta-v2", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v2" } });
  await expect(callSync(f.ports, origin, "beta.echo", { text: "before" }, { expectedTarget })).rejects.toMatchObject({ code: "invalid" });
});

test("visibility admission is independent of target contracts; only uses star reaches owner-only tools", async () => {
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({}) });
  const row = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.alpha.id, hash: "alpha-v1" } } });
  for (const uses of [[], ["beta.hidden"], ["*"]]) {
    const manifest = moduleManifestSchema.parse({ ...row.manifest as object, uses, authority: uses.includes("*") ? "owner" : undefined });
    await f.db.moduleVersion.update({ where: { id: row.id }, data: { manifest } });
    const moduleCaller = { kind: "module" as const, module: "alpha", moduleId: f.alpha.id, hash: "alpha-v1" };
    for (const [caller, visibility, expected] of [
      [moduleCaller, ["modules"], true],
      [moduleCaller, ["owner"], uses.includes("*")],
      [moduleCaller, ["provider"], false],
      [moduleCaller, ["kernel"], false],
      [{ kind: "system", module: "chat" }, ["modules"], true],
      [{ kind: "system", module: "chat" }, ["owner"], false],
      [{ kind: "owner", via: null }, ["owner"], true],
      [{ kind: "owner", via: null }, ["modules"], false],
      [{ kind: "provider", runId: "test" }, ["provider"], true],
      [{ kind: "kernel" }, ["kernel"], true],
    ] as const) {
      const targetTool = moduleManifestSchema.parse({ name: "target", entry: "index.ts", tests: ["test.ts"], effects: [], tools: [tool("echo", { visibility })] }).tools[0]!;
      expect(await admitted(f.db, caller, targetTool, f.workspace.id)).toBe(expected);
    }
  }
});

test("A calls B through Chrona: B sees the real caller and the call is recorded", async () => {
  const f = await fixture({
    alpha: async (_event, call) => ({ result: await call("call", { target: "beta.echo", args: { text: "hi" } } as never) }),
    beta: async event => ({ result: { echo: (event.trigger as unknown as { args: { text: string } }).args.text, caller: (event.trigger as { caller?: unknown }).caller } }),
  });
  expect(output(await f.fire())).toMatchObject({ result: { output: { echo: "hi", caller: { kind: "module", module: "alpha", moduleId: f.alpha.id, hash: "alpha-v1" } } } });
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ caller: `module:${f.alpha.id}`, callerModuleId: f.alpha.id, target: "beta", tool: "echo", mode: "sync", status: "succeeded", chain: ["alpha"] });
  expect(await f.db.moduleCall.count({ where: { method: "call", status: { not: "rejected" } } })).toBe(0);
});

test("keyless app observations write no invocation or run history; keyed observations retain exact replies", async () => {
  const body = "x".repeat(4096);
  let reads = 0;
  const f = await fixture({
    alpha: async (event, call) => ({ result: await call("call", { target: "beta.look", args: { text: "page" }, ...(event.trigger.id === "start" ? { key: "read-k1" } : {}) } as never) }),
    beta: async () => { reads++; return { result: { body } }; },
  });
  expect(output(await f.fire("pong"))).toMatchObject({ result: { output: { body } } });
  expect(output(await f.fire("start"))).toMatchObject({ result: { output: { body } } });
  const calls = await f.db.moduleInvocation.findMany({ where: { tool: "look" } });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ status: "succeeded", key: "read-k1", output: { body } });
  expect(await f.db.moduleRun.count({ where: { moduleId: f.beta.id } })).toBe(0);
  expect(await f.db.moduleExecutionResult.count({ where: { moduleId: f.beta.id } })).toBe(0);
  await f.fire("start");
  expect(reads).toBe(2);
});
test("declared app outputs fail synchronously with callee diagnostics and no lifecycle incident", async () => {
  const f = await fixture({ alpha: async (_event, call) => ({ result: await call("call", { target: "beta.echo", args: {} } as never) }), beta: async () => ({ result: { wrong: "secret payload" } }) });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  manifest.tools[0]!.output = { type: "object", properties: { echo: { type: "string" } }, required: ["echo"], additionalProperties: false };
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
  const result = output(await f.fire());
  expect(result).toMatchObject({ error: { code: "failed", message: expect.stringContaining("beta.echo: output contract mismatch") } });
  const call = await f.db.moduleInvocation.findFirstOrThrow({ where: { target: "beta", tool: "echo" } });
  expect(call.status).toBe("failed");
  expect(call.error).not.toContain("secret payload");
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "module_output_mismatch", subjectId: f.beta.id } })).toMatchObject({ details: { hash: "beta-v1", tool: "echo", callId: call.id, issues: ["echo (invalid_type)", "$ (unrecognized_keys)"] } });
  expect(await f.db.audit.count({ where: { kind: "module_runtime_incident", subjectId: f.beta.id } })).toBe(0);
});

test("a schema mismatch does not mark a prior callee failure recovered or restart transport", async () => {
  let wrong = false;
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({ result: wrong ? { wrong: "private" } : { echo: "ok" } }) });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  manifest.tools[0]!.output = { type: "object", properties: { echo: { type: "string" } }, required: ["echo"], additionalProperties: false };
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
  expect((await callSync(f.ports, kernelOrigin(f.workspace.id), "beta.echo", {})).output).toEqual({ echo: "ok" });
  await recordModuleFailure(f.db, { workspaceId: f.workspace.id, moduleId: f.beta.id, hash: "beta-v1", now: f.ports.now(), retry: false,
    evidence: { phase: "event", reason: "synthetic prior failure", runId: "prior", triggerId: "tool:echo", delivery: "handler", pid: null, exitCode: 1, signal: null, stderr: "" } });
  const before = await moduleIncidents(f.db, f.workspace.id, f.beta.id);
  wrong = true;
  await expect(callSync(f.ports, kernelOrigin(f.workspace.id), "beta.echo", {})).rejects.toMatchObject({ code: "failed" });
  expect(await moduleIncidents(f.db, f.workspace.id, f.beta.id)).toEqual(before);
  expect(await f.db.moduleRun.count({ where: { moduleId: f.beta.id } })).toBe(2);
});

test("async output mismatches fail once, persist a callee diagnostic, and do not become transport-unknown", async () => {
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({ result: { wrong: "private-value" } }) });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  manifest.tools[0]!.output = { type: "object", properties: { echo: { type: "string" } }, required: ["echo"], additionalProperties: false };
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspace.id), target: "beta.echo", raw: {} }, { key: "bad-output", reply: false });
  await runDueCalls(f.ports, f.workspace.id);
  const call = await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } });
  expect(call).toMatchObject({ status: "failed", attempts: 1, error: expect.stringContaining("output contract mismatch") });
  expect(JSON.stringify(call)).not.toContain("private-value");
  expect(call.output).toBeNull();
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "module_output_mismatch", subjectId: f.beta.id } })).toMatchObject({ details: { hash: "beta-v1", tool: "echo", callId: call.id } });
  expect(await f.db.moduleRun.findFirstOrThrow({ where: { moduleId: f.beta.id } })).toMatchObject({ exitCode: 1, error: expect.stringContaining("output contract mismatch"), output: null });
});

test("output mismatch audit persistence failure stays a call failure without transport retry", async () => {
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({ result: { wrong: "private-value" } }) });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  manifest.tools[0]!.output = { type: "object", properties: { echo: { type: "string" } }, required: ["echo"], additionalProperties: false };
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
  const db = f.db as unknown as { $transaction: (callback: (tx: any) => unknown) => unknown };
  const transaction = db.$transaction.bind(f.db);
  db.$transaction = callback => transaction((tx: any) => callback(new Proxy(tx, {
    get(target, property, receiver) {
      if (property !== "audit") return Reflect.get(target, property, receiver);
      return new Proxy(target.audit, { get(audit, key, auditReceiver) {
        if (key !== "create") return Reflect.get(audit, key, auditReceiver);
        return (args: { data?: { kind?: string } }) => args.data?.kind === "module_output_mismatch"
          ? Promise.reject(new Error("synthetic diagnostics storage failure")) : audit.create(args);
      } });
    },
  })));
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspace.id), target: "beta.echo", raw: {} }, { key: "bad-output-audit-failure", reply: false });
  await runDueCalls(f.ports, f.workspace.id);
  const call = await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } });
  expect(call).toMatchObject({ status: "failed", attempts: 1, error: expect.stringContaining("output contract mismatch") });
  expect(call.output).toBeNull();
  expect(await f.db.audit.count({ where: { kind: "module_output_mismatch", subjectId: f.beta.id } })).toBe(0);
  expect(await f.db.moduleRun.count({ where: { moduleId: f.beta.id } })).toBe(1);
});

test("unknown targets and hidden tools are refused; owner requests cannot reach module-only tools", async () => {
  const replies: unknown[] = [];
  const f = await fixture({
    alpha: async (_event, call) => {
      for (const target of ["beta.private", "beta.hidden", "beta.missing"]) replies.push(await call("call", { target, args: {} } as never));
      return {};
    },
    beta: async () => { throw new Error("must not be reached"); },
  });
  await f.fire();
  expect(replies).toMatchObject([{ error: { code: "forbidden" } }, { error: { code: "forbidden" } }, { error: { code: "not_found" } }]);
  expect(await f.db.moduleRun.count({ where: { moduleId: f.beta.id } })).toBe(0);
  // Owner requests reach only owner-visible tools: beta.echo is for modules and Chrona.
  await expect(callModuleTool(f.ports, { workspaceId: f.workspace.id, runId: null, via: "mcp" }, "m_beta_echo", { text: "x" })).rejects.toMatchObject({ code: "not_found" });
});

test("a sync call back into a module that is waiting is refused as a cycle, not left to time out", async () => {
  const f = await fixture({
    alpha: async (event, call) => event.trigger.id === "pong" ? { result: "pong" } : { result: await call("call", { target: "beta.bounce", args: {} } as never) },
    beta: async (_event, call) => ({ result: await call("call", { target: "alpha.pong", args: {}, mode: "sync" } as never) }),
  });
  const started = Date.now();
  expect(output(await f.fire("start"))).toMatchObject({ result: { output: { error: { code: "cycle" } } } });
  expect(Date.now() - started).toBeLessThan(5000);
});

test("independent concurrent events can call in opposite directions", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let betaEntered!: () => void, echoQueued!: () => void;
  const betaReady = new Promise<void>(resolve => { betaEntered = resolve; });
  const echoReady = new Promise<void>(resolve => { echoQueued = resolve; });
  let betaReply: unknown;
  const f = await fixture({
    // alpha's tool event waits on beta.echo; beta answers only after its own other event called alpha.
    alpha: async (event, call) => event.trigger.id === "pong" ? { result: "pong" } : { result: await call("call", { target: "beta.echo", args: {} } as never) },
    beta: async (event, call) => {
      if (event.trigger.id === "bounce") { betaEntered(); await gate; betaReply = await call("call", { target: "alpha.pong", args: {} } as never); return { result: betaReply }; }
      return { result: "echo" };
    },
  });
  const supervisor = moduleSupervisor(f.ports), deliver = supervisor.deliver.bind(supervisor);
  const observed = spyOn(supervisor, "deliver").mockImplementation((moduleId, hash, event, options) => {
    if (moduleId === f.beta.id && event.trigger.id === "echo") echoQueued();
    return deliver(moduleId, hash, event, options);
  });
  cleanups.push(async () => { observed.mockRestore(); });
  // beta is busy in "bounce" (Chrona's async call) when alpha starts waiting on beta.echo; then bounce calls alpha.
  await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspace.id), target: "beta.bounce", raw: {} }, { key: "bounce" });
  const delivering = runDueCalls(f.ports, f.workspace.id);
  await betaReady;
  const alpha = f.fire("start");
  await echoReady;
  release(); await delivering;
  expect(output(await alpha)).toMatchObject({ result: { output: "echo" } });
  expect(betaReply).toMatchObject({ result: { output: "pong" } });
});

test("lifecycle barriers reject an actual cross-event wait cycle", async () => {
  let release!: () => void, entered!: () => void, queued!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const echo = new Promise<void>(resolve => { queued = resolve; });
  let nested: unknown;
  const f = await fixture({
    alpha: async (event, call) => event.trigger.id === "pong" ? { result: "pong" }
      : { result: await call("call", { target: "beta.echo", args: {} } as never) },
    beta: async (event, call) => {
      if (event.trigger.kind !== "activated") return { result: "echo" };
      entered(); await gate;
      nested = await call("call", { target: "alpha.pong", args: {} } as never);
      return { result: nested };
    },
  });
  for (const module of [f.alpha, f.beta]) {
    const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: module.id, hash: module.id === f.alpha.id ? "alpha-v1" : "beta-v1" } } });
    await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...moduleManifestSchema.parse(version.manifest), activated: true } } });
  }
  const supervisor = moduleSupervisor(f.ports), deliver = supervisor.deliver.bind(supervisor);
  const observed = spyOn(supervisor, "deliver").mockImplementation((moduleId, hash, event, options) => {
    if (moduleId === f.beta.id && event.trigger.id === "echo") queued();
    return deliver(moduleId, hash, event, options);
  });
  cleanups.push(async () => { observed.mockRestore(); });
  const now = f.ports.now().toISOString();
  const activated: ModuleEvent = { trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} };
  const beta = deliver(f.beta.id, "beta-v1", activated);
  await started;
  const alpha = deliver(f.alpha.id, "alpha-v1", activated);
  await echo;
  release();
  await Promise.all([alpha, beta]);
  expect(nested).toMatchObject({ error: { code: "cycle" } });
});

test("async calls are stored under the caller's key, delivered once and answered with call_result and callStatus", async () => {
  const results: unknown[] = [], deliveries: unknown[] = [];
  let callId = "";
  const f = await fixture({
    alpha: async (event, call) => {
      if (event.trigger.kind === "call_result") { results.push(event.trigger); return {}; }
      if (event.trigger.id === "pong") return { result: await call("callStatus", { callId } as never) };
      const first = await call("call", { target: "beta.echo", args: { text: "once" }, mode: "async", key: "k1", reply: true } as never) as { result: { callId: string } };
      callId = first.result.callId;
      return { result: [first, await call("call", { target: "beta.echo", args: { text: "once" }, mode: "async", key: "k1", reply: true } as never)] };
    },
    beta: async event => { deliveries.push(event.trigger); return { result: { echo: (event.trigger as unknown as { args: { text: string } }).args.text } }; },
  });
  expect(output(await f.fire("start"))).toMatchObject([{ result: { status: "queued", duplicate: false } }, { result: { callId: expect.any(String), duplicate: true } }]);
  // The call itself started a delivery loop; let it finish, then run once more (nothing is delivered twice).
  await callsSettled(f.ports); await runDueCalls(f.ports, f.workspace.id); await callsSettled(f.ports);
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]).toMatchObject({ kind: "tool", id: "echo", caller: { kind: "module", module: "alpha" }, call: { id: callId, key: "k1", attempt: 1, chain: ["alpha"] } });
  expect(results).toMatchObject([{ kind: "call_result", callId, target: { moduleId: f.beta.id, tool: "echo" }, key: "k1", status: "succeeded", output: { echo: "once" } }]);
  const status = await moduleSupervisor(f.ports).deliver(f.alpha.id, "alpha-v1", { trigger: { id: "pong", kind: "tool", firedAt: "2026-10-24T00:00:01Z", args: {} }, now: "2026-10-24T00:00:01Z", params: {} });
  expect(output(status)).toMatchObject({ result: { callId, status: "succeeded", output: { echo: "once" } } });
});

test("call result waits while the caller is paused and is delivered after resume", async () => {
  const results: unknown[] = [];
  const f = await fixture({
    alpha: async event => { if (event.trigger.kind === "call_result") results.push(event.trigger); return {}; },
    beta: async () => ({ result: { echo: "once" } }),
  });
  const origin = { ...kernelOrigin(f.workspace.id), caller: { kind: "module" as const, module: "alpha", moduleId: f.alpha.id, hash: "alpha-v1" } };
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "paused-result", reply: true });
  await f.db.moduleInvocation.update({ where: { id: queued.callId }, data: { status: "succeeded", output: {}, finishedAt: f.ports.now() } });
  await f.db.module.update({ where: { id: f.alpha.id }, data: { status: "paused" } });
  for (let i = 0; i < 5; i++) await runDueCalls(f.ports, f.workspace.id);
  expect(results).toEqual([]);
  await f.db.module.update({ where: { id: f.alpha.id }, data: { status: "active" } });
  await runDueCalls(f.ports, f.workspace.id);
  expect(results).toHaveLength(1);
  expect(results).toMatchObject([{ kind: "call_result", callId: queued.callId, status: "succeeded", output: {} }]);
});

test("pre-delivery failure releases the lease for retry", async () => {
  const received: unknown[] = [];
  const f = await fixture({ alpha: async () => ({}), beta: async event => { received.push(event.trigger); return { result: {} }; } });
  const origin = { ...kernelOrigin(f.workspace.id), caller: { kind: "module" as const, module: "alpha", moduleId: f.alpha.id, hash: "alpha-v1" } };
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "pre-delivery", reply: false });
  let failLookup = true;
  const module = new Proxy(f.db.module, { get(delegate, property, receiver) {
    if (property === "findUnique") return (...args: Parameters<typeof delegate.findUnique>) => {
      if (failLookup) { failLookup = false; throw new Error("synthetic pre-delivery lookup failure"); }
      return delegate.findUnique(...args);
    };
    return Reflect.get(delegate, property, receiver);
  } });
  const db = new Proxy(f.db, { get(client, property, receiver) {
    return property === "module" ? module : Reflect.get(client, property, receiver);
  } });
  const ports = { ...f.ports, db };
  await runDueCalls(ports, f.workspace.id);
  expect(await callStatus(f.ports, origin, queued.callId)).toMatchObject({ status: "queued", error: "pre-delivery: Error: synthetic pre-delivery lookup failure" });
  expect(received).toEqual([]);
  f.advance(30_000);
  await runDueCalls(f.ports, f.workspace.id);
  expect(await callStatus(f.ports, origin, queued.callId)).toMatchObject({ status: "succeeded", output: {} });
  expect(received).toHaveLength(1);
});

test("delivery outcomes: never-delivered retries, lost after sending is unknown, restarts redeliver only idempotent calls", async () => {
  const seen: string[] = [];
  const f = await fixture({ alpha: async () => ({}), beta: async (event, _call, input) => {
    seen.push(event.trigger.id);
    // Dies after receiving the event: Chrona cannot know whether the tool acted.
    if (event.trigger.id === "crash") { f.processes.find(process => process.input === input)!.kill(); await new Promise(() => {}); }
    return { result: { ok: event.trigger.id } };
  } });
  const origin = kernelOrigin(f.workspace.id), find = (key: string) => f.db.moduleInvocation.findFirstOrThrow({ where: { key } });
  // Paused target: the call waits and is delivered once the target is back.
  await f.db.module.update({ where: { id: f.beta.id }, data: { status: "paused" } });
  await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: { text: "later" } }, { key: "paused" });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await find("paused")).toMatchObject({ status: "queued", attempts: 1, error: expect.stringContaining("not active") });
  await f.db.module.update({ where: { id: f.beta.id }, data: { status: "active" } });
  f.advance(60_000); await runDueCalls(f.ports, f.workspace.id);
  expect(await find("paused")).toMatchObject({ status: "succeeded", attempts: 2 });

  await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.crash", raw: {} }, { key: "crash" });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await find("crash")).toMatchObject({ status: "unknown", error: expect.stringContaining("Outcome unknown") });

  // Chrona stopped mid-delivery (lease expired while running): only the idempotent call is sent again.
  for (const [target, key] of [["beta.echo", "interrupted"], ["beta.again", "interrupted-idempotent"]] as const) {
    const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target, raw: {} }, { key });
    await f.db.moduleInvocation.update({ where: { id: queued.callId }, data: { status: "running", attempts: 1, leaseToken: "old", leaseUntil: new Date(f.ports.now().getTime() - 1) } });
  }
  seen.length = 0;
  await runDueCalls(f.ports, f.workspace.id);
  expect(await find("interrupted")).toMatchObject({ status: "unknown", error: "Delivery interrupted; outcome unknown" });
  expect(await find("interrupted-idempotent")).toMatchObject({ status: "succeeded", attempts: 2 });
  expect(seen).toEqual(["again"]);
});

test.each(["owner", "provider"] as const)("%s tool calls preserve unknown delivery outcomes", async audience => {
  const f = await fixture({ alpha: async () => ({}), beta: async (_event, _call, input) => {
    f.processes.find(process => process.input === input)!.kill();
    await new Promise(() => {});
  } });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  manifest.tools[0]!.visibility = [audience];
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
  await expect(callModuleTool(f.ports, { workspaceId: f.workspace.id, runId: audience === "provider" ? "run" : null }, "m_beta_echo", {})).rejects.toMatchObject({ code: "unknown", message: expect.stringContaining("outcome unknown") });
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { target: "beta" } })).toMatchObject({ status: "unknown", attempts: 1 });
  expect(await f.db.moduleRun.count({ where: { moduleId: f.beta.id } })).toBe(1);
});

test("approved owner authority reaches owner and modules tools but not kernel-only tools", async () => {
  registerSystemModules();
  const f = await fixture({
    alpha: async (_event, call) => {
      const results: Record<string, unknown> = {};
      for (const target of ["beta.hidden", "beta.echo", "beta.private", "modules.describe"]) results[target] = await call("call", { target, args: target === "modules.describe" ? {} : { text: "x" } } as never);
      return { result: results };
    },
    beta: async event => ({ result: { tool: (event.trigger as { id: string }).id } }),
  });
  const alpha = moduleManifestSchema.parse({ name: "alpha", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["*", "modules.describe"], authority: "owner", tools: [tool("pong")] });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.alpha.id, hash: "alpha-v1" } }, data: { manifest: alpha } });
  const results = output(await f.fire()) as Record<string, { result?: { output: unknown }; error?: { code: string } }>;
  expect(results["beta.hidden"]).toMatchObject({ result: { output: { tool: "hidden" } } });
  expect(results["beta.echo"]).toMatchObject({ result: { output: { tool: "echo" } } });
  expect(results["beta.private"]).toMatchObject({ error: { code: "forbidden" } });
  expect(await f.db.moduleCall.findMany({ where: { method: "call" }, select: { status: true, error: true } })).toEqual([{ status: "rejected", error: "forbidden" }]);
  // Discovery uses the same visibility rule, independent of declared target contracts.
  expect((results["modules.describe"]!.result!.output as { items: { target: { moduleId: string; tool: string } | string }[] }).items.flatMap(entry => typeof entry.target !== "string" && entry.target.moduleId === f.beta.id ? [`beta.${entry.target.tool}`] : [])).toEqual(["beta.again", "beta.bounce", "beta.crash", "beta.echo", "beta.hidden", "beta.look", "beta.unlisted"]);
});

test("a module can call a modules-visible tool absent from uses; retired contributions stay unavailable", async () => {
  expect(moduleManifestSchema.safeParse({ name: "beta", entry: "index.ts", tests: ["test.ts"], tools: [tool("echo")], contributes: { alpha: { hello: "from beta" } } }).success).toBe(false);
  const f = await fixture({
    alpha: async (event, call) => {
      const target = (event.trigger as { id: string }).id === "pong" ? "beta.unlisted" : "";
      return { result: { granted: await call("call", { target, args: { text: "hi" } } as never),
        mine: await call("call", { target: "modules.contributions", args: { section: "alpha" } } as never),
        theirs: await call("call", { target: "modules.contributions", args: { section: "gamma" } } as never) } };
    },
    beta: async event => ({ result: { caller: (event.trigger as { caller?: { module?: string } }).caller?.module } }),
  });
  const reply = output(await f.fire()) as { granted: unknown; mine: unknown; theirs: unknown };
  expect(reply.granted).toMatchObject({ result: { output: { caller: "alpha" } } });
  expect(reply.mine).toMatchObject({ error: { code: "not_found" } });
  expect(reply.theirs).toMatchObject({ error: { code: "not_found" } });
});

test("paused targets return unavailable before any installed or release target read", async () => {
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({}) });
  const guarded = new Proxy(f.db, { get() { throw new Error("Paused resolution must not read the database"); } });
  for (const name of PAUSED_MODULE_NAMES) {
    await expect(callSync({ ...f.ports, db: guarded }, kernelOrigin(f.workspace.id), `${name}.echo`, {})).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
  }
  expect(f.processes).toHaveLength(0);
  expect(await f.db.moduleInvocation.count()).toBe(0);
});

test("installed paused apps stay undiscoverable and never dispatch sync or queued calls", async () => {
  let executed = 0;
  const f = await fixture({ alpha: async () => { executed++; return {}; }, beta: async () => { executed++; return {}; } });
  registerSystemModules();
  const calls = [];
  for (const name of PAUSED_MODULE_NAMES) {
    const module = await f.db.module.create({ data: { workspaceId: f.workspace.id, name, activeHash: `${name}-v1` } });
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], tools: [tool("echo", { visibility: ["modules", "owner", "kernel"] })] });
    await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: `${name}-v1`, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    await expect(callSync(f.ports, kernelOrigin(f.workspace.id), `${name}.echo`, {})).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
    calls.push(await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspace.id), target: `${name}.echo`, raw: {} }, { key: `paused-${name}` }));
  }
  const pausedIds = new Set((await f.db.module.findMany({ where: { workspaceId: f.workspace.id, name: { in: [...PAUSED_MODULE_NAMES] } } })).map(row => row.id));
  const found = (await callSync(f.ports, { ...kernelOrigin(f.workspace.id), caller: { kind: "owner", via: null } }, "modules.describe", { query: "echo" })).output as { items: { target: unknown }[] };
  expect(found.items.some(item => item.target === "beta.echo")).toBe(false); // beta.echo is not owner visible.
  expect(found.items.filter(item => typeof item.target === "object" && item.target && pausedIds.has((item.target as { moduleId: string }).moduleId))).toEqual([]);
  // A module audience still sees ordinary application tools.
  const visible = (await callSync(f.ports, { ...kernelOrigin(f.workspace.id), caller: { kind: "module", module: "alpha", moduleId: f.alpha.id, hash: "alpha-v1" } }, "modules.describe", { query: "echo" })).output as { items: { target: unknown }[] };
  expect(visible.items.map(item => item.target)).toContainEqual({ moduleId: f.beta.id, tool: "echo" });
  expect(visible.items.filter(item => typeof item.target === "object" && item.target && pausedIds.has((item.target as { moduleId: string }).moduleId))).toEqual([]);
  for (let attempt = 1; attempt <= 6; attempt++) {
    await runDueCalls(f.ports, f.workspace.id);
    for (const call of calls) expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: call.callId } })).toMatchObject({ attempts: attempt, status: attempt < 6 ? "queued" : "failed", error: expect.stringContaining("unavailable: paused") });
    f.advance(600_000);
  }
  expect(executed).toBe(0);
  expect(f.processes).toHaveLength(0);
  expect(await f.db.moduleRun.count()).toBe(0);
});

test("paused installed apps stay absent from owner and provider tool catalogs", async () => {
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({}) });
  for (const name of [...PAUSED_MODULE_NAMES, "ordinary"]) {
    const module = await f.db.module.create({ data: { workspaceId: f.workspace.id, name, activeHash: `${name}-v1` } });
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], tools: [tool("echo", { visibility: ["owner", "provider"] })] });
    await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: `${name}-v1`, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  }
  for (const audience of ["owner", "provider"] as const) {
    const catalog = await moduleToolCatalog(f.ports, { workspaceId: f.workspace.id, audience });
    expect(catalog.map(item => item.name)).toContain("m_ordinary_echo");
    expect(catalog.filter(item => PAUSED_MODULE_NAMES.some(name => item.namespace.name === `module_${name}`))).toEqual([]);
  }
  expect(f.processes).toHaveLength(0);
});

test("paused installed callers cannot invoke active tools or receive deferred results", async () => {
  const f = await fixture({ alpha: async () => ({}), beta: async () => ({}) });
  const origin = { ...kernelOrigin(f.workspace.id), caller: { kind: "module" as const, module: "alpha", moduleId: f.alpha.id, hash: "alpha-v1" } };
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "old-callback", reply: true });
  await f.db.moduleInvocation.update({ where: { id: queued.callId }, data: { status: "succeeded", output: {}, finishedAt: f.ports.now() } });
  await f.db.module.update({ where: { id: f.alpha.id }, data: { name: "remind" } });
  const caller = { ...origin, caller: { ...origin.caller, module: "remind" } };
  await expect(callSync(f.ports, caller, "beta.echo", {})).rejects.toMatchObject({ code: "forbidden" });
  await expect(enqueueCall({ tx: f.db, ports: f.ports, origin: caller, target: "beta.echo", raw: {} }, { key: "paused-caller" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(enqueueCall({ tx: f.db, ports: f.ports, origin: caller, target: "missing.echo", raw: {} }, { key: "paused-missing" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(enqueueCall({ tx: f.db, ports: f.ports, origin: caller, target: "beta.echo", raw: {} }, { key: "old-callback", reply: true })).rejects.toMatchObject({ code: "forbidden" });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({ repliedAt: null, replyAttempts: 0 });
  expect(await f.db.moduleInvocation.count()).toBe(1);
  expect(f.processes).toHaveLength(0);
  expect(await f.db.moduleRun.count()).toBe(0);
});

test("ordinary async calls reject absent Notify and other absent apps before queuing", async () => {
  const f = await fixture({ alpha: async (_event, call) => {
    const errors = [];
    for (const target of ["notify.send", "missing.echo"]) {
      const reply = await call("call", { target: { moduleId: target.split(".")[0]!, tool: target.split(".")[1]! }, args: {}, mode: "async", key: target, reply: false }) as { error?: { code: string } };
      errors.push(reply.error?.code);
    }
    return { result: { errors } };
  }, beta: async () => ({}) });
  expect(output(await f.fire())).toEqual({ errors: ["not_found", "not_found"] });
  expect(await f.db.moduleInvocation.count()).toBe(0);
});

async function betaV2(f: Awaited<ReturnType<typeof fixture>>) {
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  await f.db.moduleVersion.create({ data: { moduleId: f.beta.id, hash: "beta-v2", manifest: version.manifest!, source: "user", intent: {}, report: {}, status: "approved" } });
}

test("reviewed hash rejects a version changed since the prior read before any tool dispatch", async () => {
  const hashes: string[] = [];
  const f = await fixture({ alpha: async () => ({}), beta: async (_event, _call, input) => { hashes.push(input.codeDir.split("/").at(-1)!); return { result: "approved" }; } });
  const reviewed = await f.db.module.findUniqueOrThrow({ where: { id: f.beta.id } });
  const expectedTarget = { moduleId: reviewed.id, hash: reviewed.activeHash! }, origin = kernelOrigin(f.workspace.id);
  await betaV2(f);
  await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v2" } });
  await expect(callSync(f.ports, origin, { moduleId: f.beta.id, tool: "echo" }, {}, { expectedTarget })).rejects.toMatchObject({ code: "conflict" });
  await expect(enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "reviewed", expectedTarget })).rejects.toMatchObject({ code: "conflict" });
  expect(hashes).toEqual([]);
  expect(await f.db.moduleInvocation.count()).toBe(0);
  await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v1" } });
  const result = await callSync(f.ports, origin, "beta.echo", {}, { expectedTarget, key: "reviewed-sync" });
  expect(result.output).toBe("approved");
  expect(hashes).toEqual(["beta-v1"]);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: result.callId } })).toMatchObject({ targetModuleId: reviewed.id, targetHash: "beta-v1" });
});

test("dispatch fence rejects a hash switch after resolution and allows A to B to A only on resolved A", async () => {
  for (const restore of [false, true]) {
    const hashes: string[] = [];
    const f = await fixture({ alpha: async () => ({}), beta: async (_event, _call, input) => { hashes.push(input.codeDir.split("/").at(-1)!); return { result: "A" }; } });
    await betaV2(f);
    // Warm the real supervisor so the hook below occurs in beforeDelivery, after its activation check.
    await moduleSupervisor(f.ports).deliver(f.beta.id, "beta-v1", { ...startEvent, trigger: { ...startEvent.trigger, id: "echo" } });
    hashes.length = 0;
    let reads = 0;
    f.ports.db = f.db.$extends({ query: { module: { async findFirst({ args, query }) {
      // Keyless route resolution is the first name read. The second is the real beforeDelivery fence.
      // Change activation BEFORE the query so the fence observes the new state, not an old snapshot.
      if (args.where?.name === "beta" && ++reads === 2) {
        await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v2" } });
        if (restore) await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v1" } });
      }
      return query(args);
    } } } }) as typeof f.db;
    const result = callSync(f.ports, kernelOrigin(f.workspace.id), "beta.echo", {}, { expectedTarget: { moduleId: f.beta.id, hash: "beta-v1" } });
    if (restore) {
      const receipt = await result;
      expect(receipt.output).toBe("A");
      expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: receipt.callId } })).toMatchObject({ targetModuleId: f.beta.id, targetHash: "beta-v1" });
      expect(hashes).toEqual(["beta-v1"]);
    } else {
      await expect(result).rejects.toMatchObject({ code: "conflict" });
      expect(hashes).toEqual([]);
    }
    expect(reads).toBeGreaterThanOrEqual(2);
  }
});

test("async pinned command preserves its hash and original replay across activation changes", async () => {
  let calls = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; return { result: "original" }; } });
  await betaV2(f);
  const origin = kernelOrigin(f.workspace.id), expectedTarget = { moduleId: f.beta.id, hash: "beta-v1" };
  const input = { tx: f.db, ports: f.ports, origin, target: "beta.again", raw: { text: "original" } };
  const options = { key: "pinned-replay", expectedTarget };
  const queued = await enqueueCall(input, options);
  await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v2" } });
  expect(await enqueueCall(input, options)).toMatchObject({ callId: queued.callId, duplicate: true });
  await expect(enqueueCall(input, { ...options, expectedTarget: { ...expectedTarget, hash: "beta-v2" } })).rejects.toMatchObject({ code: "conflict" });
  await expect(enqueueCall({ ...input, raw: { text: "changed" } }, options)).rejects.toMatchObject({ code: "conflict" });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await callStatus(f.ports, origin, queued.callId)).toMatchObject({ status: "failed", error: expect.stringContaining("conflict") });
  expect(calls).toBe(0);
  // A fresh command may execute once A returns; later replay returns its original result even with B active.
  await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v1" } });
  const second = await enqueueCall(input, { ...options, key: "pinned-success" });
  await runDueCalls(f.ports, f.workspace.id);
  await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v2" } });
  expect(await enqueueCall(input, { ...options, key: "pinned-success" })).toMatchObject({ callId: second.callId, duplicate: true });
  expect(await callStatus(f.ports, origin, second.callId)).toMatchObject({ status: "succeeded", output: "original" });
  await runDueCalls(f.ports, f.workspace.id);
  expect(calls).toBe(1);
});

test("pinned calls report conflict when the replacement version removes the tool", async () => {
  let calls = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; return { result: "A" }; } });
  const origin = kernelOrigin(f.workspace.id), expectedTarget = { moduleId: f.beta.id, hash: "beta-v1" };
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "removed-tool", expectedTarget });
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.beta.id, hash: "beta-v1" } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  manifest.tools = manifest.tools.filter(tool => tool.name !== "echo");
  await f.db.moduleVersion.create({ data: { moduleId: f.beta.id, hash: "beta-v2", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v2" } });
  await expect(callSync(f.ports, origin, "beta.echo", {}, { expectedTarget })).rejects.toMatchObject({ code: "conflict" });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await callStatus(f.ports, origin, queued.callId)).toMatchObject({ status: "failed", error: expect.stringContaining("conflict") });
  expect(calls).toBe(0);
});

test("pinned sync replay keeps the original result after upgrade and rejects rebinding its key", async () => {
  let calls = 0;
  const f = await fixture({ alpha: async () => ({}), beta: async () => { calls++; return { result: "A" }; } });
  const origin = kernelOrigin(f.workspace.id), expectedTarget = { moduleId: f.beta.id, hash: "beta-v1" };
  const options = { key: "original-sync", expectedTarget };
  const original = await callSync(f.ports, origin, "beta.echo", {}, options);
  await betaV2(f);
  await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v2" } });
  expect(await callSync(f.ports, origin, "beta.echo", {}, options)).toEqual(original);
  await expect(callSync(f.ports, origin, "beta.echo", {}, { ...options, expectedTarget: { ...expectedTarget, hash: "beta-v2" } })).rejects.toMatchObject({ code: "conflict" });
  expect(calls).toBe(1);
});

test("moduleId-only commands remain unpinned and can use a newer active version", async () => {
  const hashes: string[] = [];
  const f = await fixture({ alpha: async () => ({}), beta: async (_event, _call, input) => { hashes.push(input.codeDir.split("/").at(-1)!); return { result: "compatible" }; } });
  const origin = kernelOrigin(f.workspace.id), expectedTarget = { moduleId: f.beta.id };
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "beta.echo", raw: {} }, { key: "identity-only", expectedTarget });
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({ targetHash: null });
  await betaV2(f);
  await f.db.module.update({ where: { id: f.beta.id }, data: { activeHash: "beta-v2" } });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await callStatus(f.ports, origin, queued.callId)).toMatchObject({ status: "succeeded", output: "compatible" });
  expect((await callSync(f.ports, origin, "beta.echo", {}, { expectedTarget })).output).toBe("compatible");
  expect(hashes).toEqual(["beta-v2", "beta-v2"]);
});
