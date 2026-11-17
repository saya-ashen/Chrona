import { expect, test } from "bun:test";
import { mkdtemp, open, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { moduleManifestSchema, type ProviderAdapter, type ProviderRunInput } from "@chrona/contracts/steward";
import type { TestProviderPorts } from "../__testing__/test-provider";
import { testDb } from "../__testing__/test-db";
import { testProviderPorts } from "../__testing__/test-provider";
import { runtimeCall, startLocalProvider } from "./local-runtime";
import { retainProviderCallbacks } from "../agent/local-provider";
import { callProviderEndpoint, runProviderBinding } from "../agent/agent-provider";
import { callSync, kernelOrigin } from "../modules/module-calls";
import { createRuns } from "./runs";
import { moduleSupervisor } from "../modules/module-supervisor";
import { readWorkspaceFile } from "../workspace-files";

type Outcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
const finished: Outcome = { outcome: "finished", sessionId: null, error: null };
const health = async () => ({ available: true, sandboxed: false, error: null });

// Let the in-process wire peer serialize its rejection before asserting on the routed failure.
async function callFailure(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; }
  catch (error) { return error; }
  throw new Error("Expected the routed call to fail");
}

async function fixture(provider?: ProviderAdapter) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-local-modules-");
  const files = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const ports: TestProviderPorts = { db, dataDir, now: () => new Date(), publicUrl: null, provider };
  await testProviderPorts(ports);
  const workspace = await db.workspace.create({ data: { name: "local-modules" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "entry-app", activeHash: "entry-v1", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "entry-v1", status: "approved", source: "user", intent: {}, report: {}, manifest: moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["agent.run", "runtime-callback.event"] }) } });
  const origin = { ...kernelOrigin(workspace.id), caller: { kind: "module" as const, module: module.name, moduleId: module.id, hash: "entry-v1" } };
  const request = async (key: string, prompt = "private prompt") => (await callSync(ports, origin, "agent.run", { prompt }, { key })).output as { runId: string; contextId: string };
  return { ports, workspaceId: workspace.id, origin, request,
    async authorize(key: string): Promise<ProviderRunInput> {
      const admitted = await request(key), claim = await createRuns(ports, workspace.id).claimNext("background");
      expect(claim?.runId).toBe(admitted.runId);
      const row = await db.run.findUniqueOrThrow({ where: { id: admitted.runId } });
      return { runId: row.id, token: claim!.token, cwd: row.cwd, lane: "background", prompt: row.prompt, systemPrompt: "boundary", resources: "minimal", sessionDir: dataDir, sessionId: null, deadline: row.deadlineAt };
    },
    async endpoint<T>(runId: string, name: Parameters<typeof callProviderEndpoint>[3], args = { operationId: runId }) {
      return callProviderEndpoint<T>(ports, workspace.id, await runProviderBinding(ports, workspace.id, runId), name, args);
    },
    async close() {
      await moduleSupervisor(ports).stop();
      await db.$disconnect();
      await rm(dataDir, { recursive: true, force: true });
      await rm(dirname(files.find(row => row.name === "main")!.file), { recursive: true, force: true });
    } };
}

