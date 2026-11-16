import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PREINSTALLED_MODULE_NAMES, moduleManifestSchema, type ProviderAdapter, type ProviderRunInput } from "@chrona/contracts/steward";
import { callSync } from "@chrona/engine";
import { PrismaClient } from "@chrona/db";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { testDb } from "@chrona/engine/test-support";
import { registerTestProvider, testProviderPorts } from "../../../../../packages/engine/src/modules/steward/test-provider";
import { moduleContext } from "../../../../../packages/engine/src/modules/steward/module-context";
import { switchActiveIn } from "../../../../../packages/engine/src/modules/steward/module-generation";
import { requestRemove } from "../../../../../packages/engine/src/modules/steward/module-remove";
import { requestStatus } from "../../../../../packages/engine/src/modules/steward/module-status";
import { createServerApp } from "../../app";
import { resetEnvCacheForTests } from "../../config/env";
import { createStewardRuntime } from "../../steward-runtime";

type Outcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
type RunView = { runId: string; contextId: string; status: string; active: boolean };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
/** Only the backend is controlled: registration, private Provider IPC, HTTP and the application's SDK are real. */
function controlledProvider() {
  const started: {
    input: ProviderRunInput; finish: (outcome: Outcome) => void; disconnect: () => void;
    aborted: number; stopOnAbort: boolean; messages: string[];
  }[] = [];
  const provider: ProviderAdapter = {
    name: "workbench-provider", health: async () => ({ available: true, sandboxed: false, error: null }),
    start(input) {
      const done = deferred<Outcome>();
      const run = {
        input, finish: done.resolve, disconnect: () => done.reject(new Error("Provider process exit was not observed")),
        aborted: 0, stopOnAbort: false, messages: [] as string[],
      };
      started.push(run);
      return { done: done.promise, inject: async text => { run.messages.push(text); }, abort: async () => {
        run.aborted++;
        if (run.stopOnAbort) { done.resolve({ outcome: "failed", sessionId: null, error: "Process exited after abort" }); await done.promise; }
      } };
    },
  };
  return { provider, started };
}
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  let value = await read();
  while (!ready(value) && Date.now() < deadline) { await Bun.sleep(25); value = await read(); }
  if (!ready(value)) throw new Error(`Timed out: ${label}; last value: ${JSON.stringify(value)}`);
  return value;
}

