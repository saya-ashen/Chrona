import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  EDITOR_HTTP, EXECUTION_PROTOCOL, PREINSTALLED_MODULE_NAMES, editorResponseDataSchemas,
  moduleManifestSchema, type ExecutionCommand, type ExecutionEventPage, type ExecutionPayload,
  type ExecutionResult, type ExecutionSnapshot, type ExecutionView, type ProviderAdapter, type ProviderRunInput,
} from "@chrona/contracts/steward";
import { callSync, moduleSupervisor } from "@chrona/engine";
import { testDb } from "@chrona/engine/test-support";
import { buildExecutionContracts } from "../../../../../build/execution-contracts";
import { moduleContext } from "../../../../../packages/engine/src/modules/steward/module-context";
import { switchActiveIn } from "../../../../../packages/engine/src/modules/steward/module-generation";
import { resolveExternalRelease } from "../../../../../packages/engine/src/modules/steward/module-release";
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

const sourceRoot = resolve(import.meta.dirname, "../../../../..");
const environmentKeys = ["API_KEY", "CHRONA_STEWARD_EXECUTION_MODE"] as const;
let savedEnvironment: (string | undefined)[], root: string, project: string;
let db: ReturnType<typeof testDb>, runtime: ReturnType<typeof createStewardRuntime>;
let app: Awaited<ReturnType<typeof createServerApp>>, fake: ReturnType<typeof controlledProvider>;
let coding: { id: string; hash: string }, workspaceId: string, request = 0;
let errors: unknown[];

async function boot() {
  runtime = createStewardRuntime(db, { dataDir: join(root, "data"), provider: fake.provider, onError: error => { errors.push(error); } });
  runtime.ports.moduleExternalResources = join(root, "external");
  await moduleSupervisor(runtime.ports).start();
  app = await createServerApp({ steward: runtime });
}
beforeEach(async () => {
  savedEnvironment = environmentKeys.map(key => process.env[key]);
  process.env.API_KEY = "execution-integration-test";
  process.env.CHRONA_STEWARD_EXECUTION_MODE = "trusted-local";
  resetEnvCacheForTests();
  root = await mkdtemp(join(tmpdir(), "chrona-execution-loop-"));
  project = join(root, "project");
  await mkdir(project);
  project = await realpath(project);
  await writeFile(join(project, "AGENTS.md"), "Integration project rule: preserve the existing file.\n");
  await writeFile(join(project, "existing.txt"), "existing\n");
  db = testDb(); fake = controlledProvider(); errors = [];
  // Existing official preinstalls are recorded as handled; this fixture never queues their installation.
  const initialization = { version: 1, status: "complete", packages: Object.fromEntries(PREINSTALLED_MODULE_NAMES.map(name => [name, {
    requestKey: `integration:${name}`, attempts: 1, status: "skipped", moduleId: null, hash: null, approvalId: null, error: null,
  }])) };
  workspaceId = (await db.workspace.create({ data: { name: "Execution integration", settings: { moduleInitialization: initialization } } })).id;
  const externalRoot = join(root, "external");
  await mkdir(externalRoot);
  for (const name of ["coding", "editor"]) await cp(join(sourceRoot, "packages/engine/src/modules/steward/external", name), join(externalRoot, name), { recursive: true });
  // Official generator, actual package source, private build output. No replacement handlers or contract fixtures.
  expect(await buildExecutionContracts(externalRoot)).toEqual(["coding", "editor"]);
  for (const name of ["coding", "editor"]) {
    const release = await resolveExternalRelease({ moduleExternalResources: externalRoot }, name);
    const module = await db.module.create({ data: { workspaceId, name, activeHash: release.hash, status: "active", dataSchema: release.manifest.data.schema } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: release.hash, manifest: release.manifest, source: "user", intent: {}, report: {}, status: "approved" } });
    await mkdir(join(root, "data/platform/store"), { recursive: true });
    await cp(release.codeDir, join(root, "data/platform/store", release.hash), { recursive: true });
    if (name === "coding") coding = { id: module.id, hash: release.hash };
  }
  await writeFile(join(root, "data/execution-projects.json"), JSON.stringify({ projects: [{
    workspaceId, ownerId: "owner", moduleId: coding.id, projectRef: "project", canonicalPath: project, baseline: "snapshot:integration-baseline",
  }] }));
  await boot();
}, 30_000);