test("registered Provider uses JSON operations; waiting does not block injection or cancellation", async () => {
  const completed = Promise.withResolvers<Outcome>();
  let seen = "", interrupted = false;
  const f = await fixture({ name: "fixture", health, start() {
    return { done: completed.promise, async inject(text) { seen = text; }, async abort() { interrupted = true; completed.resolve(finished); } };
  } });
  try {
    const input = await f.authorize("run");
    const handle = await startLocalProvider(f.ports, f.workspaceId, input);
    await handle.inject("private message"); expect(seen).toBe("private message");
    await handle.abort(); expect(interrupted).toBe(true);
    expect(await handle.done).toEqual(finished);
    const records = await f.ports.db.moduleInvocation.findMany({ where: { target: "test-provider" } });
    expect(records.map(row => row.tool)).toEqual(expect.arrayContaining(["health", "start", "inject", "abort", "release"]));
    expect(records.every(row => JSON.stringify(row.args) === "{}" && row.output === null)).toBe(true);
    expect(JSON.stringify(records)).not.toContain("private prompt");
    expect(JSON.stringify(records)).not.toContain("private message");
    expect(JSON.stringify(records)).not.toContain(input.token);
    expect(await callFailure(f.endpoint(input.runId, "status"))).toMatchObject({ code: "not_found" });
    await expect(callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, "test-provider.start", {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(callSync(f.ports, f.origin, "test-provider.start", {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(runtimeCall(f.ports, f.workspaceId, "agent.start", {})).rejects.toMatchObject({ code: "not_found" });
  } finally { completed.resolve(finished); await f.close(); }
});

test("Provider event callbacks are routed and absent from stored payloads", async () => {
  const completed = Promise.withResolvers<Outcome>();
  let ask!: () => Promise<unknown>, progress = false;
  const f = await fixture({ name: "fixture", health, start(input) {
    ask = async () => {
      await input.events!.progress({ phase: "reading", tool: null });
      return input.events!.question({ method: "confirm", title: "private question", message: "", options: [], timeoutMs: 1000 }, new AbortController().signal);
    };
    return { done: completed.promise, async inject() {}, async abort() { completed.resolve(finished); } };
  } });
  try {
    const input = await f.authorize("events");
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...input, events: { async progress() { progress = true; }, async usage() {}, async resources() {}, async question() { return { decision: "submit", value: true }; } } });
    expect(await ask()).toEqual({ decision: "submit", value: true }); expect(progress).toBe(true);
    await handle.abort(); await handle.done;
    const rows = await f.ports.db.moduleInvocation.findMany({ where: { target: "runtime-callback" } });
    expect(rows).toHaveLength(3); // Keyed progress, question, and the actual settled outcome retain their receipts.
    expect(rows.every(row => JSON.stringify(row.args) === "{}" && row.output === null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("private question");
  } finally { completed.resolve(finished); await f.close(); }
});

test("callbacks require the admitted provider, workspace, runtime scope and exact Run", async () => {
  let delivered = 0, settled = 0;
  const f = await fixture({ name: "fixture", health, start() { throw new Error("unused"); } });
  let release: (() => void) | undefined;
  try {
    const input = await f.authorize("scope"), binding = await runProviderBinding(f.ports, f.workspaceId, input.runId);
    const callback = retainProviderCallbacks(f.ports, f.workspaceId, { provider: binding, operationId: input.runId, settled() { settled++; }, events: { async progress() { delivered++; }, async usage() {}, async resources() {}, async question() { return { decision: "cancel" }; } } });
    release = callback.release;
    const origin = { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: "test-provider", moduleId: binding.moduleId, hash: binding.hash } };
    const args = { callbackId: callback.id, event: { kind: "progress", value: { phase: "reading", tool: null } } };
    await expect(runtimeCall(f.ports, f.workspaceId, "runtime-callback.event", args)).rejects.toMatchObject({ code: "forbidden" });
    await expect(callSync(f.ports, f.origin, "runtime-callback.event", args)).rejects.toMatchObject({ code: "forbidden" });
    const other = await f.ports.db.workspace.create({ data: { name: "other scope" } });
    const otherProvider = await f.ports.db.agentProvider.findFirstOrThrow({ where: { workspaceId: other.id } });
    await expect(callSync(f.ports, { ...origin, workspaceId: other.id, caller: { ...origin.caller, moduleId: otherProvider.moduleId } }, "runtime-callback.event", args)).rejects.toMatchObject({ code: "not_found" });
    await expect(callSync({ ...f.ports, dataDir: join(f.ports.dataDir, "other") }, origin, "runtime-callback.event", args)).rejects.toMatchObject({ code: "not_found" });
    await expect(callSync(f.ports, origin, "runtime-callback.event", { ...args, event: { kind: "settled", operationId: "another-run", outcome: finished } })).rejects.toMatchObject({ code: "forbidden" });
    expect(delivered).toBe(0); expect(settled).toBe(0);
    await callSync({ ...f.ports }, origin, "runtime-callback.event", args);
    expect(delivered).toBe(1);
    await f.ports.db.module.update({ where: { id: binding.moduleId }, data: { executionFenceAt: new Date() } });
    await expect(callSync(f.ports, origin, "runtime-callback.event", args)).rejects.toMatchObject({ code: "forbidden" });
    await f.ports.db.module.update({ where: { id: binding.moduleId }, data: { executionFenceAt: null } });
    callback.release();
    await expect(callSync(f.ports, origin, "runtime-callback.event", args)).rejects.toMatchObject({ code: "not_found" });
    expect(delivered).toBe(1);
    expect(await f.ports.db.moduleInvocation.count({ where: { target: "runtime-callback" } })).toBe(0);
  } finally { release?.(); await f.close(); }
});

test("an interrupted question reaches its routed controller even when interruption races delivery", async () => {
  const completed = Promise.withResolvers<Outcome>();
  let ask!: (signal: AbortSignal) => Promise<unknown>;
  const f = await fixture({ name: "fixture", health, start(input) {
    ask = signal => input.events!.question({ method: "confirm", title: "Question", message: "", options: [], timeoutMs: 1000 }, signal);
    return { done: completed.promise, async inject() {}, async abort() { completed.resolve(finished); } };
  } });
  try {
    const input = await f.authorize("interrupted");
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...input, events: {
      async progress() {}, async resources() {}, async usage() {},
      question(_question, signal) { return new Promise(resolve => { if (signal.aborted) resolve({ decision: "cancel" }); else signal.addEventListener("abort", () => resolve({ decision: "cancel" }), { once: true }); }); },
    } });
    const controller = new AbortController(); controller.abort();
    expect(await ask(controller.signal)).toEqual({ decision: "cancel" });
    await handle.abort(); await handle.done;
  } finally { completed.resolve(finished); await f.close(); }
});

test("same-request admission preserves identity; abort acknowledgement never proves release", async () => {
  const completed = Promise.withResolvers<Outcome>();
  let starts = 0;
  const f = await fixture({ name: "fixture", health, start() {
    starts++;
    return { done: completed.promise, async inject() {}, async abort() {} };
  } });
  try {
    const receipts = await Promise.all([f.request("run"), f.request("run")]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(await f.ports.db.run.count()).toBe(1);
    await expect(f.request("run", "changed")).rejects.toMatchObject({ code: "conflict" });
    const input = await f.authorize("run");
    await expect(startLocalProvider(f.ports, f.workspaceId, { ...input, token: "unclaimed" })).rejects.toMatchObject({ code: "forbidden" });
    expect(starts).toBe(0);
    const attempts = await Promise.allSettled([startLocalProvider(f.ports, f.workspaceId, input), startLocalProvider(f.ports, f.workspaceId, input)]);
    expect(attempts.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find(row => row.status === "rejected")).toMatchObject({ reason: { code: "unknown" } });
    const handle = (attempts.find(row => row.status === "fulfilled") as PromiseFulfilledResult<ReturnType<ProviderAdapter["start"]>>).value;
    expect(starts).toBe(1);
    const other = await f.ports.db.workspace.create({ data: { name: "other" } });
    await expect(startLocalProvider(f.ports, other.id, input)).rejects.toMatchObject({ code: "unavailable" });
    const otherBinding = await f.ports.db.agentProvider.findFirstOrThrow({ where: { workspaceId: other.id } });
    expect(await callFailure(callProviderEndpoint(f.ports, other.id, { ...otherBinding, providerId: otherBinding.id }, "status", { operationId: input.runId }))).toMatchObject({ code: "not_found" });
    await handle.abort();
    expect(await f.endpoint(input.runId, "status")).toMatchObject({ failure: false, outcome: null });
    expect(await callFailure(f.endpoint(input.runId, "release"))).toMatchObject({ code: "conflict" });
    expect(await f.ports.db.run.findUniqueOrThrow({ where: { id: input.runId } })).toMatchObject({ status: "running" });
    completed.resolve(finished); await handle.done;
    expect(await callFailure(f.endpoint(input.runId, "status"))).toMatchObject({ code: "not_found" });
    await expect(startLocalProvider(f.ports, f.workspaceId, input)).rejects.toMatchObject({ code: "unknown" });
    await expect(startLocalProvider({ ...f.ports }, f.workspaceId, input)).rejects.toMatchObject({ code: "unknown" });
    expect(await f.ports.db.providerLaunch.count({ where: { runId: input.runId } })).toBe(1);
    expect(starts).toBe(1);
  } finally { completed.resolve(finished); await f.close(); }
});

test("unconfirmed Provider failure retains the operation and never exposes adapter error bodies", async () => {
  const f = await fixture({ name: "fixture", health, start() {
    return { done: Promise.reject(new Error("private raw adapter payload")), async inject() {}, async abort() {} };
  } });
  try {
    const input = await f.authorize("unknown"), handle = await startLocalProvider(f.ports, f.workspaceId, input);
    expect(await callFailure(handle.done)).toMatchObject({ code: "unknown", message: "Provider completion requires reconciliation" });
    expect(await f.endpoint(input.runId, "status")).toMatchObject({ failure: true, outcome: null });
    expect(await callFailure(f.endpoint(input.runId, "release"))).toMatchObject({ code: "conflict" });
    await expect(startLocalProvider(f.ports, f.workspaceId, input)).rejects.toMatchObject({ code: "unknown" });
    const records = await f.ports.db.moduleInvocation.findMany();
    expect(records.find(row => row.target === "test-provider" && row.tool === "release")).toMatchObject({ status: "failed", errorCode: "conflict", error: "Private operation failed" });
    expect(JSON.stringify(records)).not.toContain("private raw adapter payload");
  } finally { await f.close(); }
});

test("Provider output contracts reject extra fields and installed applications cannot shadow callbacks", async () => {
  const f = await fixture({ name: "fixture", health: async () => ({ available: true, sandboxed: false, error: null, privatePayload: "must not escape" }), start() { throw new Error("unused"); } });
  try {
    const row = await f.ports.db.agentProvider.findFirstOrThrow({ where: { workspaceId: f.workspaceId } });
    await expect(callProviderEndpoint(f.ports, f.workspaceId, { ...row, providerId: row.id }, "health", {})).rejects.toMatchObject({ code: "failed" });
    const records = await f.ports.db.moduleInvocation.findMany({ where: { target: "test-provider" } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ args: {}, output: null, error: "Private operation failed" });
    expect(JSON.stringify(records)).not.toContain("must not escape");
    await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "runtime-callback" } });
    await expect(runtimeCall(f.ports, f.workspaceId, "runtime-callback.event", {})).rejects.toMatchObject({ code: "conflict" });
  } finally { await f.close(); }
});

