import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { ProviderAdapter, ProviderRunInput } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { testProviderPorts } from "./test-provider";
import { callSync, kernelOrigin } from "./module-calls";
import { startLocalProvider } from "./local-runtime";
import { createRuns } from "./runs";
import { moduleSupervisor } from "./module-supervisor";
import type { StewardPorts } from "./ports";

type Outcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture(provider?: ProviderAdapter) {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-test-provider-wire-"));
  const files = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null, provider };
  cleanups.push(async () => {
    await moduleSupervisor(ports).stop();
    await db.$disconnect();
    await rm(dataDir, { recursive: true, force: true });
    await rm(dirname(files.find(row => row.name === "main")!.file), { recursive: true, force: true });
  });
  return { db, ports };
}
async function caller(ports: StewardPorts, workspaceId: string) {
  const module = await ports.db.module.create({ data: { workspaceId, name: "entry-app", activeHash: "entry-v1", status: "active" } });
  await ports.db.moduleVersion.create({ data: { moduleId: module.id, hash: "entry-v1", status: "approved", source: "user", intent: {}, report: {}, manifest: { name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["agent.run", "agent.providers"], keepAlive: true, model: { tier: "any", maxCalls: 2, maxOutputTokens: 20 } } } });
  return { ...kernelOrigin(workspaceId), run: { eventKey: "execution:fixture" }, caller: { kind: "module" as const, module: module.name, moduleId: module.id, hash: "entry-v1" } };
}

test("testDb stays synchronous and leaves nonexecution workspaces unchanged", async () => {
  const f = await fixture();
  const workspaceId = (await f.db.workspace.create({ data: { name: "ordinary" } })).id;
  expect(await f.db.module.count()).toBe(0);
  await testProviderPorts(f.ports);
  expect(await f.db.agentProvider.count({ where: { workspaceId } })).toBe(0);
  expect(await f.db.module.count()).toBe(0);
});

test("the fake registers per workspace through approved kernel-only module endpoints", async () => {
  const f = await fixture({ name: "fixture", async health() { return { available: true, sandboxed: false, error: null }; }, start() { throw new Error("must not start during registration"); } });
  const before = await f.db.workspace.create({ data: { name: "before binding" } });
  expect(await f.db.module.count()).toBe(0);
  await testProviderPorts(f.ports);
  const selected = await f.db.workspace.create({ data: { name: "after binding" }, select: { name: true } });
  expect(selected).toEqual({ name: "after binding" });
  const after = await f.db.workspace.findFirstOrThrow({ where: { name: selected.name } });
  for (const workspaceId of [before.id, after.id]) {
    const row = await f.db.agentProvider.findFirstOrThrow({ where: { workspaceId } });
    expect(row).toMatchObject({ id: "fixture" });
    const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: row.moduleId, hash: row.hash } } });
    expect(version.status).toBe("approved");
    const manifest = version.manifest as { tools: { visibility: string[] }[] };
    expect(manifest.tools.every(tool => JSON.stringify(tool.visibility) === '["kernel"]')).toBe(true);
    expect(await f.db.module.count({ where: { workspaceId, name: "agent" } })).toBe(0);
    const origin = await caller(f.ports, workspaceId);
    const providers = await callSync(f.ports, origin, "agent.providers", {});
    expect(JSON.stringify(providers.output)).toContain('"fixture"');
  }
  await testProviderPorts(f.ports);
  expect(await f.db.agentProvider.count()).toBe(2);
  f.ports.provider = { ...f.ports.provider!, name: "renamed-fixture" };
  await testProviderPorts(f.ports);
  expect(await f.db.agentProvider.findMany({ select: { id: true } })).toEqual([{ id: "renamed-fixture" }, { id: "renamed-fixture" }]);
});

