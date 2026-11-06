import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXECUTOR_PROTOCOL, executorDigest, type ExecutionPrincipal, type ExecutorAssignment, type ExecutorFinal, type ExecutorFence, type ExecutorPrincipal, type ExecutorRequests } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { createTick } from "./tick";
import { createExecutionV2Admission } from "./execution-admission";
import { createExecutionEventStore } from "./execution-event-store";
import { createExecutorAuth } from "./executor-auth";
import { createRuns, liveRuns } from "./runs";
import { createExecutions } from "./execution";
import type { StewardPorts } from "./ports";
import { createStewardRuntime } from "../../../../../apps/server/src/steward-runtime";
import { installDeviceExecution } from "../../../../../apps/server/src/execution-device-runtime";

const databases: ReturnType<typeof testDb>[] = [];
afterEach(async () => { liveRuns.clear(); for (const db of databases.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); databases.push(db);
  const w = await db.workspace.create({ data: { name: "tick-device-test" } }), root = mkdtempSync(join(tmpdir(), "chrona-tick-device-test-"));
  let now = new Date(), finished = 0;
  const ports: StewardPorts = { db, dataDir: root, publicUrl: null, now: () => now, onRunFinished: async () => { finished++; } };
  ports.executionEvents = createExecutionEventStore(ports); installDeviceExecution(ports);
  const auth = createExecutorAuth(ports), devices: { fence: ExecutorFence; who: ExecutorPrincipal; request(): Omit<ExecutorRequests["poll"], "waitMs"> }[] = [];
  for (let index = 0; index < 2; index++) {
    const credential = randomBytes(32).toString("hex"), code = await auth.createPairing({ workspaceId: w.id, ownerId: "owner" });
    const paired = await auth.pair(credential, { v: EXECUTOR_PROTOCOL, requestId: `pair-${index}`, code: code.code, label: "Fixture" });
    const fence = { executorId: paired.executorId, generation: 1, incarnation: `daemon-${index}` }, request = () => ({ v: EXECUTOR_PROTOCOL, requestId: crypto.randomUUID(), ...fence });
    const who = await auth.authenticateReconcile(credential, fence);
    await ports.executorController!.reconcile(who, { ...request(), entries: [], after: null, complete: true }, AbortSignal.timeout(1000));
    devices.push({ fence, request, who: await auth.authenticate(credential, fence, "active") });
  }
  ports.resolveExecutionPlacement = async (_, p) => ({ ...p, executor: "device", executorGeneration: 1, directoryIdentity: await executorDigest(p.projectRef), baseline: { kind: "commit", digest: "a".repeat(40) }, label: "Fixture" });
  const owner: ExecutionPrincipal = { workspaceId: w.id, ownerId: "owner", caller: { kind: "owner" } };
  const admission = createExecutionV2Admission(ports), tick = createTick(ports);
  const add = (key: string, device = 0, principal = owner) => admission.start(principal, { kind: "execution", workId: key, commandKey: key, goal: "Fixture", placement: { executorId: devices[device]!.fence.executorId, projectRef: key, mappingRevision: 1 }, workspace: { mode: "existing", baseline: { kind: "commit", digest: "a".repeat(40) } }, queueExpiresAt: new Date(now.getTime() + 600_000).toISOString(), budget: { timeoutMs: 60_000, maxToolCalls: 2 } });
  return { db, ports, root, w, devices, owner, tick, add, finished: () => finished, advance: () => { now = new Date(now.getTime() + 61_000); } };
}
async function tickLaunch(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await f.tick(); expect(result.failures.filter(row => row.stage === "launch" || row.stage === "expire")).toEqual([]);
}

test("tick claims actual device Runs without local provider/path I/O; owner bucket, unknown and session keep holds", async () => {
  const f = await fixture(), a = await f.add("one"), b = await f.add("two"), queued = await f.add("three", 1);
  await f.db.executionExecutor.update({ where: { id: f.devices[1]!.fence.executorId }, data: { authorizedUntil: null } });
  await tickLaunch(f);
  expect(await f.db.run.count({ where: { status: "running", execution: { isNot: null } } })).toBe(2);
  expect(liveRuns.has(a.execution.runId)).toBe(true); expect(liveRuns.has(b.execution.runId)).toBe(true);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: queued.execution.runId } })).toMatchObject({ status: "queued", startedAt: null, deadlineAt: null });
  const run = await f.db.run.findUniqueOrThrow({ where: { id: a.execution.runId } });
  expect(existsSync(join(run.cwd, ".chrona", "sessions"))).toBe(false); // Only admission owns the host log directory; tick must not create a local provider session.
  const device = f.devices[0]!, launches = await f.ports.executorController!.poll(device.who, { ...device.request(), waitMs: 0 }, AbortSignal.timeout(1000));
  const assignment = launches.launches.find(row => row.assignment.runId === run.id)!.assignment;
  const final: ExecutorFinal = { workId: assignment.workId, sessionId: assignment.sessionId, runId: assignment.runId, attemptId: assignment.attemptId, assignmentId: assignment.assignmentId, generation: assignment.generation, baseline: assignment.mapping.baseline, launchDigest: await executorDigest(assignment), throughSourceSeq: 0, sourceReceipt: null, missing: false, finalMessage: null, outcome: { outcome: "unavailable", sessionId: null, error: "Stop unknown" }, stop: { kind: "unknown", reason: "No original stop" } };
  expect(await f.ports.executorController!.final(device.who, { ...device.request(), final, digest: await executorDigest(final) }, AbortSignal.timeout(1000))).toMatchObject({ stopConfirmed: false });
  const blocked = await createRuns(f.ports, f.w.id).enqueue({ lane: "foreground", trigger: "message", sessionId: a.execution.sessionId, prompt: "Same occupied session" });
  await tickLaunch(f);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: blocked.id } })).toMatchObject({ status: "queued", startedAt: null });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { runId: run.id } })).toMatchObject({ stopConfirmedAt: null });
  expect(liveRuns.has(run.id)).toBe(true); expect(f.finished()).toBe(0);
  await liveRuns.get(run.id)!.abort();
  await f.tick.settled({ includeRuns: true });
  expect(await f.db.executionAttempt.count({ where: { stopConfirmedAt: null, heldDirectory: { not: null }, run: { startedAt: { not: null } } } })).toBe(2);
  f.advance(); await tickLaunch(f); // Unresolved relay.done must not block real expireLeases.
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { runId: run.id } })).toMatchObject({ stopConfirmedAt: null });
}, 20_000);