const methods = ["providers", "run", "read", "write", "stop", "native"];
const savedKeys = ["API_KEY", "CHRONA_STEWARD_EXECUTION_MODE"] as const;
let saved: (string | undefined)[], root: string, databaseFile: string, workspaceId: string;
let db: ReturnType<typeof testDb>, runtime: ReturnType<typeof createStewardRuntime>;
let app: Awaited<ReturnType<typeof createServerApp>>, fake: ReturnType<typeof controlledProvider>;
let entry: { id: string; hash: string }, errors: unknown[];
async function boot() {
  runtime = createStewardRuntime(db, { dataDir: join(root, "data"), provider: fake.provider, onError: error => { errors.push(error); } });
  await testProviderPorts(runtime.ports);
  app = await createServerApp({ steward: runtime });
}
beforeEach(async () => {
  saved = savedKeys.map(key => process.env[key]);
  process.env.API_KEY = "execution-integration-test";
  process.env.CHRONA_STEWARD_EXECUTION_MODE = "trusted-local"; resetEnvCacheForTests();
  root = await mkdtemp("/tmp/chrona-workbench-");
  db = testDb(); fake = controlledProvider(); errors = [];
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  databaseFile = databases.find(row => row.name === "main")!.file;
  const initialization = { version: 1, status: "complete", packages: Object.fromEntries([...PREINSTALLED_MODULE_NAMES, "mind", "remind"].map(name => [name, {
    requestKey: `fixture:${name}`, attempts: 1, status: "skipped", moduleId: null, hash: null, approvalId: null, error: null,
  }])) };
  workspaceId = (await db.workspace.create({ data: { name: "Generic workbench acceptance", settings: { moduleInitialization: initialization } } })).id;
  const manifest = moduleManifestSchema.parse({ name: "execution-test", entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, listen: "/api/execution-test",
    uses: methods.map(method => `agent.${method}`), tools: [{ name: "dispatch", description: "Owner Agent fixture", visibility: ["owner"],
      parameters: { type: "object", properties: { tool: { type: "string" }, input: { type: "string" }, key: { type: "string" } }, required: ["tool", "input"] }, output: {} }] });
  const module = await db.module.create({ data: { workspaceId, name: manifest.name, activeHash: "execution-fixture", status: "active" } });
  entry = { id: module.id, hash: "execution-fixture" };
  await db.moduleVersion.create({ data: { moduleId: entry.id, hash: entry.hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const code = join(root, "data/platform/store", entry.hash); await mkdir(code, { recursive: true });
  await writeFile(join(code, "index.ts"), `import { chrona, on, ModelError } from "chrona";
const methods = new Set(${JSON.stringify(methods)});
async function dispatch(tool, input, key) { if (!methods.has(tool)) throw new ModelError("forbidden", "Fixture method denied"); return chrona.call("agent." + tool, input, key ? { key } : {}); }
on("tool", async event => ({ result: await dispatch(event.args.tool, JSON.parse(event.args.input), event.args.key) }));
chrona.serve(async request => { try { const { tool, input, key } = await request.json(); return Response.json({ result: await dispatch(tool, input, key) }); }
catch (error) { return Response.json({ error: { code: error.code, message: error.message } }, { status: 409 }); } });`);
  await boot();
}, 30_000);
afterEach(async () => {
  for (const run of fake?.started ?? []) run.finish({ outcome: "failed", sessionId: null, error: "Test cleanup" });
  try { await runtime?.stop(); } finally {
    await db?.$disconnect();
    if (root) await rm(root, { recursive: true, force: true });
    if (databaseFile) await rm(dirname(databaseFile), { recursive: true, force: true });
    savedKeys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }); resetEnvCacheForTests();
  }
}, 30_000);
async function raw(tool: string, input: unknown, key?: string) { return app.request("/api/execution-test/commands", { method: "POST", headers: { authorization: "Bearer execution-integration-test", "content-type": "application/json" }, body: JSON.stringify({ tool, input, key }) }); }
async function command(tool: string, input: unknown, key?: string) {
  const response = await raw(tool, input, key), body = await response.json();
  expect({ status: response.status, error: body.error }).toEqual({ status: 200, error: undefined });
  return body.result;
}
async function refused(tool: string, input: unknown, code: string, key?: string) {
  const response = await raw(tool, input, key);
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: { code } });
}
const startInput = (extra: Record<string, unknown> = {}) => ({ providerId: fake.provider.name, prompt: "Report only checks actually run.", ...extra });
const target = (view: RunView) => ({ runId: view.runId });
async function start(key: string) {
  const view = await command("run", startInput(), key) as RunView;
  const run = await until(async () => fake.started.find(run => run.input.runId === view.runId), Boolean, "Provider launch");
  return { view, run: run! };
}
function caller() { return { kind: "module" as const, module: "execution-test", moduleId: entry.id, hash: entry.hash }; }
function direct(who: Parameters<typeof callSync>[1]["caller"], tool: string, args: Record<string, unknown>, key?: string) { return callSync(runtime.ports, { workspaceId, caller: who, chain: [], path: [] }, tool, args, { key }); }
async function lifecycleRefused() {
  const context = moduleContext(runtime.ports, workspaceId);
  await expect(requestStatus(context, entry.id, "paused", "fixture pause")).rejects.toMatchObject({ code: "conflict" });
  await expect(db.$transaction(tx => switchActiveIn(context, tx, entry.id, "replacement"))).rejects.toMatchObject({ code: "conflict" });
  await expect(requestRemove(context, entry.id, "fixture removal")).rejects.toMatchObject({ code: "conflict" });
}

