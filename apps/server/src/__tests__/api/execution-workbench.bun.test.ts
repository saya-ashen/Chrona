import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BUILTIN_MODULE_NAMES, PREINSTALLED_MODULE_NAMES, moduleManifestSchema, type ExecutionPayload, type ExecutionView, type ProviderAdapter, type ProviderRunInput } from "@chrona/contracts/steward";
import { callSync } from "@chrona/engine";
import { PrismaClient } from "@chrona/db";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { testDb } from "@chrona/engine/test-support";
import { registerTestProvider } from "../../../../../packages/engine/src/modules/steward/test-provider";
import { moduleContext } from "../../../../../packages/engine/src/modules/steward/module-context";
import { switchActiveIn } from "../../../../../packages/engine/src/modules/steward/module-generation";
import { seedTestModuleRelease, testReleasePackages } from "../../../../../packages/engine/src/modules/steward/module-release-test-fixture";
import { requestRemove } from "../../../../../packages/engine/src/modules/steward/module-remove";
import { requestStatus } from "../../../../../packages/engine/src/modules/steward/module-status";
import { createServerApp } from "../../app";
import { resetEnvCacheForTests } from "../../config/env";
import { createStewardRuntime } from "../../steward-runtime";

type Outcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
/** Only the Provider is a test double: routing, SDK processes, questions and persistence are real. */
function controlledProvider() {
  const started: {
    input: ProviderRunInput; finish: (outcome: Outcome) => void; disconnect: () => void;
    aborted: number; stopOnAbort: boolean; messages: string[]; append(payload: ExecutionPayload): Promise<void>;
  }[] = [];
  const provider: ProviderAdapter = {
    name: "execution-integration", health: async () => ({ available: true, sandboxed: false, error: null }),
    start(input) {
      const done = deferred<Outcome>();
      let seq = 0;
      const run = {
        input, finish: done.resolve, disconnect: () => done.reject(new Error("Provider process exit was not observed")),
        aborted: 0, stopOnAbort: false, messages: [] as string[],
        async append(payload: ExecutionPayload) {
          if (!input.execution || !input.detail) throw new Error("Tick did not bind execution details");
          await input.detail.append({ ...input.execution, seq: ++seq, at: new Date().toISOString(), payload });
        },
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

// A test-owned application exercises general HTTP/execution trust.
const methods = ["run", "get", "stream", "inspect", "write", "interrupt", "respond"];
const savedKeys = ["API_KEY", "CHRONA_STEWARD_EXECUTION_MODE"] as const;
let saved: (string | undefined)[], root: string, project: string, workspaceId: string;
let db: ReturnType<typeof testDb>, runtime: ReturnType<typeof createStewardRuntime>;
let app: Awaited<ReturnType<typeof createServerApp>>, fake: ReturnType<typeof controlledProvider>;
let entry: { id: string; hash: string }, errors: unknown[];
async function boot() {
  runtime = createStewardRuntime(db, { dataDir: join(root, "data"), provider: fake.provider, onError: error => { errors.push(error); } });
  runtime.ports.moduleBuiltinResources = join(root, "builtin");
  runtime.ports.packages = testReleasePackages(runtime.ports.moduleBuiltinResources);
  app = await createServerApp({ steward: runtime });
}
beforeEach(async () => {
  saved = savedKeys.map(key => process.env[key]);
  process.env.API_KEY = "execution-integration-test";
  process.env.CHRONA_STEWARD_EXECUTION_MODE = "trusted-local"; resetEnvCacheForTests();
  root = await mkdtemp("/tmp/chrona-generic-execution-");
  project = join(root, "project"); await mkdir(project); project = await realpath(project);
  await writeFile(join(project, "AGENTS.md"), "Preserve existing.txt.\n");
  await writeFile(join(project, "existing.txt"), "existing\n");
  db = testDb(); fake = controlledProvider(); errors = [];
  const initialization = { version: 1, status: "complete", packages: Object.fromEntries([...PREINSTALLED_MODULE_NAMES, "mind", "remind"].map(name => [name, {
    requestKey: `fixture:${name}`, attempts: 1, status: "skipped", moduleId: null, hash: null, approvalId: null, error: null,
  }])) };
  workspaceId = (await db.workspace.create({ data: { name: "Generic execution acceptance", settings: { moduleInitialization: initialization } } })).id;
  const builtin = join(root, "builtin");
  await cp(resolve(import.meta.dirname, "../../../../../packages/engine/src/modules/steward/builtin"), builtin, { recursive: true });
  for (const name of BUILTIN_MODULE_NAMES) await seedTestModuleRelease(builtin, name);
  const manifest = moduleManifestSchema.parse({ name: "execution-test", entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, listen: "/api/execution-test",
    uses: methods.map(method => `agent.${method}`), tools: [{ name: "dispatch", description: "Owner execution fixture", visibility: ["owner"], parameters: { type: "object", properties: { tool: { type: "string" }, input: { type: "string" } }, required: ["tool", "input"] } }] });
  const module = await db.module.create({ data: { workspaceId, name: manifest.name, activeHash: "execution-fixture", status: "active" } });
  entry = { id: module.id, hash: "execution-fixture" };
  await db.moduleVersion.create({ data: { moduleId: entry.id, hash: entry.hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const code = join(root, "data/platform/store", entry.hash); await mkdir(code, { recursive: true });
  await writeFile(join(code, "index.ts"), `import { chrona, on, ModelError } from "chrona";
const methods = new Set(${JSON.stringify(methods)});
async function dispatch(tool, input) { if (!methods.has(tool)) throw new ModelError("forbidden", "Fixture method denied"); return chrona.call("agent." + tool, input); }
on("tool", async event => ({ result: await dispatch(event.args.tool, JSON.parse(event.args.input)) }));
chrona.serve(async request => { try { const { tool, input } = await request.json(); return Response.json({ result: await dispatch(tool, input) }); }
catch (error) { return Response.json({ error: { code: error.code, message: error.message } }, { status: 409 }); } });`);
  await writeFile(join(root, "data/execution-projects.json"), JSON.stringify({ projects: [{ workspaceId, ownerId: "owner", moduleId: entry.id, projectRef: "project", canonicalPath: project, baseline: "snapshot:fixture" }] }));
  await boot();
}, 30_000);
afterEach(async () => {
  for (const run of fake?.started ?? []) run.finish({ outcome: "failed", sessionId: null, error: "Test cleanup" });
  try { await runtime?.stop(); } finally {
    await db?.$disconnect(); if (root) await rm(root, { recursive: true, force: true });
    savedKeys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }); resetEnvCacheForTests();
  }
}, 30_000);
async function raw(tool: string, input: unknown) { return app.request("/api/execution-test/commands", { method: "POST", headers: { authorization: "Bearer execution-integration-test", "content-type": "application/json" }, body: JSON.stringify({ tool, input }) }); }
async function command(tool: string, input: unknown) {
  const response = await raw(tool, input), body = await response.json();
  expect({ status: response.status, error: body.error }).toEqual({ status: 200, error: undefined });
  return body.result;
}
const startInput = (executionId: string) => ({ executionId, requestKey: `start-${executionId}`, prompt: "Use native file tools; report only checks actually run.", projectRef: "project", budget: { timeoutMs: 60_000, maxToolCalls: 6 } });
const target = (view: ExecutionView) => ({ executionId: view.workId, runId: view.runId, attemptId: view.attemptId });
async function start(id: string) {
  const { execution: view } = await command("run", startInput(id)) as { execution: ExecutionView };
  const run = await until(async () => fake.started.find(run => run.input.runId === view.runId), Boolean, "Provider launch");
  return { view, run: run! };
}
function caller() { return { kind: "module" as const, module: "execution-test", moduleId: entry.id, hash: entry.hash }; }
function direct(who: Parameters<typeof callSync>[1]["caller"], tool: string, args: Record<string, unknown>) { return callSync(runtime.ports, { workspaceId, caller: who, chain: [], path: [] }, tool, args); }

test("generic HTTP execution retains auth, owner visibility, private fences, questions, replay and completion", async () => {
  expect((await app.request("/api/execution-test/commands", { method: "POST" })).status).toBe(401);
  expect((await app.request("/api/execution-test/commands", { method: "POST", headers: { authorization: "Bearer invalid" } })).status).toBe(401);
  const { view, run } = await start("complete");
  expect(run.input.cwd).toBe(project);
  expect(run.input.execution).toEqual({ workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId });
  expect(run.input.executionBudget).toEqual({ maxToolCalls: 6 });
  expect(run.input.content).toEqual([]); expect(run.input.hostPaths).toEqual([]);
  expect((await command("run", startInput("complete"))).execution).toMatchObject({ runId: view.runId, attemptId: view.attemptId });
  expect(fake.started).toHaveLength(1);
  for (const who of [{ kind: "owner" as const, via: null }, { kind: "provider" as const, runId: view.runId }, { kind: "kernel" as const }]) {
    await expect(direct(who, "agent.get", target(view))).rejects.toMatchObject({ code: "forbidden" });
  }
  await expect(direct({ kind: "provider", runId: view.runId }, "execution-test.dispatch", { tool: "get", input: JSON.stringify(target(view)) })).rejects.toMatchObject({ code: "forbidden" });
  expect((await direct({ kind: "owner", via: null }, "execution-test.dispatch", { tool: "get", input: JSON.stringify(target(view)) })).output).toMatchObject({ runId: view.runId });
  const other = await db.module.create({ data: { workspaceId, name: "other-execution-test", activeHash: "other-fixture" } });
  await db.moduleVersion.create({ data: { moduleId: other.id, hash: "other-fixture", source: "user", status: "approved", intent: {}, report: {},
    manifest: moduleManifestSchema.parse({ name: other.name, entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["agent.get"], tools: [{ name: "noop", description: "Unused identity fixture", visibility: ["owner"], parameters: { type: "object", properties: {} } }] }) } });
  await expect(direct({ kind: "module", module: other.name, moduleId: other.id, hash: "other-fixture" }, "agent.get", target(view))).rejects.toMatchObject({ code: "not_found" });
  const invocations = await db.moduleInvocation.findMany();
  expect(invocations.length).toBeGreaterThan(0);
  expect(JSON.stringify(invocations)).not.toContain(startInput("complete").prompt);
  for (const _ of [1, 2]) await command("write", { ...target(view), requestKey: "write-once", text: "Preserve existing.txt" });
  expect(run.messages).toEqual(["Preserve existing.txt"]);
  for (const [method, value] of [["confirm", false], ["select", 0]] as const) {
    const answer = run.input.events!.question({ method, title: method, message: "Choose", options: method === "select" ? ["first", "second"] : [], timeoutMs: 30_000 }, new AbortController().signal);
    const inspected = await until(() => command("inspect", target(view)), result => result.snapshot.questions.some((q: { method: string; status: string }) => q.method === method && q.status === "pending"), `persisted ${method}`);
    const question = inspected.snapshot.questions.find((q: { method: string; status: string }) => q.method === method && q.status === "pending");
    await command("respond", { ...target(view), requestKey: `answer-${method}`, questionId: question.requestId, answer: JSON.stringify({ decision: "submit", value }) });
    expect(await answer).toEqual({ decision: "submit", value });
    expect((await command("inspect", target(view))).snapshot.questions.find((q: { requestId: string }) => q.requestId === question.requestId).status).toBe("answered");
  }
  await run.append({ type: "message", messageId: "final", role: "assistant", text: "No check command was run.", complete: true });
  const before = await command("stream", { ...target(view), limit: 100 });
  run.finish({ outcome: "finished", sessionId: "fixture-session", error: null });
  await until(() => command("get", target(view)), result => result.stopConfirmed, "confirmed completion");
  expect((await command("inspect", target(view))).snapshot).toMatchObject({ status: "completed", stopConfirmed: true });
  expect((await command("stream", { ...target(view), cursor: before.cursor, limit: 100 })).snapshotRequired).toBe(true);
  expect(await readFile(join(project, "existing.txt"), "utf8")).toBe("existing\n");
  expect(await db.module.count({ where: { name: { in: ["coding", "mcp", "mind", "remind"] } } })).toBe(0);
  expect(errors).toEqual([]);
}, 30_000);

test("HTTP cancellation keeps the live attempt held until exit; lifecycle operations cannot hide it", async () => {
  const { view, run } = await start("cancel"), context = moduleContext(runtime.ports, workspaceId);
  await expect(requestStatus(context, entry.id, "paused", "fixture pause")).rejects.toMatchObject({ code: "conflict" });
  await expect(db.$transaction(tx => switchActiveIn(context, tx, entry.id, "replacement"))).rejects.toMatchObject({ code: "conflict" });
  await expect(requestRemove(context, entry.id, "fixture removal")).rejects.toMatchObject({ code: "conflict" });
  await command("interrupt", { ...target(view), requestKey: "cancel-once" });
  expect(run.aborted).toBe(1);
  expect(await command("get", target(view))).toMatchObject({ status: "unknown", cancelRequested: true, stopConfirmed: false });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).heldDirectory).toBe(`execution:${view.runId}`);
  const conflict = await raw("run", { ...startInput(view.workId), requestKey: "before-stop" });
  expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ error: { code: "conflict" } });
  run.finish({ outcome: "failed", sessionId: null, error: "Process exited after cancellation" });
  expect(await until(() => command("get", target(view)), result => result.stopConfirmed, "actual exit")).toMatchObject({ status: "cancelled", stopConfirmed: true });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).heldDirectory).toBeNull();
  await requestStatus(context, entry.id, "paused", "Stop checked");
  await expect(direct(caller(), "agent.get", target(view))).rejects.toMatchObject({ code: "forbidden" });
  expect(errors).toEqual([]);
}, 30_000);

