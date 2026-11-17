import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, type AgentProviderRegistration } from "@chrona/contracts/steward";
import { registerAgentProvider, selectAgentProvider, assertProviderBinding, callProviderEndpoint } from "./agent-provider";
import { admitContextPrimitive } from "./agent-context";
import { moduleSupervisor } from "../modules/module-supervisor";
import { testModuleProcess } from "../modules/module-test-process";
import { testDb } from "../test-db";
import type { StewardPorts } from "../ports";
import { callSync, kernelOrigin } from "../modules/module-calls";
import { evidence } from "../modules/module-supervisor-state";
import "../modules/module-effects";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const declaration = (id = "offline"): AgentProviderRegistration => ({
  id, name: "Offline fake backend", protocolVersion: 1,
  capabilities: { conversation: true, completion: false, native: false, images: false, interactions: false, resume: true },
  endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release" },
});
async function fixture() {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-registered-provider-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const workspaceId = (await db.workspace.create({ data: { name: "registered provider routing" } })).id;
  const requests: { name: string; caller: unknown }[] = [];
  let privateReply: Record<string, unknown> | null = null;
  let privateError: string | null = null;
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    requests.push({ name: event.trigger.id, caller: event.trigger.caller });
    if (privateError) throw Object.assign(new Error(privateError), { code: "conflict" });
    return { result: privateReply ?? { name: "offline", supportsRunModel: true, complete: false, available: true, sandboxed: false, error: null } };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true }); });
  async function install(name: string, visibility: "kernel" | "modules" = "kernel") {
    const module = await db.module.create({ data: { workspaceId, name, status: "active", activeHash: `${name}-v1` } });
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["agent.run"], tools: Object.values(declaration().endpoints).map(endpoint => ({ name: endpoint, description: endpoint, visibility: [visibility], parameters: { type: "object", properties: endpoint === "start" ? { token: { type: "string" }, prompt: { type: "string" } } : {} }, output: {} })) });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: module.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    return { module, manifest, caller: { kind: "module" as const, module: module.name, moduleId: module.id, hash: module.activeHash! } };
  }
  return { db, ports, workspaceId, install, requests, reply(value: Record<string, unknown>) { privateReply = value; }, reject(value: string) { privateError = value; } };
}

test("registered backend resolves through its actual module and a colliding application cannot take its id", async () => {
  const f = await fixture(), first = await f.install("backend-first"), second = await f.install("backend-second");
  await expect(selectAgentProvider(f.ports, f.workspaceId)).rejects.toMatchObject({ code: "unavailable" });
  const registered = await registerAgentProvider(f.ports, f.workspaceId, first.caller, declaration());
  expect(registered).toMatchObject({ id: "offline", moduleId: first.module.id, hash: first.module.activeHash, available: false });
  expect(f.requests).toHaveLength(0);
  await selectAgentProvider(f.ports, f.workspaceId);
  expect(f.requests).toContainEqual({ name: "health", caller: { kind: "kernel" } });
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { targetModuleId: first.module.id, tool: "health" } })).toMatchObject({ caller: "kernel", targetHash: first.module.activeHash, status: "succeeded" });
  await expect(registerAgentProvider(f.ports, f.workspaceId, second.caller, declaration())).rejects.toMatchObject({ code: "conflict" });
  const selected = await selectAgentProvider(f.ports, f.workspaceId);
  expect(selected.moduleId).toBe(first.module.id);
  const malformed = { ...declaration(), moduleId: second.module.id };
  await expect(registerAgentProvider(f.ports, f.workspaceId, first.caller, malformed)).rejects.toThrow();
  expect(await f.db.agentProvider.count()).toBe(1);
});

test("only approved active own kernel endpoints can register; pinned contracts cannot change underneath a binding", async () => {
  const f = await fixture(), backend = await f.install("backend-contract"), publicEndpoint = await f.install("backend-public", "modules");
  await expect(registerAgentProvider(f.ports, f.workspaceId, { kind: "kernel" }, declaration())).rejects.toMatchObject({ code: "forbidden" });
  await expect(registerAgentProvider(f.ports, f.workspaceId, publicEndpoint.caller, declaration())).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: backend.module.id }, data: { status: "paused" } });
  await expect(registerAgentProvider(f.ports, f.workspaceId, backend.caller, declaration())).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: backend.module.id }, data: { status: "active" } });
  await registerAgentProvider(f.ports, f.workspaceId, backend.caller, declaration());
  const binding = await selectAgentProvider(f.ports, f.workspaceId);
  const changed = { ...backend.manifest, tools: backend.manifest.tools.map(tool => tool.name === "health" ? { ...tool, output: { type: "string" } } : tool) };
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: backend.module.id, hash: backend.module.activeHash! } }, data: { manifest: changed } });
  const before = f.requests.length;
  await expect(assertProviderBinding(f.db, f.workspaceId, binding)).rejects.toMatchObject({ code: "conflict" });
  await expect(callProviderEndpoint(f.ports, f.workspaceId, binding, "health", {})).rejects.toMatchObject({ code: "conflict" });
  expect(f.requests).toHaveLength(before);
});