test("HTTP Agent Runs retain auth, actual SDK caller identity, private fences, queue replay, questions and completion", async () => {
  expect((await app.request("/api/execution-test/commands", { method: "POST" })).status).toBe(401);
  expect((await app.request("/api/execution-test/commands", { method: "POST", headers: { authorization: "Bearer invalid" } })).status).toBe(401);
  expect(await command("providers", {})).toMatchObject({ items: [expect.objectContaining({ id: fake.provider.name, available: true })] });
  // Hold the queue to prove that admission replay does not create or launch another Run.
  const onQueued = runtime.ports.onQueued; runtime.ports.onQueued = async () => {};
  const view = await command("run", startInput(), "complete") as RunView;
  expect(view).toMatchObject({ status: "queued", active: true });
  expect(await command("run", startInput(), "complete")).toEqual(view);
  await refused("run", startInput({ prompt: "Changed prompt" }), "conflict", "complete");
  await refused("run", startInput(), "invalid");
  expect(await db.run.count()).toBe(1); expect(fake.started).toHaveLength(0);
  runtime.ports.onQueued = onQueued; await runtime.tickOnce();
  const run = (await until(async () => fake.started.find(row => row.input.runId === view.runId), Boolean, "queued Provider launch"))!;
  expect(run.input.cwd).toBe(join(root, "data/sessions", view.contextId));
  await writeFile(join(run.input.cwd, "existing.txt"), "existing\n");
  expect(run.input.execution).toBeUndefined(); expect(run.input.content).toEqual([]); expect(run.input.hostPaths).toEqual([]);
  expect(await db.agentRunAdmission.findUniqueOrThrow({ where: { runId: view.runId } })).toMatchObject({ moduleId: entry.id, hash: entry.hash });
  expect(await db.agentContext.findUniqueOrThrow({ where: { sessionId: view.contextId } })).toMatchObject({ workspaceId, moduleId: entry.id, hash: entry.hash, providerId: fake.provider.name });
  const providerModule = await db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId, name: "test-provider" } } });
  expect(providerModule.builtin).toBe(false);
  expect(await db.agentRunProvider.findUniqueOrThrow({ where: { runId: view.runId } })).toMatchObject({ moduleId: providerModule.id, hash: providerModule.activeHash });
  for (const who of [{ kind: "owner" as const, via: null }, { kind: "provider" as const, runId: view.runId }, { kind: "kernel" as const }]) {
    await expect(direct(who, "agent.read", target(view))).rejects.toMatchObject({ code: "forbidden" });
  }
  await expect(direct({ kind: "provider", runId: view.runId }, "execution-test.dispatch", { tool: "read", input: JSON.stringify(target(view)) })).rejects.toMatchObject({ code: "forbidden" });
  expect((await direct({ kind: "owner", via: null }, "execution-test.dispatch", { tool: "read", input: JSON.stringify(target(view)) })).output).toMatchObject({ run: { runId: view.runId } });
  // Owner and module callers cannot reach the Provider's kernel-only operation endpoints.
  for (const who of [{ kind: "owner" as const, via: null }, caller()]) {
    await expect(direct(who, "test-provider.abort", { operationId: view.runId })).rejects.toMatchObject({ code: "forbidden" });
  }
  expect(run.aborted).toBe(0);
  const other = await db.module.create({ data: { workspaceId, name: "other-execution-test", activeHash: "other-fixture" } });
  await db.moduleVersion.create({ data: { moduleId: other.id, hash: "other-fixture", source: "user", status: "approved", intent: {}, report: {},
    manifest: moduleManifestSchema.parse({ name: other.name, entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["agent.read", "agent.write", "agent.stop"],
      tools: [{ name: "noop", description: "Unused identity fixture", visibility: ["owner"], parameters: { type: "object", properties: {} }, output: {} }] }) } });
  const intruder = { kind: "module" as const, module: other.name, moduleId: other.id, hash: "other-fixture" };
  await expect(direct(intruder, "agent.read", target(view))).rejects.toMatchObject({ code: "not_found" });
  await expect(direct(intruder, "agent.write", { ...target(view), input: { kind: "message", text: "foreign" } }, "foreign-write")).rejects.toMatchObject({ code: "not_found" });
  await expect(direct(intruder, "agent.stop", target(view), "foreign-stop")).rejects.toMatchObject({ code: "not_found" });
  await refused("native", { ...target(view), request: { type: "unsupported" } }, "unavailable", "native");
  for (const _ of [1, 2]) await command("write", { ...target(view), input: { kind: "message", text: "Preserve existing files" } }, "write-once");
  await refused("write", { ...target(view), input: { kind: "message", text: "Changed message" } }, "conflict", "write-once");
  expect(run.messages).toEqual(["Preserve existing files"]);
  for (const [method, value] of [["confirm", false], ["select", 0]] as const) {
    const answer = run.input.events!.question({ method, title: method, message: "Choose", options: method === "select" ? ["first", "second"] : [], timeoutMs: 30_000 }, new AbortController().signal);
    const inspected = await until(() => command("read", target(view)), result => result.interactions.some((q: { question: { method: string }; status: string }) => q.question.method === method && q.status === "pending"), `persisted ${method}`);
    const question = inspected.interactions.find((q: { question: { method: string }; status: string }) => q.question.method === method && q.status === "pending");
    const input = { ...target(view), input: { kind: "answer", questionId: question.id, answer: { decision: "submit", value } } };
    await command("write", input, `answer-${method}`);
    expect(await answer).toEqual({ decision: "submit", value });
    expect((await command("read", target(view))).interactions.find((q: { id: string }) => q.id === question.id).status).toBe("answered");
    // A duplicate answer receipt replays even though the live question has already closed.
    expect(await command("write", input, `answer-${method}`)).toEqual({ accepted: true });
  }
  await run.input.events!.progress({ phase: "reading", tool: "read" });
  await run.input.events!.raw!({ type: "assistant_message", text: "No check command was run." });
  const before = await command("read", { ...target(view), limit: 1 });
  expect(before.nextCursor).toBeString();
  await run.input.events!.progress({ phase: "writing", tool: "write" });
  expect((await command("read", { ...target(view), view: "native" })).items).toContainEqual(expect.objectContaining({ kind: "raw", payload: expect.objectContaining({ value: { type: "assistant_message", text: "No check command was run." } }) }));
  await refused("read", { ...target(view), view: "native", cursor: before.nextCursor }, "invalid");
  run.finish({ outcome: "finished", sessionId: "fixture-session", error: null });
  const completed = await until(() => command("read", target(view)), result => result.ended, "confirmed completion");
  expect(completed.run).toMatchObject({ status: "finished", active: false });
  expect(await db.run.findUniqueOrThrow({ where: { id: view.runId } })).toMatchObject({ stopStatus: "confirmed" });
  const replay = await command("read", { ...target(view), cursor: before.nextCursor });
  expect(replay.ended).toBe(true); expect(replay.items.every((item: { sequence: number }) => item.sequence > before.items[0].sequence)).toBe(true);
  expect(replay.items).toContainEqual(expect.objectContaining({ kind: "progress", payload: expect.objectContaining({ value: { phase: "writing", tool: "write" } }) }));
  const invocations = await db.moduleInvocation.findMany();
  expect(invocations.length).toBeGreaterThan(0); expect(JSON.stringify(invocations)).not.toContain(startInput().prompt); expect(JSON.stringify(invocations)).not.toContain(run.input.token);
  expect(await readFile(join(run.input.cwd, "existing.txt"), "utf8")).toBe("existing\n");
  expect(await db.module.count({ where: { name: { in: ["agent", "coding", "mcp", "mind", "remind"] } } })).toBe(0);
  expect(errors).toEqual([]);
}, 30_000);

