import { afterEach, expect, test } from "bun:test";
import type { Prisma } from "@chrona/db";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, type AgentProviderRegistration, type ProviderTranscriptItem } from "@chrona/contracts/steward";
import { registerAgentProvider } from "./agent-provider";
import { assertBuildProvider, assertBuildProviderIn, buildExecutionSchema } from "./build-execution";
import { assertExecutionModuleIdle } from "./execution-module-guard";
import { startOwnerBuild } from "./owner-build";
import { runtimeHealth } from "./runtime-health";
import { sessionTranscript } from "./transcript";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import "./module-effects";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const execution = { provider: "offline", model: "vendor/exact-model", timeoutMinutes: 5, maxSubmissions: 2 };
const health = () => ({ name: "Fake backend display name", supportsRunModel: true, complete: false, available: true, sandboxed: false, error: null });
async function fixture() {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-provider-helpers-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const workspaceId = (await db.workspace.create({ data: { name: "provider helpers" } })).id;
  const requests: { name: string; args: unknown }[] = [], state = { health: health(), transcript: [] as ProviderTranscriptItem[] };
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    requests.push({ name: event.trigger.id, args: event.trigger.args });
    return { result: event.trigger.id.endsWith("transcript") ? state.transcript : state.health };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-11T00:00:00Z"), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true }); });
  async function register(id = "offline", options: { transcript?: boolean; conversation?: boolean } = {}) {
    const module = await db.module.create({ data: { workspaceId, name: `backend-${id}`, status: "active", activeHash: `${id}-v1` } });
    const declaration: AgentProviderRegistration = {
      id, name: `Registered ${id}`, protocolVersion: 1,
      capabilities: { conversation: options.conversation ?? true, completion: options.conversation === false, native: false, images: false, interactions: false, resume: true },
      endpoints: { health: `${id}-health`, start: `${id}-start`, status: `${id}-status`, inject: `${id}-inject`, abort: `${id}-abort`, release: `${id}-release`, ...(options.transcript === false ? {} : { transcript: `${id}-transcript` }), ...(options.conversation === false ? { complete: `${id}-complete` } : {}) },
    };
    const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: [], tools: Object.values(declaration.endpoints).map(name => ({ name, description: name, visibility: ["kernel"], parameters: name.endsWith("transcript") ? { type: "object", properties: { sessionDir: { type: "string" }, limit: { type: "number" } }, required: ["sessionDir", "limit"] } : { type: "object", properties: {} }, output: {} })) });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: module.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    await registerAgentProvider(ports, workspaceId, { kind: "module", module: module.name, moduleId: module.id, hash: module.activeHash! }, declaration);
    return { module, registration: await db.agentProvider.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId, id } } }) };
  }
  async function session() { return db.session.create({ data: { workspaceId, key: crypto.randomUUID(), source: "build" } }); }
  async function run(sessionId: string, registration: Awaited<ReturnType<typeof register>>["registration"], createdAt = new Date("2026-11-11T00:00:00Z")) {
    const run = await db.run.create({ data: { workspaceId, sessionId, lane: "build", trigger: "build", provider: registration.id, tokenHash: crypto.randomUUID(), prompt: "fake", cwd: join(dataDir, "admitted", crypto.randomUUID()), createdAt } });
    await db.agentRunProvider.create({ data: { runId: run.id, providerId: registration.id, moduleId: registration.moduleId, hash: registration.hash, revision: registration.revision, declaration: registration.declaration as Prisma.InputJsonValue, providerOptions: { model: "vendor/exact-model" }, kind: "conversation" } });
    return run;
  }
  return { db, ports, workspaceId, register, session, run, requests, state };
}

test("build preflight resolves the registered id and checks available exact-model capability", async () => {
  const f = await fixture(), backend = await f.register();
  expect(buildExecutionSchema.parse(execution).provider).toBe("offline");
  expect((await assertBuildProvider(f.ports, f.workspaceId, execution)).moduleId).toBe(backend.module.id);
  await expect(assertBuildProvider(f.ports, f.workspaceId, { ...execution, provider: "unregistered" })).rejects.toMatchObject({ code: "conflict" });
  f.state.health.supportsRunModel = false;
  await expect(assertBuildProvider(f.ports, f.workspaceId, execution)).rejects.toMatchObject({ code: "conflict" });
  f.state.health.supportsRunModel = true; f.state.health.available = false;
  await expect(assertBuildProvider(f.ports, f.workspaceId, execution)).rejects.toMatchObject({ code: "conflict" });
  f.state.health.available = true;
  await f.db.module.update({ where: { id: backend.module.id }, data: { status: "paused" } });
  const before = f.requests.length;
  await expect(assertBuildProvider(f.ports, f.workspaceId, execution)).rejects.toMatchObject({ code: "forbidden" });
  expect(f.requests).toHaveLength(before);
});

test("builds reject completion-only providers and owner admission awaits live preflight", async () => {
  const f = await fixture();
  await f.register("complete", { conversation: false });
  await expect(assertBuildProvider(f.ports, f.workspaceId, { ...execution, provider: "complete" })).rejects.toMatchObject({ code: "conflict" });
  await f.register();
  f.state.health.available = false;
  await expect(startOwnerBuild(f.ports, f.workspaceId, { name: "target-app", goal: "test", intent: { changes: ["test"] }, requestKey: "owner-request", execution })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.session.count()).toBe(0);
});