afterEach(async () => {
  // Resolve every fake process before runtime.stop, whose production shutdown correctly waits for actual done.
  for (const run of fake?.started ?? []) run.finish({ outcome: "failed", sessionId: null, error: "Test cleanup" });
  try { await runtime?.stop(); }
  finally {
    await db?.$disconnect();
    if (root) await rm(root, { recursive: true, force: true });
    environmentKeys.forEach((key, i) => { if (savedEnvironment[i] === undefined) delete process.env[key]; else process.env[key] = savedEnvironment[i]; });
    resetEnvCacheForTests();
  }
}, 30_000);

async function command<K extends ExecutionCommand["op"]>(input: Extract<ExecutionCommand, { op: K }>) {
  const response = await app.request(EDITOR_HTTP.commands, {
    method: "POST", headers: { authorization: "Bearer execution-integration-test", "content-type": "application/json" },
    body: JSON.stringify({ v: EXECUTION_PROTOCOL, requestId: `http-${++request}`, command: input }),
  });
  const body = await response.json() as { ok: boolean; data?: unknown; error?: unknown };
  expect({ status: response.status, error: body.error }).toEqual({ status: 200, error: undefined });
  expect(body.ok).toBe(true);
  return editorResponseDataSchemas[input.op].parse(body.data);
}
const startInput = (workId: string) => ({ op: "start" as const, workId, projectRef: "project", commandKey: `start-${workId}`, goal: "Write a temporary project file and report the checks actually run.", budget: { timeoutMs: 60_000, maxToolCalls: 6 } });
const target = (view: ExecutionView) => ({ workId: view.workId, runId: view.runId, attemptId: view.attemptId });
async function start(workId: string) {
  const view = await command(startInput(workId)) as ExecutionView;
  await until(async () => fake.started.find(run => run.input.runId === view.runId), Boolean, "Provider launch");
  return { view, run: fake.started.find(run => run.input.runId === view.runId)! };
}
async function storedWork(workId: string) {
  return JSON.parse(await readFile(join(root, "data/platform/data", coding.id, `${workId}.json`), "utf8")) as { results: ExecutionResult[]; acceptances: unknown[] };
}
function ownerCall(tool: string, args: Record<string, unknown>) {
  return callSync(runtime.ports, { workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, tool, args);
}

test("real editor/SDK/runtime persists questions, detach, completion and human acceptance behind host auth", async () => {
  expect(runtime.ports.sandbox?.executionMode).toBe("trusted-local");
  expect(runtime.ports.sandbox?.isolated).toBe(false);
  expect((await app.request(EDITOR_HTTP.commands, { method: "POST" })).status).toBe(401);
  delete process.env.API_KEY; resetEnvCacheForTests();
  expect((await app.request(EDITOR_HTTP.commands, { method: "POST" })).status).toBe(503);
  process.env.API_KEY = "execution-integration-test"; resetEnvCacheForTests();
  const { view, run } = await start("complete");
  expect(run.input.cwd).toBe(project);
  expect(run.input.execution).toEqual({ ...target(view), sessionId: view.sessionId });
  expect(run.input.prompt).toContain("Integration project rule");
  expect(run.input.executionBudget).toEqual({ maxToolCalls: 6 });
  expect(run.input.content).toEqual([]);
  expect(run.input.hostPaths).toEqual([]);
  expect(await command(startInput("complete"))).toMatchObject(target(view));
  expect(fake.started).toHaveLength(1);
  await command({ op: "send", ...target(view), commandKey: "send-once", text: "Keep existing.txt" });
  await command({ op: "send", ...target(view), commandKey: "send-once", text: "Keep existing.txt" });
  expect(run.messages).toEqual(["Keep existing.txt"]);
  for (const [method, value] of [["confirm", false], ["select", 0]] as const) {
    const question = run.input.events!.question({ method, title: `Question ${method}`, message: "Choose", options: method === "select" ? ["first", "second"] : [], timeoutMs: 30_000 }, new AbortController().signal);
    const snapshot = await until(async () => await command({ op: "snapshot", ...target(view) }) as ExecutionSnapshot,
      snapshot => snapshot.questions.some(item => item.method === method && item.status === "pending"), `persisted ${method} question`);
    const pending = snapshot.questions.find(item => item.method === method && item.status === "pending")!;
    const journal = await db.audit.findUniqueOrThrow({ where: { id: `provider-request:${pending.requestId}` } });
    expect((journal.details as { id: string }).id).toBe(pending.requestId);
    await command({ op: "answer", ...target(view), commandKey: `answer-${method}`, requestId: pending.requestId, answer: { decision: "submit", value } });
    expect(await question).toEqual({ decision: "submit", value });
    expect((await command({ op: "snapshot", ...target(view) }) as ExecutionSnapshot).questions.find(item => item.requestId === pending.requestId)?.status).toBe("answered");
  }
  await command({ op: "detach", workId: view.workId });
  expect(run.aborted).toBe(0);
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).cancelRequestedAt).toBeNull();
  await writeFile(join(run.input.cwd, "generated.txt"), "temporary project output\n");
  await run.append({ type: "message", messageId: "final", role: "assistant", text: "Created generated.txt; no check command was run.", complete: true });
  const before = await command({ op: "events", ...target(view), limit: 100, waitMs: 0 }) as ExecutionEventPage;
  run.finish({ outcome: "finished", sessionId: "fake-provider-session", error: null });
  // No coding.get/results HTTP call here: only production onRunFinished may publish this version.
  const work = await until(() => storedWork(view.workId), work => work.results.length === 1, "automatic result publication");
  expect(work.results[0]).toMatchObject({ ...target(view), accepted: false, checks: [], baseline: { kind: "snapshot", digest: "integration-baseline" } });
  expect(work.acceptances).toEqual([]);
  const result = work.results[0]!;
  const artifactPath = join(root, "data/platform/content", coding.id, `${result.artifactRef}.json`);
  const artifactBytes = await readFile(artifactPath, "utf8");
  expect(JSON.parse(artifactBytes)).toMatchObject({ finalMessage: { text: "Created generated.txt; no check command was run." }, checks: [] });
  expect(await readFile(join(project, "existing.txt"), "utf8")).toBe("existing\n");
  expect(await readFile(join(project, "generated.txt"), "utf8")).toBe("temporary project output\n");
  const after = await command({ op: "events", ...target(view), cursor: before.cursor, limit: 100, waitMs: 0 }) as ExecutionEventPage;
  expect(after.snapshotRequired).toBe(true);
  expect((await command({ op: "snapshot", ...target(view) }) as ExecutionSnapshot)).toMatchObject({ status: "completed", stopConfirmed: true });
  await expect(callSync(runtime.ports, { workspaceId, caller: { kind: "provider", runId: view.runId }, chain: [], path: [] }, "coding.accept", {
    input: JSON.stringify({ workId: view.workId, resultId: result.resultId, commandKey: "provider-must-not-accept" }),
  })).rejects.toMatchObject({ code: "forbidden" });
  expect((await storedWork(view.workId)).results[0]?.accepted).toBe(false);
  expect((await storedWork(view.workId)).acceptances).toEqual([]);
  await command({ op: "accept", workId: view.workId, resultId: result.resultId, commandKey: "human-accept" });
  expect((await storedWork(view.workId)).results[0]?.accepted).toBe(true);
  expect(await readFile(artifactPath, "utf8")).toBe(artifactBytes);
  expect(await command({ op: "attach", workId: view.workId })).toMatchObject({ status: "completed", stopConfirmed: true });
  expect(fake.started).toHaveLength(1);
  expect(errors).toEqual([]);
}, 60_000);