test("new context pins its provider, request replay keeps the same Run, and another available provider requires selection", async () => {
  const f = await fixture(), backend = await f.install("backend-original"), caller = await f.install("entry-application");
  await registerAgentProvider(f.ports, f.workspaceId, backend.caller, declaration());
  const principal = { workspaceId: f.workspaceId, ownerId: "owner", caller: caller.caller };
  const request = { providerRegistration: true, requestKey: "first-request", prompt: "offline test", providerOptions: {}, content: [], tools: [], lane: "background", kind: "conversation" };
  const result = await admitContextPrimitive(f.ports, principal, "run", request) as { contextId: string; runId: string };
  expect(await admitContextPrimitive(f.ports, principal, "run", request)).toEqual(result);
  const pinned = await f.db.agentRunProvider.findUniqueOrThrow({ where: { runId: result.runId } });
  const context = await f.db.agentContext.findUniqueOrThrow({ where: { sessionId: result.contextId } });
  expect(context).toMatchObject({ providerId: "offline", providerRevision: pinned.revision });
  const other = await f.install("backend-alternative");
  await registerAgentProvider(f.ports, f.workspaceId, other.caller, declaration("alternative"));
  await expect(selectAgentProvider(f.ports, f.workspaceId)).rejects.toMatchObject({ code: "conflict" });
  await expect(admitContextPrimitive(f.ports, principal, "run", { ...request, requestKey: "switch-attempt", contextId: result.contextId, providerId: "alternative" })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.agentRunProvider.findUniqueOrThrow({ where: { runId: result.runId } })).toEqual(pinned);
  expect(await f.db.run.count()).toBe(1);
});

test("private Provider transport returns live data but stores neither arguments nor response and refuses replay or stale version", async () => {
  const f = await fixture(), backend = await f.install("backend-private");
  f.reply({ response: { privateValue: "private-provider-output" } });
  const target = { moduleId: backend.module.id, tool: "start" }, origin = kernelOrigin(f.workspaceId);
  const args = { token: "private-provider-token", prompt: "private-provider-prompt" };
  const options = { key: "private-start", private: true, expectedHash: backend.module.activeHash! };
  expect(await callSync(f.ports, origin, target, args, options)).toMatchObject({ output: { response: { privateValue: "private-provider-output" } } });
  const receipt = await f.db.moduleInvocation.findFirstOrThrow({ where: { key: "private-start" } });
  expect(receipt).toMatchObject({ args: {}, output: null, status: "succeeded" });
  const runs = await f.db.moduleRun.findMany({ where: { moduleId: backend.module.id } });
  expect(runs.some(run => run.exitCode === 0)).toBe(true);
  const stored = JSON.stringify({ receipt, runs });
  for (const secret of Object.values(args).concat("private-provider-output")) expect(stored).not.toContain(secret);
  const before = f.requests.length;
  await expect(callSync(f.ports, origin, target, args, options)).rejects.toMatchObject({ code: "unknown" });
  await expect(callSync(f.ports, origin, target, args, { ...options, key: "stale-version", expectedHash: "another-hash" })).rejects.toMatchObject({ code: "conflict" });
  expect(f.requests).toHaveLength(before);
  await expect(callSync(f.ports, { ...origin, caller: { kind: "owner", via: null } }, target, args, options)).rejects.toMatchObject({ code: "forbidden" });
});

test("private Provider rejection and later process failure omit secret bodies from callers and diagnostics", async () => {
  const f = await fixture(), backend = await f.install("backend-private-error");
  await registerAgentProvider(f.ports, f.workspaceId, backend.caller, declaration());
  const binding = await selectAgentProvider(f.ports, f.workspaceId);
  const secret = "synthetic-private-run-token-7db1";
  f.reject(`backend failed with ${secret}`);
  let failure: unknown;
  try { await callProviderEndpoint(f.ports, f.workspaceId, binding, "health", {}); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: "conflict" });
  expect(String(failure)).not.toContain(secret);
  expect(JSON.stringify(await f.db.moduleRun.findMany())).not.toContain(secret);
  expect(JSON.stringify(await f.db.moduleInvocation.findMany())).not.toContain(secret);
  const detail = evidence({ privateTransport: true, connected: true, process: { stderr: () => secret, pid: 123 } as never }, secret);
  expect(JSON.stringify(detail)).not.toContain(secret);
  expect(detail).toMatchObject({ phase: "process", pid: 123, stderr: "[private process output omitted]" });
});