test("claim revalidation uses the Run binding, verifies workspace and does no module IO in the writer", async () => {
  const f = await fixture(), backend = await f.register(), session = await f.session(), run = await f.run(session.id, backend.registration);
  const before = f.requests.length;
  expect((await f.db.$transaction(tx => assertBuildProviderIn(tx, f.workspaceId, execution, run.id))).runId).toBe(run.id);
  expect(f.requests).toHaveLength(before);
  await expect(assertBuildProviderIn(f.db, f.workspaceId, { ...execution, provider: "another" }, run.id)).rejects.toMatchObject({ code: "conflict" });
  await expect(assertBuildProviderIn(f.db, "other-workspace", execution, run.id)).rejects.toMatchObject({ code: "conflict" });
  await expect(assertBuildProvider(f.ports, f.workspaceId, { ...execution, provider: "another" }, run.id)).rejects.toMatchObject({ code: "conflict" });
  await f.db.module.update({ where: { id: backend.module.id }, data: { activeHash: "changed" } });
  await expect(assertBuildProviderIn(f.db, f.workspaceId, execution, run.id)).rejects.toMatchObject({ code: "forbidden" });
});

test("health discovers registered providers without a host Provider adapter", async () => {
  const f = await fixture();
  expect((await runtimeHealth(f.ports, f.workspaceId)).provider).toMatchObject({ name: "unconfigured", available: false });
  await f.register();
  expect((await runtimeHealth(f.ports, f.workspaceId)).provider).toMatchObject({ name: "Registered offline", available: true });
  f.state.health.available = false;
  expect((await runtimeHealth(f.ports, f.workspaceId)).provider).toMatchObject({ available: false, lastError: "No available registered provider" });
  expect(f.requests.every(request => request.name === "offline-health")).toBe(true);
});

test("session transcript uses the latest Run's endpoint and admitted directory, retaining redaction and bounds", async () => {
  const f = await fixture(), first = await f.register(), second = await f.register("second"), session = await f.session();
  await f.run(session.id, first.registration);
  const latest = await f.run(session.id, second.registration, new Date("2026-11-11T00:00:01Z"));
  const secret = "fake-helper-secret-value", prior = process.env.CHRONA_TEST_API_KEY;
  process.env.CHRONA_TEST_API_KEY = secret;
  cleanups.push(async () => { if (prior === undefined) delete process.env.CHRONA_TEST_API_KEY; else process.env.CHRONA_TEST_API_KEY = prior; });
  f.state.transcript = [
    { at: "1", kind: "text", text: "older omitted" },
    { at: "2", kind: "tool", tool: "fake", args: `${secret} ${"x".repeat(1000)}` },
    { at: "3", kind: "result", tool: "fake", text: `${secret} ${"x".repeat(4000)}`, error: false },
  ];
  f.requests.length = 0;
  const items = await sessionTranscript(f.ports, session.id, 2);
  expect(items).toHaveLength(2);
  expect(JSON.stringify(items)).not.toContain(secret);
  expect(items[0]!.kind === "tool" && items[0]!.args.length).toBeLessThan(600);
  expect(items[1]!.kind === "result" && items[1]!.text.length).toBeLessThan(2100);
  expect(f.requests).toEqual([{ name: "second-transcript", args: { sessionDir: join(latest.cwd, ".chrona", "sessions"), limit: 2 } }]);
  await f.db.module.update({ where: { id: second.module.id }, data: { activeHash: "changed" } });
  f.requests.length = 0;
  await expect(sessionTranscript(f.ports, session.id)).rejects.toMatchObject({ code: "forbidden" });
  expect(f.requests).toHaveLength(0);
});

test("empty sessions and providers without transcript have no transcript; missing latest binding fails closed", async () => {
  const f = await fixture(), backend = await f.register("offline", { transcript: false }), session = await f.session();
  expect(await sessionTranscript(f.ports, session.id)).toEqual([]);
  const run = await f.run(session.id, backend.registration);
  const before = f.requests.length;
  expect(await sessionTranscript(f.ports, session.id)).toEqual([]);
  expect(f.requests).toHaveLength(before);
  await f.db.agentRunProvider.delete({ where: { runId: run.id } });
  await expect(sessionTranscript(f.ports, session.id)).rejects.toMatchObject({ code: "unavailable" });
});

test("provider lifecycle guard holds unrelated consumers until queued, running and unknown stop have cleared", async () => {
  const f = await fixture(), backend = await f.register(), session = await f.session(), run = await f.run(session.id, backend.registration);
  for (const state of [{ status: "queued", stopStatus: "pending" }, { status: "running", stopStatus: "pending" }, { status: "failed", stopStatus: "unknown" }]) {
    await f.db.run.update({ where: { id: run.id }, data: state });
    await expect(f.db.$transaction(tx => assertExecutionModuleIdle(tx, backend.module.id))).rejects.toMatchObject({ code: "conflict" });
  }
  await f.db.run.update({ where: { id: run.id }, data: { status: "finished", stopStatus: "confirmed" } });
  await f.db.$transaction(tx => assertExecutionModuleIdle(tx, backend.module.id));
  expect(await f.db.agentContext.count()).toBe(0);
});
