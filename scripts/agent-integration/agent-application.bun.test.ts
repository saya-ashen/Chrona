import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { callSync, kernelOrigin, enqueueCall } from "../../packages/engine/src/modules/steward/modules/module-calls";
import { registerLocalRuntime, runtimeCall, startLocalProvider } from "../../packages/engine/src/modules/steward/execution/local-runtime";
import { createPiOperations } from "../../packages/engine/src/modules/steward/applications/pi/operations";
import { moduleManifestSchema, type ExecutionEvent, type ProviderRunInput } from "@chrona/contracts/steward";
import { retainProviderCallbacks } from "../../packages/engine/src/modules/steward/agent/local-provider";
import { moduleSupervisor } from "../../packages/engine/src/modules/steward/modules/module-supervisor";
import { callProviderEndpoint } from "../../packages/engine/src/modules/steward/agent/agent-provider";
import { testDb } from "../../packages/engine/src/modules/steward/test-db";
import "../../packages/engine/src/modules/steward/modules/module-effects";

import { agentFixture as fixture } from "./agent-application.fixtures";

test("real external Pi SDK process: controls stay responsive, callback identities and sensitive logs stay bounded", async () => {
  const f = await fixture();
  try {
    expect(await runtimeCall(f.ports, f.workspaceId, "pi.health", {})).toMatchObject({ name: "pi", available: true });
    const complete = { commandKey: "bounded-completion", configurationRevision: (f.registration.declaration as { configuration: { revision: string } }).configuration.revision, model: "fixture/model", prompt: "private-agent-completion", maxOutputTokens: 8, timeoutMs: 5000 };
    const expected = { text: "fixture completion", inputTokens: 3, outputTokens: 4 };
    const binding = { ...f.registration, providerId: f.registration.id };
    const receipt = { operationId: complete.commandKey };
    expect(await callProviderEndpoint<typeof receipt>(f.ports, f.workspaceId, binding, "complete", complete)).toEqual(receipt);
    let status: { outcome: unknown; completion?: typeof expected; failure: boolean } | undefined;
    for (let i = 0; i < 100; i++) {
      status = await callProviderEndpoint<NonNullable<typeof status>>(f.ports, f.workspaceId, binding, "status", receipt);
      if (status?.outcome || status?.failure) break;
      await Bun.sleep(20);
    }
    expect(status).toMatchObject({ outcome: { outcome: "finished" }, completion: expected, failure: false });
    expect(await callProviderEndpoint<typeof receipt>(f.ports, f.workspaceId, binding, "complete", complete)).toEqual(receipt);
    expect((await readFile(join(f.root, "completions.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
    for (const caller of [{ kind: "owner" as const, via: null }, { kind: "provider" as const, runId: "agent-run" }]) await expect(callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller }, "pi.start", { input: "{}" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(enqueueCall({ tx: f.ports.db, ports: f.ports, origin: kernelOrigin(f.workspaceId), target: "pi.start", raw: { input: "private" } }, { key: "no-persist" })).rejects.toMatchObject({ code: "invalid" });
    let progress = false;
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...f.input, events: { async progress() { progress = true; }, async usage() {}, async resources() {}, async question() { return { decision: "cancel" }; } } });
    for (let i = 0; i < 100 && !progress; i++) await Bun.sleep(20);
    expect(progress).toBe(true);
    expect(await readFile(join(f.input.cwd, "started"), "utf8")).toBe("yes");
    await handle.abort();
    expect(await handle.done).toMatchObject({ outcome: "failed" });
    const invocations = await f.ports.db.moduleInvocation.findMany({ where: { target: { in: ["pi", "runtime-callback"] } } });
    expect(JSON.stringify(invocations)).not.toContain("private-agent");
    const runs = await f.ports.db.moduleRun.findMany({ where: { moduleId: f.module.id } });
    expect(runs.length).toBeGreaterThan(0); expect(JSON.stringify(runs)).not.toContain("private-agent");
    // Stream callbacks reached the run (progress above) without leaving ledger rows.
    expect(invocations.some(row => row.target === "runtime-callback")).toBe(false);
    await expect(callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "module", module: "other", moduleId: f.module.id, hash: "different" } }, "runtime-callback.event", { callbackId: crypto.randomUUID(), event: { kind: "progress", value: { phase: "reading", tool: null } } })).rejects.toMatchObject({ code: "forbidden" });
  } finally { await f.close(); }
}, 20000);

