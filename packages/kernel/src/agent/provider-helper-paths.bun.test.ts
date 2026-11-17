import { createTestAgentContext } from "../__testing__/test-provider";
import { afterEach, expect, test } from "bun:test";
import type { Prisma } from "@chrona/db";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, type AgentProviderRegistration, type ProviderTranscriptItem } from "@chrona/contracts/steward";
import { registerAgentProvider } from "./agent-provider";
import { assertExecutionModuleIdle } from "../execution/execution-module-guard";
import { runtimeHealth } from "../runtime/runtime-health";
import { moduleSupervisor } from "../modules/module-supervisor";
import { testModuleProcess } from "../__testing__/module-test-process";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";
import "../modules/module-effects";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const health = () => ({ name: "Fake backend display name", supportsRunModel: true, complete: false, available: true, sandboxed: false, error: null });
async function fixture() {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-provider-helpers-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const workspaceId = (await db.workspace.create({ data: { name: "provider helpers" } })).id;
  const requests: { name: string; args: unknown }[] = [], state = { health: health(), transcript: [] as ProviderTranscriptItem[], healthWait: undefined as Promise<void> | undefined };
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    requests.push({ name: event.trigger.id, args: event.trigger.args });
    if (event.trigger.id.endsWith("health")) await state.healthWait;
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
  async function session() { return createTestAgentContext(db, workspaceId); }
  async function run(sessionId: string, registration: Awaited<ReturnType<typeof register>>["registration"], createdAt = new Date("2026-11-11T00:00:00Z")) {
    const run = await db.run.create({ data: { workspaceId, sessionId, lane: "background", trigger: "source", provider: registration.id, tokenHash: crypto.randomUUID(), prompt: "fake", cwd: join(dataDir, "admitted", crypto.randomUUID()), createdAt } });
    await db.agentRunProvider.create({ data: { runId: run.id, providerId: registration.id, moduleId: registration.moduleId, hash: registration.hash, revision: registration.revision, declaration: registration.declaration as Prisma.InputJsonValue, providerOptions: { model: "vendor/exact-model" }, kind: "conversation" } });
    return run;
  }
  return { db, ports, workspaceId, register, session, run, requests, state };
}




test("health discovers registered providers without a host Provider adapter", async () => {
  const f = await fixture();
  expect((await runtimeHealth(f.ports, f.workspaceId)).provider).toMatchObject({ name: "unconfigured", available: false });
  await f.register();
  expect((await runtimeHealth(f.ports, f.workspaceId)).provider).toMatchObject({ name: "Registered offline", available: true });
  f.state.health.available = false;
  expect((await runtimeHealth(f.ports, f.workspaceId)).provider).toMatchObject({ available: false, lastError: "No available registered provider" });
  expect(f.requests.every(request => request.name === "offline-health")).toBe(true);
});

test("provider lifecycle guard holds unrelated consumers until queued, running and unknown stop have cleared", async () => {
  const f = await fixture(), backend = await f.register(), session = await f.session(), run = await f.run(session.id, backend.registration);
  for (const state of [{ status: "queued", stopStatus: "pending" }, { status: "running", stopStatus: "pending" }, { status: "failed", stopStatus: "unknown" }]) {
    await f.db.run.update({ where: { id: run.id }, data: state });
    await expect(f.db.$transaction(tx => assertExecutionModuleIdle(tx, backend.module.id))).rejects.toMatchObject({ code: "conflict" });
  }
  await f.db.run.update({ where: { id: run.id }, data: { status: "finished", stopStatus: "confirmed" } });
  await f.db.$transaction(tx => assertExecutionModuleIdle(tx, backend.module.id));
  expect(await f.db.agentContext.count()).toBe(1);
});

test("concurrent health reads share an ongoing probe without caching later results or revoked eligibility", async () => {
  const f = await fixture(), provider = await f.register();
  const gate = Promise.withResolvers<void>(); f.state.healthWait = gate.promise;
  const first = runtimeHealth(f.ports, f.workspaceId), second = runtimeHealth(f.ports, f.workspaceId);
  for (let i = 0; i < 100 && !f.requests.length; i++) await Bun.sleep(5);
  expect(f.requests).toHaveLength(1);
  await f.db.module.update({ where: { id: provider.module.id }, data: { status: "paused" } });
  expect((await runtimeHealth(f.ports, f.workspaceId)).provider.available).toBe(false);
  gate.resolve();
  expect((await Promise.all([first, second])).every(result => result.provider.available)).toBe(true);
  await f.db.module.update({ where: { id: provider.module.id }, data: { status: "active" } });
  f.state.healthWait = undefined; f.state.health.available = false;
  expect((await runtimeHealth(f.ports, f.workspaceId)).provider.available).toBe(false);
  expect(f.requests).toHaveLength(2);
});

test("runtime counts retain old active runs and today's failures by local end date", async () => {
  const f = await fixture(), provider = await f.register(), session = await f.session();
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { timezone: "America/Los_Angeles" } } });
  const old = new Date("2026-11-01T00:00:00Z");
  const queued = await f.run(session.id, provider.registration, old), running = await f.run(session.id, provider.registration, old);
  await f.db.run.update({ where: { id: running.id }, data: { status: "running" } });
  for (const [status, endedAt] of [["failed", "2026-11-10T23:00:00Z"], ["timed_out", "2026-11-10T01:00:00Z"], ["provider_unavailable", "2026-11-09T23:00:00Z"]]) {
    const run = await f.run(session.id, provider.registration, old);
    await f.db.run.update({ where: { id: run.id }, data: { status, endedAt: new Date(endedAt) } });
  }
  expect(await runtimeHealth(f.ports, f.workspaceId)).toMatchObject({ queuedRuns: 1, runningRuns: 1, failedRunsToday: 1 });
  await f.db.run.update({ where: { id: queued.id }, data: { status: "finished" } });
  expect((await runtimeHealth(f.ports, f.workspaceId)).queuedRuns).toBe(0);
});
