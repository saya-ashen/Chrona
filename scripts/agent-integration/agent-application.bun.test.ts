import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { callSync, kernelOrigin, enqueueCall } from "../../packages/engine/src/modules/steward/module-calls";
import { registerLocalRuntime, runtimeCall, startLocalProvider } from "../../packages/engine/src/modules/steward/local-runtime";
import { createAgentOperations } from "../../packages/engine/src/modules/steward/builtin/agent/operations";
import type { ExecutionEvent, ProviderRunInput } from "@chrona/contracts/steward";
import { retainProviderCallbacks } from "../../packages/engine/src/modules/steward/local-provider";
import { moduleSupervisor } from "../../packages/engine/src/modules/steward/module-supervisor";
import { testDb } from "../../packages/engine/src/modules/steward/test-db";
import "../../packages/engine/src/modules/steward/module-effects";

import { agentFixture as fixture } from "./agent-application.fixtures";

test("real builtin Agent SDK process: controls stay responsive, callback identities and sensitive logs stay bounded", async () => {
  const f = await fixture();
  try {
    expect(await runtimeCall(f.ports, f.workspaceId, "agent.health", {})).toMatchObject({ name: "pi", available: true });
    for (const caller of [{ kind: "owner" as const, via: null }, { kind: "provider" as const, runId: "agent-run" }]) await expect(callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller }, "agent.start", { input: "{}" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(enqueueCall({ tx: f.ports.db, ports: f.ports, origin: kernelOrigin(f.workspaceId), target: "agent.start", raw: { input: "private" } }, { key: "no-persist" })).rejects.toMatchObject({ code: "invalid" });
    let progress = false;
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...f.input, events: { async progress() { progress = true; }, async usage() {}, async resources() {}, async question() { return { decision: "cancel" }; } } });
    for (let i = 0; i < 100 && !progress; i++) await Bun.sleep(20);
    expect(progress).toBe(true);
    expect(await readFile(join(f.input.cwd, "started"), "utf8")).toBe("yes");
    await handle.abort();
    expect(await handle.done).toMatchObject({ outcome: "failed" });
    const invocations = await f.ports.db.moduleInvocation.findMany({ where: { target: { in: ["agent", "runtime-callback"] } } });
    expect(JSON.stringify(invocations)).not.toContain("private-agent");
    const runs = await f.ports.db.moduleRun.findMany({ where: { moduleId: f.module.id } });
    expect(runs.length).toBeGreaterThan(0); expect(JSON.stringify(runs)).not.toContain("private-agent");
    expect(invocations.some(row => row.target === "runtime-callback" && row.callerModuleId === f.module.id)).toBe(true);
    await expect(callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "module", module: "other", moduleId: f.module.id, hash: "different" } }, "runtime-callback.event", { callbackId: crypto.randomUUID(), event: { kind: "progress", value: { phase: "reading", tool: null } } })).rejects.toMatchObject({ code: "forbidden" });
  } finally { await f.close(); }
}, 20000);

test("real builtin Agent SDK callbacks reach derived ports when the supervisor owns the original ports", async () => {
  const f = await fixture();
  try {
    const supervisor = moduleSupervisor(f.ports);
    await runtimeCall(f.ports, f.workspaceId, "agent.health", {});
    const ports: typeof f.ports = Object.create(f.ports);
    expect(moduleSupervisor(ports)).toBe(supervisor);
    const details: ExecutionEvent[] = [], progress: unknown[] = [];
    const execution = { workId: "callback-work", sessionId: "callback-session", runId: f.input.runId, attemptId: "callback-attempt" };
    const handle = await startLocalProvider(ports, f.workspaceId, { ...f.input, execution,
      detail: { async append(value) { details.push(value); } },
      events: { async progress(value) { progress.push(value); }, async usage() {}, async resources() {}, async question() { return { decision: "cancel" }; } },
    });
    for (let i = 0; i < 100 && (!progress.length || !details.some(event => event.payload.type === "tool_started")); i++) await Bun.sleep(20);
    expect(progress).toContainEqual({ phase: "reading", tool: "read" });
    expect(details).toContainEqual(expect.objectContaining({ ...execution, payload: { type: "tool_started", toolCallId: "fixture", tool: "read", display: {} } }));
    await handle.abort();
    const outcome = await handle.done;
    expect(outcome.outcome).toBe("failed");
    expect(outcome.error ?? "").not.toContain("detail is incomplete");
    expect(details).toContainEqual(expect.objectContaining({ payload: { type: "state", status: "failed", cancelRequested: false, stopConfirmed: true } }));
    const callbacks = await f.ports.db.moduleInvocation.findMany({ where: { target: "runtime-callback", tool: "event" } });
    expect(callbacks.length).toBeGreaterThan(0);
    expect(callbacks.every(row => row.callerModuleId === f.module.id && row.status === "succeeded")).toBe(true);
  } finally { await f.close(); }
}, 20000);