test("real external Pi SDK callbacks reach derived ports when the supervisor owns the original ports", async () => {
  const f = await fixture();
  try {
    const supervisor = moduleSupervisor(f.ports);
    await runtimeCall(f.ports, f.workspaceId, "pi.health", {});
    const ports: typeof f.ports = Object.create(f.ports);
    expect(moduleSupervisor(ports)).toBe(supervisor);
    const details: ExecutionEvent[] = [], progress: unknown[] = [];
    const execution = { workId: "callback-work", sessionId: "callback-session", runId: f.input.runId, attemptId: "callback-attempt" };
    const handle = await startLocalProvider(ports, f.workspaceId, { ...f.input, execution,
      detail: { async append(value) { details.push(value); } },
      events: { async progress(value) { progress.push(value); }, async usage() {}, async resources() {}, async question() { return { decision: "cancel" }; } },
    });
    for (let i = 0; i < 100 && (!progress.some(value => (value as { phase: string; tool: string | null }).phase === "reading" && (value as { tool: string | null }).tool === "read") || !details.some(event => event.payload.type === "tool_started")); i++) await Bun.sleep(20);
    expect(progress).toContainEqual({ phase: "reading", tool: "read" });
    expect(details).toContainEqual(expect.objectContaining({ ...execution, payload: { type: "tool_started", toolCallId: "fixture", tool: "read", display: {} } }));
    await handle.abort();
    const outcome = await handle.done;
    expect(outcome.outcome).toBe("failed");
    expect(outcome.error ?? "").not.toContain("detail is incomplete");
    expect(details).toContainEqual(expect.objectContaining({ payload: { type: "state", status: "failed", cancelRequested: false, stopConfirmed: true } }));
    const callbacks = await f.ports.db.moduleInvocation.findMany({ where: { target: "runtime-callback", tool: "event" } });
    // The state detail above proves the callbacks were delivered; they keep no ledger rows.
    expect(callbacks).toHaveLength(0);
  } finally { await f.close(); }
}, 20000);

