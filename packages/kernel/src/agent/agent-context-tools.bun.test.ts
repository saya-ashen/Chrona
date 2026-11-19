import { installTestModuleVersion } from "../__testing__/module-release-test-fixture";
import { agent } from "../system/agent";
import { afterEach, expect, test } from "bun:test";
import "../modules/module-effects";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { moduleManifestSchema, runToolResultSchema, RUN_LIMITS } from "@chrona/contracts/steward";
import { admitContextPrimitive } from "./agent-context";
import { callContextTool, contextRunTools, selectContextTools } from "./agent-context-tools";
import { callSync, kernelOrigin } from "../modules/module-calls";
import { registerSystemModules } from "../system/system-modules";
import { moduleSupervisor } from "../modules/module-supervisor";
import { testModuleProcess } from "../__testing__/module-test-process";
import { createRuns } from "../execution/runs";
import { createTools } from "../tools";
import { registerToolDelegations, retainToolDelegation } from "../modules/tool-delegation";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const tool = (name: string, visibility = ["modules"]) => ({ name, description: name, visibility, parameters: { type: "object", properties: {} },
    output: {}
});
const targets = ["context-origin.observe", "context-origin.self", "context-origin.bounce", "context-peer.back"];

/** Real admission, Run claim, router and supervisor; the wire peer only replaces application handlers. */
async function fixture(selectedTargets = targets, beforeStart?: () => Promise<void>, authority?: "owner") {
  registerSystemModules();
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-context-entry-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const database = databases.find(row => row.name === "main")!.file;
  const workspaceId = (await db.workspace.create({ data: { name: "detached Agent entry" } })).id;
  const peer = testModuleProcess(async (event, call) => {
    if (event.trigger.kind !== "tool") return {};
    const name = event.trigger.id;
    if (name === "delegate") {
      return { result: await call("call", { target: { moduleId: event.trigger.args.recipientId as string, tool: "relay" }, args: {}, mode: "sync", reply: false,
        delegations: { reference: { moduleId: event.trigger.args.moduleId as string, tool: "capture" } }, key: "delegate-outer" }) };
    }
    if (name === "relay") {
      const params = { target: "tool-delegation.invoke" as const, args: { reference: event.trigger.args.reference as string, args: {}, key: "capture" }, mode: "sync" as const, reply: false };
      return { result: { first: await call("call", params), second: await call("call", params), reference: event.trigger.args.reference } };
    }
    if (name === "capture") return { result: { caller: event.trigger.caller, delegate: event.trigger.call?.delegate } };
    if (name === "observe") return { result: { caller: event.trigger.caller } };
    const target = name === "bounce" ? "context-peer.back" : "context-origin.observe";
    return { result: await call("call", { target, args: {}, mode: "sync", reply: false }) };
  }, beforeStart);
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  cleanups.push(async () => {
    await moduleSupervisor(ports).stop(); await db.$disconnect();
    await rm(dataDir, { recursive: true, force: true }); await rm(dirname(database), { recursive: true, force: true });
  });
  const origin = await db.module.create({ data: { workspaceId, name: "context-origin", status: "active", activeHash: "context-origin-v1" } });
  const other = await db.module.create({ data: { workspaceId, name: "context-peer", status: "active", activeHash: "context-peer-v1" } });
  for (const [module, tools] of [[origin, [tool("observe"), tool("self"), tool("bounce"), tool("unselected"), tool("mutate", ["owner"]), tool("capture"), { ...tool("delegate", ["kernel"]), parameters: { type: "object", properties: { moduleId: { type: "string" }, recipientId: { type: "string" } }, required: ["moduleId", "recipientId"] } }]], [other, [tool("back"), { ...tool("relay", ["kernel", "modules"]), parameters: { type: "object", properties: { reference: { type: "string" } }, required: ["reference"] } }]]] as const) {
    const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [],
      ...(module.id === origin.id && authority ? { authority } : {}), uses: [...targets, "context-peer.relay", "tool-delegation.invoke"], tools });
    module.activeHash = await installTestModuleVersion(ports, module, manifest);
  }
  const principal = { workspaceId, ownerId: "owner", caller: { kind: "module" as const, moduleId: origin.id, hash: origin.activeHash! } };
  const admitted = await admitContextPrimitive(ports, principal, "context", { requestKey: "context" }) as { contextId: string };
  await admitContextPrimitive(ports, principal, "run", { requestKey: "run", contextId: admitted.contextId, lane: "background", prompt: "offline", tools: selectedTargets, content: [] });
  const run = (await createRuns(ports, workspaceId).claimNext("background"))!;
  const context = (await contextRunTools(ports, run))!;
  const invoke = (name: string, candidate = context) => callContextTool(ports, candidate, name, {}, { deadline: Date.now() + 5000 });
  return { db, ports, workspaceId, origin, other, run, context, principal, invoke };
}

test("an owner application can select credential management tools for its Run", async () => {
  const management = ["secrets.list", "secrets.set", "secrets.remove"];
  const f = await fixture(management, undefined, "owner");
  expect(f.context.entries.map(entry => entry.tool.name)).toEqual(["list", "set", "remove"]);
  expect(await f.invoke("m_secrets_list")).toEqual({ result: { items: [], nextCursor: null } });
  for (const name of ["get", "token", "authorize"]) {
    await expect(selectContextTools(f.ports, f.principal, [`secrets.${name}`])).rejects.toMatchObject({ code: "forbidden" });
  }
  const ordinary = await fixture();
  await expect(selectContextTools(ordinary.ports, ordinary.principal, ["secrets.list"])).rejects.toMatchObject({ code: "forbidden" });
});