test("callback references share only db and dataDir scope and release only their own registration", async () => {
  const db = testDb(), foreignDb = testDb(), root = await mkdtemp("/tmp/chrona-callback-scope-");
  const registrations: ReturnType<typeof retainProviderCallbacks>[] = [];
  try {
    registerLocalRuntime();
    const workspace = await db.workspace.create({ data: { name: "callback-owner" } });
    const other = await db.workspace.create({ data: { name: "callback-other" } });
    await foreignDb.workspace.create({ data: { id: workspace.id, name: "callback-foreign-db" } });
    const ports = { db, dataDir: root, now: () => new Date(), publicUrl: null };
    const derived: typeof ports = Object.create(ports);
    const foreignDir = { ...ports, dataDir: join(root, "foreign") }, foreignPorts = { ...ports, db: foreignDb };
    let deliveries = 0;
    const input: Pick<ProviderRunInput, "events" | "detail"> = { detail: { async append() { deliveries++; } } };
    const retain = (scope: typeof ports, workspaceId = workspace.id) => {
      const value = retainProviderCallbacks(scope, workspaceId, input); registrations.push(value); return value;
    };
    const first = retain(derived), second = retain(ports), otherWorkspace = retain(ports, other.id), otherDir = retain(foreignDir), otherDb = retain(foreignPorts);
    expect(new Set(registrations.map(value => value.id)).size).toBe(registrations.length);
    const event = { kind: "detail", value: { workId: "work", sessionId: "session", runId: "run", attemptId: "attempt", seq: 1, at: new Date().toISOString(), payload: { type: "state", status: "running", cancelRequested: false, stopConfirmed: false } } };
    const deliver = (scope: typeof ports, callbackId: string, workspaceId = workspace.id) => callSync(scope, kernelOrigin(workspaceId), "runtime-callback.event", { callbackId, event });
    await deliver(ports, first.id);
    await deliver(derived, second.id);
    for (const [scope, callbackId, workspaceId] of [
      [ports, first.id, other.id], [foreignDir, first.id, workspace.id], [foreignPorts, first.id, workspace.id],
      [ports, otherWorkspace.id, workspace.id], [ports, otherDir.id, workspace.id], [ports, otherDb.id, workspace.id],
      [ports, crypto.randomUUID(), workspace.id],
    ] as const) await expect(deliver(scope, callbackId, workspaceId)).rejects.toMatchObject({ code: "not_found" });
    first.release(); first.release();
    await expect(deliver(ports, first.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(deliver(derived, first.id)).rejects.toMatchObject({ code: "not_found" });
    await deliver(derived, second.id);
    await deliver(ports, otherWorkspace.id, other.id);
    await deliver(foreignDir, otherDir.id);
    await deliver(foreignPorts, otherDb.id);
    expect(deliveries).toBe(6);
  } finally {
    for (const registration of registrations) registration.release();
    await db.$disconnect(); await foreignDb.$disconnect(); await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "linux")("losing the builtin Agent process stops its process group without inventing a completion", async () => {
  const f = await fixture();
  try {
    const handle = await startLocalProvider(f.ports, f.workspaceId, f.input);
    const done = handle.done.then(outcome => ({ outcome, error: null }), error => ({ outcome: null, error }));
    let pid: number | undefined;
    for (let i = 0; i < 100 && !pid; i++) {
      try { pid = Number(await readFile(join(f.input.cwd, "pi.pid"), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await Bun.sleep(20); }
    }
    expect(pid).toBeGreaterThan(0);
    const processStatus = await readFile(`/proc/${pid}/status`, "utf8");
    const parentPid = Number(processStatus.match(/^PPid:\s+(\d+)/m)?.[1]);
    expect(parentPid).toBeGreaterThan(0);
    process.kill(-parentPid, "SIGKILL");
    const result = await done;
    expect(result.outcome).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    try { expect(await readFile(`/proc/${pid}/status`, "utf8")).toMatch(/^State:\s+Z/m); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  } finally { await f.close(); }
}, 20000);

test("Agent journal preserves uncertain starts across restart without launching again", async () => {
  const root = await mkdtemp("/tmp/chrona-agent-journal-"); let starts = 0;
  const provider = { name: "fixture", async health() { return { available: true, sandboxed: false, error: null }; }, start() { starts++; return { done: new Promise<never>(() => {}), async inject() {}, async abort() {} }; } };
  const input = { operationId: "run", runId: "run", token: "private-token", lane: "foreground", cwd: root, sessionDir: root, sessionId: null, prompt: "private-prompt", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 1000).toISOString() };
  try {
    await createAgentOperations(provider, root, value => value as never).start(input);
    const restarted = createAgentOperations(provider, root, value => value as never);
    expect(await restarted.control("status", { operationId: "run" })).toMatchObject({ failure: true, outcome: null });
    await expect(restarted.start(input)).rejects.toMatchObject({ code: "unknown" });
    await expect(restarted.control("release", { operationId: "run" })).rejects.toMatchObject({ code: "conflict" });
    expect(starts).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Agent completion wake follows durable receipt and a lost wake cannot erase actual stop evidence", async () => {
  const root = await mkdtemp("/tmp/chrona-agent-settled-");
  const outcome = { outcome: "finished" as const, sessionId: "continued", error: null };
  let resolve!: (value: typeof outcome) => void, starts = 0, wake = false;
  const provider = { name: "fixture", async health() { return { available: true, sandboxed: false, error: null }; }, start() { starts++; return { done: new Promise<typeof outcome>(done => { resolve = done; }), async inject() {}, async abort() {} }; } };
  const input = { operationId: "settled-run", runId: "settled-run", token: "private-token", lane: "foreground", cwd: root, sessionDir: root, sessionId: null, prompt: "private-prompt", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 1000).toISOString(), callbacks: crypto.randomUUID() };
  try {
    const operations = createAgentOperations(provider, root, value => value as never, async (operationId, callbacks, result) => {
      expect(callbacks).toBe(input.callbacks);
      const reopened = createAgentOperations(provider, root, value => value as never);
      expect(await reopened.control("status", { operationId })).toMatchObject({ outcome: result, failure: false });
      wake = true;
      throw new Error("lost wake");
    });
    await operations.start(input); resolve(outcome);
    for (let i = 0; i < 100 && !wake; i++) await Bun.sleep(5);
    expect(wake).toBe(true);
    expect(await operations.control("status", { operationId: input.operationId })).toMatchObject({ outcome, failure: false });
    const restarted = createAgentOperations(provider, root, value => value as never);
    await restarted.start(input);
    expect(starts).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("completion wake references are scoped to the exact operation, workspace and immutable Agent", async () => {
  const db = testDb(), root = await mkdtemp("/tmp/chrona-settled-scope-");
  registerLocalRuntime();
  const workspace = await db.workspace.create({ data: { name: "completion" } });
  const other = await db.workspace.create({ data: { name: "foreign" } });
  const ports = { db, dataDir: root, now: () => new Date(), publicUrl: null };
  let settled = false;
  const registration = { operationId: "actual-run", settled: () => { settled = true; } };
  const callback = retainProviderCallbacks(ports, workspace.id, registration);
  registration.operationId = "other-run";
  const event = { kind: "settled", operationId: "actual-run", outcome: { outcome: "finished", sessionId: null, error: null } };
  const deliver = (workspaceId: string, value = event) => callSync(ports, kernelOrigin(workspaceId), "runtime-callback.event", { callbackId: callback.id, event: value });
  try {
    await expect(deliver(workspace.id, { ...event, operationId: "other-run" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(deliver(other.id)).rejects.toMatchObject({ code: "not_found" });
    expect(settled).toBe(false);
    await deliver(workspace.id); expect(settled).toBe(true);
    callback.release();
    await expect(deliver(workspace.id)).rejects.toMatchObject({ code: "not_found" });
  } finally { callback.release(); await db.$disconnect(); await rm(root, { recursive: true, force: true }); }
});
