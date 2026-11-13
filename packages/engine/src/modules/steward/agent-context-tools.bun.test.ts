import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { moduleManifestSchema, runToolResultSchema } from "@chrona/contracts/steward";
import { admitContextPrimitive } from "./agent-context";
import { callContextTool, contextRunTools, selectContextTools } from "./agent-context-tools";
import { callSync, kernelOrigin } from "./module-calls";
import { registerSystemModules } from "./system-modules";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { createRuns } from "./runs";
import { createTools } from "./tools";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const tool = (name: string, visibility = ["modules"]) => ({ name, description: name, visibility, parameters: { type: "object", properties: {} },
    output: {}
});
const targets = ["context-origin.observe", "context-origin.self", "context-origin.bounce", "context-peer.back"];

/** Real admission, Run claim, router and supervisor; the wire peer only replaces application handlers. */
async function fixture(selectedTargets = targets) {
  registerSystemModules();
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
  await admitContextPrimitive(ports, principal, "run", { requestKey: "run", contextId: admitted.contextId, lane: "background", prompt: "offline", tools: selectedTargets, content: [] });
  const run = (await createRuns(ports, workspaceId).claimNext("background"))!;
  const context = (await contextRunTools(ports, run))!;
  const invoke = (name: string, candidate = context) => callContextTool(ports, candidate, name, {}, { deadline: Date.now() + 5000 });
  return { db, ports, workspaceId, origin, other, run, context, principal, invoke };
}

test("keyless system reads in an admitted Run return live results without invocation or tool-result rows", async () => {
  const f = await fixture(["modules.list"]);
  const before = await f.db.runEvent.count({ where: { runId: f.run.id, kind: "tool-result" } });
  const reply = await f.invoke("m_modules_list");
  expect(reply).toMatchObject({ result: { items: expect.arrayContaining([expect.objectContaining({ id: f.origin.id })]) } });
  expect(await f.db.moduleInvocation.count({ where: { target: "modules", tool: "list" } })).toBe(0);
  expect(await f.db.runEvent.count({ where: { runId: f.run.id, kind: "tool-result" } })).toBe(before);
});

test("detached entry preserves the original principal for self-owned and cross-module tools", async () => {
  const f = await fixture();
  const caller = { ...f.principal.caller, module: f.origin.name };
  expect(f.run).toMatchObject({ deadlineAt: null, leaseUntil: null });
  expect(await createTools(f.ports).call(f.run.token, "m_context_origin_observe", {}, { timeoutSeconds: 5 })).toEqual({ result: { caller } });
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
  await f.db.agentRunAdmission.update({ where: { runId: f.run.id }, data: { targets: [] } });
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
  await f.db.run.update({ where: { id: f.run.id }, data: { cancelRequestedAt: new Date() } });
  await expect(f.invoke("m_context_origin_observe")).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.moduleInvocation.count()).toBe(0);
});

test("audit retention does not change context ownership, admitted tools or fixed command receipts", async () => {
  const f = await fixture();
  await f.db.audit.deleteMany();
  const replay = await admitContextPrimitive(f.ports, f.principal, "context", { requestKey: "context" });
  expect(replay).toEqual({ contextId: f.run.sessionId });
  expect((await contextRunTools(f.ports, f.run))?.caller).toEqual(f.context.caller);
  expect(await f.invoke("m_context_origin_observe")).toMatchObject({ result: { caller: f.context.caller } });
  const event = await f.db.runEvent.findFirstOrThrow({ where: { runId: f.run.id, kind: "tool-result" } });
  expect(runToolResultSchema.safeParse((event.payload as { value: unknown }).value).success).toBe(true);
  expect(event.payload).toMatchObject({ type: "tool-result", value: { runId: f.run.id, target: { moduleId: f.origin.id, tool: "observe" }, moduleId: f.origin.id, hash: f.origin.activeHash, status: "succeeded", outputState: "complete", output: { caller: f.context.caller } } });
  const page = await admitContextPrimitive(f.ports, f.principal, "stream", { runId: f.run.id, after: 0, limit: 10 }) as { items: { sequence: number; payload: unknown }[] };
  expect(page.items).toEqual([expect.objectContaining({ sequence: event.sequence, payload: event.payload })]);
});

test("a receipt persistence failure cannot turn an executed tool into retryable failure or fabricated success", async () => {
  const f = await fixture();
  await f.db.$executeRawUnsafe("CREATE TRIGGER fail_tool_receipt BEFORE INSERT ON RunEvent BEGIN SELECT RAISE(ABORT, 'Synthetic event storage failure'); END");
  await expect(f.invoke("m_context_origin_observe")).rejects.toMatchObject({ code: "unknown" });
  const call = await f.db.moduleInvocation.findFirstOrThrow({ where: { runId: f.run.id, target: f.origin.name, tool: "observe" } });
  expect(call).toMatchObject({ status: "running", targetModuleId: f.origin.id, targetHash: f.origin.activeHash });
  await f.db.$executeRawUnsafe("DROP TRIGGER fail_tool_receipt");
  await createRuns(f.ports, f.workspaceId).finish(f.run.id, { outcome: "failed", sessionId: null, error: "Provider disconnected" }, { stopEvidence: "provider_exited" });
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({ status: "unknown" });
  expect(await f.db.moduleRun.count({ where: { moduleId: f.origin.id, triggerId: "tool:observe" } })).toBe(1);
  expect(await f.db.runEvent.findFirstOrThrow({ where: { runId: f.run.id, kind: "tool-result" } })).toMatchObject({ payload: { value: { callId: call.id, status: "unknown", outputState: "omitted" } } });
});