test("HTTP stop acknowledgement retains the live Run and blocks lifecycle changes until actual exit", async () => {
  const { view, run } = await start("cancel");
  expect(await command("stop", target(view), "cancel-once")).toMatchObject({ active: true, stopConfirmed: false });
  expect(await command("stop", target(view), "cancel-once")).toMatchObject({ stopConfirmed: false });
  expect(run.aborted).toBe(1);
  expect(await db.run.findUniqueOrThrow({ where: { id: view.runId } })).toMatchObject({ status: "running", stopStatus: "pending", cancelRequestedAt: expect.any(Date) });
  await refused("run", startInput({ contextId: view.contextId }), "conflict", "before-stop");
  await refused("write", { ...target(view), input: { kind: "message", text: "after stop" } }, "conflict", "after-stop");
  await lifecycleRefused();
  // The fence preserves reads needed to drain existing work while rejecting new work.
  expect((await direct(caller(), "agent.read", target(view))).output).toMatchObject({ run: { runId: view.runId, status: "running", active: true } });
  await expect(direct(caller(), "agent.run", startInput(), "fenced-new-run")).rejects.toMatchObject({ code: "forbidden" });
  expect(await db.providerLaunch.findUnique({ where: { runId: view.runId } })).not.toBeNull();
  expect(await db.run.findUniqueOrThrow({ where: { id: view.runId } })).toMatchObject({ status: "running", stopStatus: "pending" });
  run.finish({ outcome: "failed", sessionId: null, error: "Process exited after cancellation" });
  expect(await until(() => db.run.findUniqueOrThrow({ where: { id: view.runId } }), row => row.stopStatus === "confirmed", "actual exit")).toMatchObject({ status: "cancelled" });
  await requestStatus(moduleContext(runtime.ports, workspaceId), entry.id, "paused", "Stop checked");
  await expect(direct(caller(), "agent.read", target(view))).rejects.toMatchObject({ code: "forbidden" });
  expect(fake.started).toHaveLength(1); expect(errors).toEqual([]);
}, 30_000);

