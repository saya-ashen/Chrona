import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { admitContextPrimitive } from "./agent-context";
import { callContextTool, contextRunTools, selectContextTools } from "./agent-context-tools";
import { callSync, kernelOrigin } from "./module-calls";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { providerCancelKey } from "./provider-journal";
import { createRuns } from "./runs";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const tool = (name: string, visibility = ["modules"]) => ({ name, description: name, visibility, parameters: { type: "object", properties: {} } });
const targets = ["context-origin.observe", "context-origin.self", "context-origin.bounce", "context-peer.back"];

/** Real admission, Run claim, router and supervisor; the wire peer only replaces application handlers. */
async function fixture() {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-context-entry-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const database = databases.find(row => row.name === "main")!.file;
  const workspaceId = (await db.workspace.create({ data: { name: "detached Agent entry" } })).id;
  const peer = testModuleProcess(async (event, call) => {
    if (event.trigger.kind !== "tool") return {};
    const name = event.trigger.id;
    if (name === "observe") return { result: { caller: event.trigger.caller } };
    const target = name === "bounce" ? "context-peer.back" : "context-origin.observe";
    return { result: await call("call", { target, args: {}, mode: "sync", reply: false }) };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  cleanups.push(async () => {
    await moduleSupervisor(ports).stop(); await db.$disconnect();
    await rm(dataDir, { recursive: true, force: true }); await rm(dirname(database), { recursive: true, force: true });
  });
  const origin = await db.module.create({ data: { workspaceId, name: "context-origin", status: "active", activeHash: "context-origin-v1" } });
  const other = await db.module.create({ data: { workspaceId, name: "context-peer", status: "active", activeHash: "context-peer-v1" } });
  for (const [module, tools] of [[origin, [tool("observe"), tool("self"), tool("bounce"), tool("unselected"), tool("mutate", ["owner"])]], [other, [tool("back")]]] as const) {
    const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [], uses: targets, tools });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: module.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  }
  const principal = { workspaceId, ownerId: "owner", caller: { kind: "module" as const, moduleId: origin.id, hash: origin.activeHash! } };
  const admitted = await admitContextPrimitive(ports, principal, "context", { requestKey: "context" }) as { contextId: string };
  await admitContextPrimitive(ports, principal, "run", { requestKey: "run", contextId: admitted.contextId, lane: "background", prompt: "offline", tools: targets, content: [] });
  const run = (await createRuns(ports, workspaceId).claimNext("background"))!;
  const context = (await contextRunTools(ports, run))!;
  const invoke = (name: string, candidate = context) => callContextTool(ports, candidate, name, {}, Date.now() + 5000);
  return { db, ports, workspaceId, origin, other, run, context, principal, invoke };
}

test("detached entry preserves the original principal for self-owned and cross-module tools", async () => {
  const f = await fixture();
  const caller = { ...f.principal.caller, module: f.origin.name };
  expect(await f.invoke("m_context_origin_observe")).toEqual({ result: { caller } });
  // The peer can call back into the original module: that module has no waiting event.
  expect(await f.invoke("m_context_peer_back")).toMatchObject({ result: { result: { output: { caller: { kind: "module", moduleId: f.other.id, module: f.other.name, hash: f.other.activeHash } } } } });
  const row = await f.db.moduleInvocation.findFirstOrThrow({ where: { callerModuleId: f.origin.id, target: f.origin.name, tool: "observe" } });
  expect(row).toMatchObject({ caller: `module:${f.origin.id}`, callerHash: f.origin.activeHash, chain: [], status: "succeeded" });
});

test("a Run ID cannot change ordinary sync routing; nested self and cross-module cycles remain blocked", async () => {
  const f = await fixture();
  const origin = { ...kernelOrigin(f.workspaceId), caller: f.context.caller, run: { executionRunId: f.run.id } };
  await expect(callSync(f.ports, origin, "context-origin.observe", {})).rejects.toMatchObject({ code: "cycle" });
  expect(await f.invoke("m_context_origin_self")).toMatchObject({ result: { error: { code: "cycle" } } });
  expect(await f.invoke("m_context_origin_bounce")).toMatchObject({ result: { result: { output: { error: { code: "cycle" } } } } });
  // The private entry proof was not retained or propagated after either call.
  await expect(callSync(f.ports, origin, "context-origin.observe", {})).rejects.toMatchObject({ code: "cycle" });
});

test("detached entry requires a real Run and its exact workspace and current module identity", async () => {
  const f = await fixture();
  const candidates = [
    { ...f.context, runId: "selection-only-no-model" },
    { ...f.context, runId: undefined as unknown as string },
    { ...f.context, workspaceId: undefined as unknown as string },
    { ...f.context, workspaceId: "another-workspace" },
    ...[{ moduleId: f.other.id }, { hash: "another-hash" }, { module: f.other.name }].map(change => ({ ...f.context, caller: { ...f.context.caller, ...change } })),
  ];
  for (const candidate of candidates) await expect(f.invoke("m_context_origin_observe", candidate)).rejects.toMatchObject({ code: "forbidden" });
  for (const change of [{ status: "disabled" }, { status: "active", activeHash: "replaced-v2" }]) {
    await f.db.module.update({ where: { id: f.origin.id }, data: change });
    await expect(f.invoke("m_context_origin_observe")).rejects.toMatchObject({ code: "forbidden" });
  }
  expect(await f.db.moduleInvocation.count()).toBe(0);
});

test("detached entry uses persisted selection and never acquires owner mutation rights", async () => {
  const f = await fixture();
  const extra = await selectContextTools(f.ports, f.principal, ["context-origin.unselected"]);
  const forged = { ...f.context, entries: [...f.context.entries, ...extra.entries] };
  await expect(f.invoke("m_context_origin_unselected", forged)).rejects.toMatchObject({ code: "forbidden" });
  await expect(selectContextTools(f.ports, f.principal, ["context-origin.mutate"])).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.invoke("m_context_origin_mutate")).rejects.toMatchObject({ code: "forbidden" });
  await f.db.audit.update({ where: { id: `agent-tools:${f.run.id}` }, data: { details: { targets: [] } } });
  await expect(f.invoke("m_context_origin_observe")).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.moduleInvocation.count()).toBe(0);
});

test("ended, unclaimed, expired and cancelled Runs cannot admit detached tools", async () => {
  const f = await fixture();
  for (const status of ["queued", "finished", "cancelled"]) {
    await f.db.run.update({ where: { id: f.run.id }, data: { status } });
    await expect(f.invoke("m_context_origin_observe")).rejects.toMatchObject({ code: "forbidden" });
  }
  for (const data of [
    { status: "running", deadlineAt: new Date(0), leaseUntil: f.run.leaseUntil },
    { status: "running", deadlineAt: f.run.deadlineAt, leaseUntil: new Date(0) },
  ]) {
    await f.db.run.update({ where: { id: f.run.id }, data });
    await expect(f.invoke("m_context_origin_observe")).rejects.toMatchObject({ code: "forbidden" });
  }
  await f.db.run.update({ where: { id: f.run.id }, data: { status: "running", deadlineAt: f.run.deadlineAt, leaseUntil: f.run.leaseUntil } });
  await f.db.audit.create({ data: { id: providerCancelKey(f.run.id), workspaceId: f.workspaceId, actorKey: f.origin.id, kind: "provider_cancel", subjectId: f.run.id, details: {} } });
  await expect(f.invoke("m_context_origin_observe")).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.moduleInvocation.count()).toBe(0);
});