test("device/global/module capacity, durable cancel and committed proof wake use actual admission/controller relay", async () => {
  const f = await fixture(), modules = [];
  for (const name of ["coder-a", "coder-b"]) {
    const module = await f.db.module.create({ data: { workspaceId: f.w.id, name, activeHash: "hash", status: "active" } });
    modules.push({ ...f.owner, caller: { kind: "module" as const, moduleId: module.id, hash: "hash" } });
  }
  const work = [];
  for (let i = 0; i < 6; i++) work.push(await f.add(`capacity-${i}`, i < 3 ? 0 : 1, modules[i < 3 ? 0 : 1]!));
  await tickLaunch(f);
  expect(await f.db.run.count({ where: { status: "running", execution: { isNot: null } } })).toBe(4);
  for (const d of f.devices) expect(await f.db.executionAttempt.count({ where: { executorId: d.fence.executorId, stopConfirmedAt: null, run: { startedAt: { not: null } } } })).toBe(2);
  const device = f.devices[0]!, polled = await f.ports.executorController!.poll(device.who, { ...device.request(), waitMs: 0 }, AbortSignal.timeout(1000)), a: ExecutorAssignment = polled.launches[0]!.assignment;
  const principal = modules[0]!;
  await createExecutions(f.ports).cancel(principal, { op: "cancel", workId: a.workId, runId: a.runId, attemptId: a.attemptId, commandKey: "cancel-original" });
  const control = await f.ports.executorController!.poll(device.who, { ...device.request(), waitMs: 0 }, AbortSignal.timeout(1000));
  expect(control.controls.some(row => row.op === "cancel" && row.target.assignmentId === a.assignmentId)).toBe(true);
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).toMatchObject({ stopConfirmedAt: null });
  const ref = { workId: a.workId, sessionId: a.sessionId, runId: a.runId, attemptId: a.attemptId, assignmentId: a.assignmentId, generation: a.generation }, launchDigest = await executorDigest(a);
  const final: ExecutorFinal = { ...ref, launchDigest, baseline: a.mapping.baseline, throughSourceSeq: 0, sourceReceipt: null, finalMessage: null, missing: false, outcome: { outcome: "unavailable", sessionId: null, error: "Prelaunch cancellation" }, stop: { kind: "never_started", tombstoneDigest: await executorDigest({ kind: "executor_prelaunch_never_started", target: ref, launchDigest }) } };
  const done = liveRuns.get(a.runId)!.done;
  expect(await f.ports.executorController!.final(device.who, { ...device.request(), final, digest: await executorDigest(final) }, AbortSignal.timeout(1000))).toMatchObject({ stopConfirmed: true });
  expect(await done).toEqual(final.outcome); expect(liveRuns.has(a.runId)).toBe(false); expect(f.finished()).toBeGreaterThan(0);
  await tickLaunch(f); expect(await f.db.run.count({ where: { status: "running", execution: { isNot: null } } })).toBe(4);
}, 20_000);