test("an ordinary module can delegate its own tool for one synchronous call", async () => {
  registerToolDelegations();
  const f = await fixture([]), origin = kernelOrigin(f.workspaceId);
  const target = { moduleId: f.origin.id, tool: "delegate" };
  const caller = f.context.caller, delegate = { kind: "module", moduleId: f.other.id, hash: f.other.activeHash, module: f.other.name };
  const reply = await callSync(f.ports, origin, target, { moduleId: f.origin.id, recipientId: f.other.id });
  expect(reply.output).toMatchObject({ result: { output: { first: { result: { output: { caller, delegate } } },
    second: { result: { output: { caller, delegate } } } } } });
  expect(await f.db.moduleInvocation.count({ where: { tool: "capture" } })).toBe(1);
  const { reference } = (reply.output as { result: { output: { reference: string } } }).result.output;
  const replay = await callSync(f.ports, origin, { moduleId: f.other.id, tool: "relay" }, { reference });
  expect(replay.output).toMatchObject({ first: { error: { code: "forbidden" } } });
  await f.db.module.update({ where: { id: f.other.id }, data: { status: "disabled" } });
  expect((await callSync(f.ports, origin, target, { moduleId: f.origin.id, recipientId: f.other.id })).output).toMatchObject({ result: { output: { reference } } });
});

test("the bound Provider can use a Run's tool through SDK while its direct cross-application call is refused", async () => {
  registerToolDelegations();
  const f = await fixture(["context-origin.capture"]);
  const provider = { kind: "module" as const, moduleId: f.other.id, module: f.other.name, hash: f.other.activeHash! };
  await f.db.agentProvider.create({ data: { workspaceId: f.workspaceId, id: "fixture-provider", moduleId: provider.moduleId,
    hash: provider.hash, revision: "fixture", declaration: {} } });
  const origin = { ...kernelOrigin(f.workspaceId), caller: provider };
  const grant = retainToolDelegation(f.ports, { workspaceId: f.workspaceId, authorizer: f.context.caller, recipient: provider,
    target: "context-origin.capture", async invoke({ args, key, delegate, active }) {
      const result = await createTools(f.ports).call(f.run.token, "m_context_origin_capture", args, { key,
        delegate: { caller: delegate, hash: f.origin.activeHash!, active } });
      return result.result;
    } });
  try {
    await expect(callSync(f.ports, origin, { moduleId: f.origin.id, tool: "capture" }, {})).rejects.toMatchObject({ code: "forbidden" });
    const request = { reference: grant.reference, args: {}, key: "one" };
    const invoke = (candidate = origin) => callSync(f.ports, candidate, "tool-delegation.invoke", request);
    await expect(invoke({ ...origin, caller: f.context.caller })).rejects.toMatchObject({ code: "forbidden" });
    await f.db.run.update({ where: { id: f.run.id }, data: { toolCalls: Array.from({ length: RUN_LIMITS.maxChronaToolCalls - 1 }, () => ({ tool: "prior", ok: true })) } });
    const concurrent = await Promise.allSettled([invoke(), invoke()]);
    expect(concurrent.flatMap(reply => reply.status === "fulfilled" ? [reply.value.output] : [])).toContainEqual({ caller: f.context.caller, delegate: provider });
    for (const reply of concurrent) if (reply.status === "rejected") expect(reply.reason).toMatchObject({ code: "unknown" });
    expect((await invoke()).output).toEqual({ caller: f.context.caller, delegate: provider });
    await expect(callSync(f.ports, origin, "tool-delegation.invoke", { ...request, args: { different: true } })).rejects.toMatchObject({ code: "conflict" });
    await expect(callSync(f.ports, origin, "tool-delegation.invoke", { ...request, key: "over-quota" })).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.db.moduleInvocation.count({ where: { tool: "capture" } })).toBe(1);
    await f.db.run.update({ where: { id: f.run.id }, data: { cancelRequestedAt: new Date() } });
    await expect(invoke()).rejects.toMatchObject({ code: "forbidden" });
  } finally { grant.release(); }
});

test("a Run cancelled during application startup cannot first deliver its tool", async () => {
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture(["context-origin.capture"], async () => { started.resolve(); await release.promise; });
  const result = f.invoke("m_context_origin_capture");
  try {
    await started.promise;
    await f.db.run.update({ where: { id: f.run.id }, data: { cancelRequestedAt: new Date() } });
  } finally { release.resolve(); }
  await expect(result).rejects.toThrow("Agent run is no longer active");
  expect(await f.db.moduleInvocation.findFirst({ where: { tool: "capture" } })).toMatchObject({ status: "failed" });
});

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
  const page = await agent.handle({ ports: f.ports, workspaceId: f.workspaceId, caller: { ...f.principal.caller, module: f.origin.name } }, "read", { runId: f.run.id, view: "normalized", limit: 10, waitMs: 0 }) as { items: { sequence: number; payload: unknown }[] };
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