test("HTTP stop completes without a handler deadlock when the ordinary Provider exits during abort", async () => {
  const { view, run } = await start("exit-on-abort"); run.stopOnAbort = true;
  await command("stop", target(view), "stop-once");
  expect(run.aborted).toBe(1);
  expect((await until(() => command("read", target(view)), result => result.ended, "abort completion")).run).toMatchObject({ status: "cancelled", active: false });
  expect(await db.run.findUniqueOrThrow({ where: { id: view.runId } })).toMatchObject({ stopStatus: "confirmed" });
  expect(errors).toEqual([]);
}, 30_000);

test("unknown stop survives a fresh HTTP runtime, retains queue capacity and lifecycle evidence, and rejects stale callers", async () => {
  const { view, run } = await start("restart");
  await run.input.events!.progress({ phase: "reading", tool: "read" });
  const before = await command("read", { ...target(view), limit: 1 });
  await run.input.events!.progress({ phase: "waiting", tool: null });
  expect(await command("stop", target(view), "stop-before-restart")).toMatchObject({ status: "running", active: true, stopConfirmed: false });
  const aborted = run.aborted;
  expect(aborted).toBe(1);
  run.disconnect();
  await until(() => db.run.findUniqueOrThrow({ where: { id: view.runId } }), row => row.stopStatus === "unknown", "unknown finalization");
  await runtime.service.tick.settled({ includeRuns: true });
  expect((await command("read", target(view))).run).toMatchObject({ status: "unknown", active: true });
  const retainedLaunch = await db.providerLaunch.findUniqueOrThrow({ where: { runId: view.runId } });
  const retainedBinding = await db.agentRunProvider.findUniqueOrThrow({ where: { runId: view.runId } });
  const queued = await command("run", startInput(), "queued-behind-unknown") as RunView;
  expect(queued.status).toBe("queued");
  await runtime.tickOnce(); expect(fake.started).toHaveLength(1);
  await runtime.stop(); await db.$disconnect();
  db = registerTestProvider(new PrismaClient({ adapter: new PrismaBunSqlite({ url: `file:${databaseFile}` }) }));
  await boot(); await runtime.tickOnce();
  expect((await command("read", target(view))).run).toMatchObject({ status: "unknown", active: true });
  expect(await db.providerLaunch.findUniqueOrThrow({ where: { runId: view.runId } })).toEqual(retainedLaunch);
  expect(await db.agentRunProvider.findUniqueOrThrow({ where: { runId: view.runId } })).toEqual(retainedBinding);
  const replay = await command("read", { ...target(view), cursor: before.nextCursor });
  expect(replay).toMatchObject({ ended: false, nextCursor: expect.any(String) });
  expect(replay.items).toContainEqual(expect.objectContaining({ kind: "progress", payload: expect.objectContaining({ value: { phase: "waiting", tool: null } }) }));
  expect(replay.items.every((item: { sequence: number }) => item.sequence > before.items[0].sequence)).toBe(true);
  expect((await command("read", target(view))).items).toContainEqual(expect.objectContaining({ kind: "progress", payload: expect.objectContaining({ value: { phase: "reading", tool: "read" } }) }));
  expect((await command("read", target(queued))).run).toMatchObject({ status: "queued", active: true });
  await refused("read", { ...target(queued), cursor: before.nextCursor }, "invalid");
  await refused("run", startInput({ contextId: view.contextId }), "conflict", "retry-unknown");
  expect(await command("run", startInput(), "restart")).toEqual(view);
  expect(await command("stop", target(view), "stop-before-restart")).toEqual({ ...view, status: "unknown", active: true, stopConfirmed: false });
  expect(run.aborted).toBe(aborted);
  expect((await command("read", target(view))).run).toMatchObject({ status: "unknown", active: true });
  expect(fake.started).toHaveLength(1);
  const oldCaller = caller();
  await db.module.update({ where: { id: entry.id }, data: { activeHash: "externally-stale" } });
  await expect(direct(oldCaller, "agent.read", target(view))).rejects.toMatchObject({ code: "forbidden" });
  await db.module.update({ where: { id: entry.id }, data: { activeHash: entry.hash } });
  await lifecycleRefused();
  expect((await direct(caller(), "agent.read", target(view))).output).toMatchObject({ run: { status: "unknown", active: true } });
  expect(await db.run.findUniqueOrThrow({ where: { id: view.runId } })).toMatchObject({ stopStatus: "unknown", cancelRequestedAt: expect.any(Date) });
  expect(await db.providerLaunch.findUniqueOrThrow({ where: { runId: view.runId } })).toEqual(retainedLaunch);
  expect(fake.started).toHaveLength(1); expect(errors).toEqual([]);
}, 30_000);