test("owner cancellation retains the directory until actual exit; pause/hash/removal cannot hide a live execution", async () => {
  const { view, run } = await start("cancel");
  const context = moduleContext(runtime.ports, workspaceId);
  await expect(requestStatus(context, coding.id, "paused", "integration pause")).rejects.toMatchObject({ code: "conflict" });
  await expect(db.$transaction(tx => switchActiveIn(context, tx, coding.id, "replacement"))).rejects.toMatchObject({ code: "conflict" });
  await expect(requestRemove(context, coding.id, "integration removal")).rejects.toMatchObject({ code: "conflict" });
  expect(run.aborted).toBe(0);
  expect((await db.module.findUniqueOrThrow({ where: { id: coding.id } })).status).toBe("active");
  await runtime.service.forWorkspace(workspaceId).provider.cancel(view.runId);
  expect(run.aborted).toBe(1);
  expect(await command({ op: "get", workId: view.workId })).toMatchObject({ status: "unknown", cancelRequested: true, stopConfirmed: false });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).heldDirectory).toBe(project);
  const { op: _op, ...occupiedInput } = startInput("occupied");
  await expect(ownerCall("coding.create", { input: JSON.stringify(occupiedInput) })).rejects.toMatchObject({ code: "conflict" });
  run.finish({ outcome: "failed", sessionId: null, error: "Process exited after cancellation" });
  await until(async () => db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } }), row => row.stopConfirmedAt !== null, "actual process stop");
  expect(await command({ op: "get", workId: view.workId })).toMatchObject({ status: "cancelled", stopConfirmed: true });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).heldDirectory).toBeNull();
  await requestStatus(context, coding.id, "paused", "stopped and checked");
  await expect(callSync(runtime.ports, { workspaceId, caller: { kind: "module", module: "coding", moduleId: coding.id, hash: coding.hash }, chain: [], path: [] }, "executions.get", { workId: view.workId })).rejects.toMatchObject({ code: "forbidden" });
  expect(errors).toEqual([]);
}, 60_000);