test("admitted Provider contracts and paused modules remain fenced before launch", async () => {
  const f = await fixture({ name: "fixture", health, start() { throw new Error("must not launch"); } });
  try {
    const input = await f.authorize("fenced"), binding = await runProviderBinding(f.ports, f.workspaceId, input.runId);
    const version = await f.ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: binding.moduleId, hash: binding.hash } } });
    const manifest = version.manifest as { tools: { name: string; description: string }[] };
    await f.ports.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...manifest, tools: manifest.tools.map(tool => tool.name === "start" ? { ...tool, output: { type: "string" } } : tool) } } });
    await expect(startLocalProvider(f.ports, f.workspaceId, input)).rejects.toMatchObject({ code: "conflict" });
    await f.ports.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: version.manifest! } });
    await f.ports.db.module.update({ where: { id: binding.moduleId }, data: { status: "paused" } });
    await expect(startLocalProvider(f.ports, f.workspaceId, input)).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.ports.db.providerLaunch.count()).toBe(0);
  } finally { await f.close(); }
});

test.skipIf(process.platform === "win32")("capturing a named pipe rejects without waiting for a writer", async () => {
  const f = await fixture();
  const path = `${f.ports.dataDir}/pipe`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0);
    const result = readWorkspaceFile(f.ports.dataDir, "pipe").then(() => "accepted", error => error.code);
    const timeout = new Promise<string>(resolve => { timer = setTimeout(() => resolve("blocked"), 1000); });
    const outcome = await Promise.race([result, timeout]);
    if (outcome === "blocked") {
      const writer = await open(path, constants.O_RDWR | constants.O_NONBLOCK);
      await writer.close();
      await result;
    }
    expect(outcome).toBe("invalid");
  } finally { clearTimeout(timer); await f.close(); }
});