test("fake execution uses the registered binding, wire callbacks, and authenticated launch", async () => {
  const completed = Promise.withResolvers<Outcome>();
  const starts: ProviderRunInput[] = [], injected: string[] = [];
  let aborts = 0;
  const f = await fixture({ name: "fixture", async health() { return { available: true, sandboxed: false, error: null }; }, start(input) {
    starts.push(input);
    return { done: completed.promise, async inject(message) { injected.push(message); }, async abort() { aborts++; completed.resolve({ outcome: "finished", sessionId: "native-session", error: null }); } };
  } });
  await testProviderPorts(f.ports);
  const workspaceId = (await f.db.workspace.create({ data: { name: "execution" } })).id;
  const origin = await caller(f.ports, workspaceId);
  const admitted = (await callSync(f.ports, origin, "agent.run", { prompt: "private prompt", providerOptions: { custom: true } }, { key: "execute" })).output as { runId: string; contextId: string };
  const claim = await createRuns(f.ports, workspaceId).claimNext("background");
  expect(claim?.runId).toBe(admitted.runId);
  const row = await f.db.run.findUniqueOrThrow({ where: { id: admitted.runId } });
  const input: ProviderRunInput = { runId: row.id, token: claim!.token, cwd: row.cwd, lane: "background", prompt: row.prompt, systemPrompt: "", resources: "configured", sessionId: null, sessionDir: f.ports.dataDir, deadline: row.deadlineAt };
  await expect(startLocalProvider(f.ports, workspaceId, { ...input, token: "wrong-token" })).rejects.toMatchObject({ code: "forbidden" });
  expect(starts).toHaveLength(0);
  let progress = false;
  const handle = await startLocalProvider(f.ports, workspaceId, { ...input, events: { async progress() { progress = true; }, async usage() {}, async resources() {}, async question() { return { decision: "submit", value: true }; } } });
  try {
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ prompt: input.prompt, providerOptions: { custom: true }, deadline: null });
    await starts[0]!.events!.progress({ phase: "reading", tool: null });
    expect(progress).toBe(true);
    expect(await starts[0]!.events!.question({ method: "confirm", title: "private question", message: "", options: [], timeoutMs: 1000 }, new AbortController().signal)).toEqual({ decision: "submit", value: true });
    await handle.inject("private message");
    expect(injected).toEqual(["private message"]);
    await handle.abort();
    expect(aborts).toBe(1);
    expect(await handle.done).toEqual({ outcome: "finished", sessionId: "native-session", error: null });
    expect(await f.db.providerLaunch.count({ where: { runId: row.id } })).toBe(1);
    const invocations = await f.db.moduleInvocation.findMany({ where: { target: "test-provider" } });
    expect(invocations.map(row => row.tool)).toEqual(expect.arrayContaining(["health", "start", "inject", "abort", "release"]));
    expect(JSON.stringify(invocations)).not.toContain("private prompt");
    expect(JSON.stringify(invocations)).not.toContain("private message");
    await expect(callSync(f.ports, origin, "test-provider.start", {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(callSync(f.ports, origin, "agent.start", {})).rejects.toMatchObject({ code: "not_found" });
  } finally {
    completed.resolve({ outcome: "finished", sessionId: null, error: null });
    await handle.done;
  }
});

test("fake completion forwards admitted options and budgets over the registered endpoint", async () => {
  const requests: Parameters<NonNullable<ProviderAdapter["complete"]>>[0][] = [];
  const f = await fixture({ name: "fixture", async health() { return { available: true, sandboxed: false, error: null }; },
    start() { throw new Error("Completion must not start a conversation"); },
    async complete(input) { requests.push(input); return { text: "fixture result", inputTokens: 2, outputTokens: 3 }; },
  });
  await testProviderPorts(f.ports);
  const workspaceId = (await f.db.workspace.create({ data: { name: "completion", settings: { moduleModel: { maxCallsPerEvent: 2, maxOutputTokens: 20, dailyCalls: 10, eventTimeoutMs: 5000 } } } })).id;
  const origin = await caller(f.ports, workspaceId);
  const admitted = (await callSync(f.ports, origin, "agent.run", { kind: "completion", prompt: "Complete this", providerOptions: { model: "fixture/model", thinking: "low", maxOutputTokens: 10 } }, { key: "completion" })).output as { runId: string };
  const claim = await createRuns(f.ports, workspaceId).claimNext("background");
  expect(claim?.runId).toBe(admitted.runId);
  const row = await f.db.run.findUniqueOrThrow({ where: { id: admitted.runId } });
  const handle = await startLocalProvider(f.ports, workspaceId, { runId: row.id, token: claim!.token, lane: "background", cwd: row.cwd, sessionDir: f.ports.dataDir, sessionId: null, prompt: row.prompt, systemPrompt: "", resources: "configured", deadline: row.deadlineAt });
  expect(await handle.done).toMatchObject({ outcome: "finished" });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ prompt: "Complete this", model: "fixture/model", thinking: "low", maxOutputTokens: 10 });
  expect(requests[0]!.timeoutMs).toBeLessThanOrEqual(5000);
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model", status: "executed" } })).toMatchObject({ inputTokens: 2, outputTokens: 3 });
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { target: "test-provider", tool: "release" } })).toMatchObject({ status: "succeeded" });
});