test("HTTP interrupt completes without a handler deadlock when the controlled process exits during abort", async () => {
  const { view, run } = await start("exit-on-abort"); run.stopOnAbort = true;
  await command("interrupt", { ...target(view), requestKey: "interrupt-once" });
  expect(run.aborted).toBe(1);
  expect(await until(() => command("get", target(view)), result => result.stopConfirmed, "abort completion")).toMatchObject({ status: "cancelled", stopConfirmed: true });
  expect(errors).toEqual([]);
}, 30_000);

test("unknown execution survives a fresh HTTP runtime without releasing or restarting; stale hashes fail closed", async () => {
  const { view, run } = await start("restart");
  const before = await command("stream", { ...target(view), limit: 100 }); run.disconnect();
  await runtime.service.tick.settled({ includeRuns: true });
  await until(() => db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } }), row => row.capabilityRevokedAt !== null, "unknown finalization");
  const [database] = await db.$queryRawUnsafe<{ file: string }[]>("PRAGMA database_list");
  await runtime.stop(); await db.$disconnect();
  db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: `file:${database!.file}` }) });
  registerTestProvider(db);
  await boot();
  expect(await command("get", target(view))).toMatchObject({ status: "unknown", stopConfirmed: false });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).heldDirectory).toBe(`execution:${view.runId}`);
  expect((await command("stream", { ...target(view), cursor: before.cursor, limit: 100 })).snapshotRequired).toBe(true);
  expect(fake.started).toHaveLength(1);
  await expect(direct(caller(), "agent.get", { ...target(view), attemptId: "foreign-attempt" })).rejects.toMatchObject({ code: "conflict" });
  const oldCaller = caller();
  await db.module.update({ where: { id: entry.id }, data: { activeHash: "externally-stale" } });
  await expect(direct(oldCaller, "agent.get", target(view))).rejects.toMatchObject({ code: "forbidden" });
  await db.module.update({ where: { id: entry.id }, data: { activeHash: entry.hash } });
  expect(fake.started).toHaveLength(1); expect(errors).toEqual([]);
}, 30_000);