test("editor coding.cancel completes while process completion publishes through the routed outbox", async () => {
  const { view, run } = await start("editor-cancel");
  await run.append({ type: "message", messageId: "cancel-final", role: "assistant", text: "Stopped with partial work.", complete: true });
  run.stopOnAbort = true;
  await command({ op: "cancel", ...target(view), commandKey: "editor-cancel-once" });
  expect(run.aborted).toBe(1);
  await until(() => storedWork(view.workId), work => work.results.length === 1, "cancel result publication without serial-handler deadlock");
  expect(await command({ op: "get", workId: view.workId })).toMatchObject({ status: "cancelled", stopConfirmed: true });
  expect((await storedWork(view.workId)).results[0]?.accepted).toBe(false);
  expect(errors).toEqual([]);
}, 60_000);

test("disconnected execution stays unknown across a fresh runtime and does not release or restart the project", async () => {
  const { view, run } = await start("restart");
  const before = await command({ op: "events", ...target(view), limit: 100, waitMs: 0 }) as ExecutionEventPage;
  run.disconnect();
  await runtime.service.tick.settled({ includeRuns: true });
  await until(async () => db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } }), row => row.capabilityRevokedAt !== null, "unknown finalization");
  await runtime.stop();
  await boot();
  expect(await command({ op: "attach", workId: view.workId })).toMatchObject({ ...target(view), status: "unknown", stopConfirmed: false });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).heldDirectory).toBe(project);
  expect((await command({ op: "events", ...target(view), cursor: before.cursor, limit: 100, waitMs: 0 }) as ExecutionEventPage).snapshotRequired).toBe(true);
  expect((await storedWork(view.workId)).results).toEqual([]);
  expect(fake.started).toHaveLength(1);
  const oldCaller = { kind: "module" as const, module: "coding", moduleId: coding.id, hash: coding.hash };
  // Simulate an externally stale activation to exercise ingress identity checks as well as the lifecycle guard above.
  const version = await db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: coding.id, hash: coding.hash } } });
  const replacement = "b".repeat(64);
  await db.moduleVersion.create({ data: { moduleId: coding.id, hash: replacement, manifest: moduleManifestSchema.parse(version.manifest), source: "user", intent: {}, report: {}, status: "approved" } });
  await db.module.update({ where: { id: coding.id }, data: { activeHash: replacement } });
  await expect(callSync(runtime.ports, { workspaceId, caller: oldCaller, chain: [], path: [] }, "executions.get", { workId: view.workId })).rejects.toMatchObject({ code: "forbidden" });
  await db.module.update({ where: { id: coding.id }, data: { activeHash: coding.hash } });
  expect(fake.started).toHaveLength(1);
  expect(errors).toEqual([]);
}, 60_000);