test("ordinary foreground/background keep their priority while device runs; runtime stop never waits for remote stop", async () => {
  const f = await fixture(), completions: (() => void)[] = [], launched: string[] = [];
  f.ports.provider = { name: "test-local", async health() { return { available: true, sandboxed: false, error: null }; }, start(input) {
    launched.push(input.runId);
    return { done: new Promise(resolve => { completions.push(() => resolve({ outcome: "finished", sessionId: null, error: null })); }), async abort() {}, async inject() {} };
  } };
  const local = createRuns(f.ports, f.w.id), sessions = [];
  for (const key of ["foreground", "background"]) sessions.push(await f.db.session.create({ data: { workspaceId: f.w.id, key, source: "web" } }));
  const foreground = await local.enqueue({ lane: "foreground", trigger: "message", sessionId: sessions[0]!.id, prompt: "Ordinary foreground" });
  const background = await local.enqueue({ lane: "background", trigger: "message", sessionId: sessions[1]!.id, prompt: "Ordinary background" });
  const remote = await f.add("parallel-remote");
  await tickLaunch(f);
  expect(launched).toContain(foreground.id); expect(launched).toContain(background.id); expect(launched).not.toContain(remote.execution.runId);
  expect(liveRuns.has(remote.execution.runId)).toBe(true);
  for (const done of completions.splice(0)) done(); await f.tick.settled({ includeRuns: true });
  await tickLaunch(f); expect(launched).toContain(background.id);
  for (const done of completions.splice(0)) done(); await f.tick.settled({ includeRuns: true });
  const runtime = createStewardRuntime(f.db, { dataDir: f.root, provider: null });
  Object.assign(runtime.ports, f.ports, { provider: undefined });
  await runtime.service.tick();
  const stop = runtime.stop();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([stop, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Runtime waited for unresolved remote done")), 2000); })]); }
  finally { clearTimeout(timer); }
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { runId: remote.execution.runId } })).toMatchObject({ stopConfirmedAt: null });
  expect(liveRuns.has(remote.execution.runId)).toBe(true);
}, 20_000);

test("server coding uses bounded two-claim loop and original v1 local completion evidence", async () => {
  const f = await fixture(), completions: (() => void)[] = [], launched: string[] = [], projects = new Map<string, string>();
  for (const name of ["server-a", "server-b", "server-c"]) projects.set(name, mkdtempSync(join(tmpdir(), "chrona-tick-server-project-test-")));
  f.ports.resolveExecutionProject = async (_, projectRef) => ({ executor: "server", projectRef, canonicalPath: projects.get(projectRef)!, baseline: "snapshot:fixture" });
  f.ports.provider = { name: "local-fixture", async health() { return { available: true, sandboxed: false, error: null }; }, start(input) {
    launched.push(input.runId);
    return { done: new Promise(resolve => { completions.push(() => resolve({ outcome: "finished", sessionId: null, error: null })); }), async abort() {}, async inject() {} };
  } };
  const service = createExecutions(f.ports), work = [];
  for (const projectRef of projects.keys()) work.push(await service.start(f.owner, { workId: projectRef, commandKey: projectRef, projectRef, goal: "Fixture v1 local", budget: { timeoutMs: 60_000, maxToolCalls: 2 } }));
  await tickLaunch(f);
  expect(launched).toHaveLength(2);
  expect(await f.db.executionAttempt.count({ where: { executorId: "server", stopConfirmedAt: null, run: { startedAt: { not: null } } } })).toBe(2);
  expect(await f.db.run.count({ where: { status: "queued", execution: { isNot: null } } })).toBe(1);
  for (const done of completions.splice(0)) done(); await f.tick.settled({ includeRuns: true });
  expect(await f.db.executionAttempt.count({ where: { executorId: "server", stopConfirmedAt: { not: null }, heldDirectory: null } })).toBe(2);
}, 20_000);