test("callback references share only db and dataDir scope and release only their own registration", async () => {
  const db = testDb({ injectedAgent: false }), foreignDb = testDb({ injectedAgent: false }), root = await mkdtemp("/tmp/chrona-callback-scope-");
  const registrations: ReturnType<typeof retainProviderCallbacks>[] = [];
  try {
    registerLocalRuntime();
    const workspace = await db.workspace.create({ data: { name: "callback-owner" } });
    const other = await db.workspace.create({ data: { name: "callback-other" } });
    await foreignDb.workspace.create({ data: { id: workspace.id, name: "callback-foreign-db" } });
    const provider = { moduleId: "callback-provider", hash: "callback-hash" };
    for (const [database, workspaceId] of [[db, workspace.id], [db, other.id], [foreignDb, workspace.id]] as const) {
      const id = workspaceId === other.id ? "other-provider" : provider.moduleId;
      await database.module.create({ data: { id, workspaceId, name: "callback-provider", activeHash: provider.hash } });
      await database.moduleVersion.create({ data: { moduleId: id, hash: provider.hash, source: "user", status: "approved", intent: {}, report: {}, manifest: moduleManifestSchema.parse({ name: "callback-provider", entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [] }) } });
    }
    const ports = { db, dataDir: root, now: () => new Date(), publicUrl: null };
    const derived: typeof ports = Object.create(ports);
    const foreignDir = { ...ports, dataDir: join(root, "foreign") }, foreignPorts = { ...ports, db: foreignDb };
    let deliveries = 0;
    const input: Pick<ProviderRunInput, "events" | "detail"> = { detail: { async append() { deliveries++; } } };
    const retain = (scope: typeof ports, workspaceId = workspace.id) => {
      const value = retainProviderCallbacks(scope, workspaceId, { ...input, provider: { ...provider, moduleId: workspaceId === other.id ? "other-provider" : provider.moduleId } }); registrations.push(value); return value;
    };
    const first = retain(derived), second = retain(ports), otherWorkspace = retain(ports, other.id), otherDir = retain(foreignDir), otherDb = retain(foreignPorts);
    expect(new Set(registrations.map(value => value.id)).size).toBe(registrations.length);
    const event = { kind: "detail", value: { workId: "work", sessionId: "session", runId: "run", attemptId: "attempt", seq: 1, at: new Date().toISOString(), payload: { type: "state", status: "running", cancelRequested: false, stopConfirmed: false } } };
    const deliver = (scope: typeof ports, callbackId: string, workspaceId = workspace.id) => callSync(scope, { ...kernelOrigin(workspaceId), caller: { kind: "module", module: "callback-provider", moduleId: workspaceId === other.id ? "other-provider" : provider.moduleId, hash: provider.hash } }, "runtime-callback.event", { callbackId, event });
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

test.skipIf(process.platform !== "linux")("losing the external Pi process stops its process group without inventing a completion", async () => {
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
  const input = { operationId: "run", runId: "run", token: "private-token", lane: "foreground", cwd: root, sessionDir: root, sessionId: null, callbacks: crypto.randomUUID(), prompt: "private-prompt", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 1000).toISOString() };
  try {
    await createPiOperations(root, async request => ({ provider, input: { ...request, deadline: request.deadline ? new Date(request.deadline) : null } })).start(input);
    const restarted = createPiOperations(root, async request => ({ provider, input: { ...request, deadline: request.deadline ? new Date(request.deadline) : null } }));
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
  const input = { operationId: "settled-run", runId: "settled-run", token: "private-token", lane: "foreground", cwd: root, sessionDir: root, sessionId: null, callbacks: crypto.randomUUID(), prompt: "private-prompt", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 1000).toISOString() };
  try {
    const operations = createPiOperations(root, async request => ({ provider, input: { ...request, deadline: request.deadline ? new Date(request.deadline) : null } }), async (operationId, callbacks, result) => {
      expect(callbacks).toBe(input.callbacks);
      const reopened = createPiOperations(root, async request => ({ provider, input: { ...request, deadline: request.deadline ? new Date(request.deadline) : null } }));
      expect(await reopened.control("status", { operationId })).toMatchObject({ outcome: result, failure: false });
      wake = true;
      throw new Error("lost wake");
    });
    await operations.start(input); resolve(outcome);
    for (let i = 0; i < 100 && !wake; i++) await Bun.sleep(5);
    expect(wake).toBe(true);
    expect(await operations.control("status", { operationId: input.operationId })).toMatchObject({ outcome, failure: false });
    const restarted = createPiOperations(root, async request => ({ provider, input: { ...request, deadline: request.deadline ? new Date(request.deadline) : null } }));
    await restarted.start(input);
    expect(starts).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("completion wake references are scoped to the exact operation, workspace and registered provider", async () => {
  const db = testDb({ injectedAgent: false }), root = await mkdtemp("/tmp/chrona-settled-scope-");
  registerLocalRuntime();
  const workspace = await db.workspace.create({ data: { name: "completion" } });
  const other = await db.workspace.create({ data: { name: "foreign" } });
  const ports = { db, dataDir: root, now: () => new Date(), publicUrl: null };
  let settled = false;
  const provider = await db.module.create({ data: { workspaceId: workspace.id, name: "settled-provider", activeHash: "hash" } });
  await db.moduleVersion.create({ data: { moduleId: provider.id, hash: "hash", source: "user", status: "approved", intent: {}, report: {}, manifest: moduleManifestSchema.parse({ name: provider.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [] }) } });
  const registration = { provider: { moduleId: provider.id, hash: "hash" }, operationId: "actual-run", settled: () => { settled = true; } };
  const callback = retainProviderCallbacks(ports, workspace.id, registration);
  registration.operationId = "other-run";
  const event = { kind: "settled", operationId: "actual-run", outcome: { outcome: "finished", sessionId: null, error: null } };
  const deliver = (workspaceId: string, value = event) => callSync(ports, { ...kernelOrigin(workspaceId), caller: { kind: "module", module: provider.name, moduleId: provider.id, hash: "hash" } }, "runtime-callback.event", { callbackId: callback.id, event: value });
  try {
    await expect(deliver(workspace.id, { ...event, operationId: "other-run" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(deliver(other.id)).rejects.toMatchObject({ code: "forbidden" });
    expect(settled).toBe(false);
    await deliver(workspace.id); expect(settled).toBe(true);
    callback.release();
    await expect(deliver(workspace.id)).rejects.toMatchObject({ code: "not_found" });
  } finally { callback.release(); await db.$disconnect(); await rm(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== "linux")("real Pi host loss recovers the original operation from native descendant proof", async () => {
  const f = await fixture();
  try {
    const handle = await startLocalProvider(f.ports, f.workspaceId, f.input);
    const done = handle.done.catch(() => null);
    let pid = 0;
    for (let i = 0; i < 150 && !pid; i++) { try { pid = Number(await readFile(join(f.input.cwd, "pi.pid"), "utf8")); } catch { await Bun.sleep(20); } }
    expect(pid).toBeGreaterThan(0);
    const parent = async (id: number) => Number((await readFile(`/proc/${id}/status`, "utf8")).match(/^PPid:\s+(\d+)/m)?.[1]);
    const guardian = await parent(pid), agent = await parent(guardian);
    expect(agent).toBeGreaterThan(0);
    process.kill(agent, "SIGKILL");
    await done;
    let status: { outcome: unknown; failure: boolean } | undefined;
    for (let i = 0; i < 100; i++) {
      try { status = await runtimeCall(f.ports, f.workspaceId, "pi.status", { operationId: f.input.runId }); if (status?.outcome) break; } catch { /* wait for original guardian cleanup and SDK restart */ }
      await Bun.sleep(30);
    }
    expect(status).toMatchObject({ outcome: { outcome: "failed" }, failure: false });
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { await f.close(); }
}, 20000);
