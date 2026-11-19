import { installTestModuleVersion } from "../__testing__/module-release-test-fixture";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, type AgentProviderRegistration, type ProviderRunInput, type ProviderTranscriptItem } from "@chrona/contracts/steward";
import { agent } from "../system/agent";
import { registerAgentProvider } from "./agent-provider";
import { startLocalProvider, stopAgentRuns } from "../execution/local-runtime";
import { registeredProviderHealth } from "./agent-client";
import { createRuns, liveRuns } from "../execution/runs";
import { admitContextPrimitive, type ModulePrincipal } from "./agent-context";
import { callSync, kernelOrigin, CallError } from "../modules/module-calls";
import { createProviderChannel } from "./provider-channel";
import { moduleSupervisor } from "../modules/module-supervisor";
import { testModuleProcess } from "../__testing__/module-test-process";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";
import "../modules/module-effects";
import { registerSystemModules } from "../system/system-modules";
import { fenceAgentModule } from "./module-drain";
import { requestRemove } from "../modules/module-remove";
import { moduleContext } from "../modules/module-context";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); }, 30000);
const object = { type: "object", properties: {}, additionalProperties: true };
const string = { type: "string" };
const declaration: AgentProviderRegistration = {
  id: "offline", name: "Offline backend", protocolVersion: 1,
  capabilities: { conversation: true, completion: true, native: true, images: false, interactions: false, resume: true },
  endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release", native: "native", complete: "complete", transcript: "transcript" },
};
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(onControl?: (name: string) => Promise<void>, registration = declaration) {
  registerSystemModules();
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-provider-kernel-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const workspaceId = (await db.workspace.create({ data: { name: "kernel launch tests" } })).id;
  const requests: { name: string; args: Record<string, unknown> }[] = [];
  let nativeFails = false, stopped = false, confirmStop = true;
  let transcript: ProviderTranscriptItem[] = [];
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    const { id: name, args } = event.trigger;
    requests.push({ name, args });
    if (name === "native" || name === "inject") await onControl?.(name);
    if (name === "health") return { result: { name: "offline", supportsRunModel: true, complete: true, available: true, sandboxed: false, error: null } };
    if (name === "native") {
      if (nativeFails) throw new CallError("unknown", "Backend operation response lost");
      return { result: { response: { operationId: args.operationId, request: args.request, apiKey: "hidden-value" } } };
    }
    if (name === "abort" && confirmStop) stopped = true;
    if (name === "status") return { result: { operationId: args.operationId, outcome: stopped ? { outcome: "finished", sessionId: null, error: null } : null, failure: false } };
    if (name === "inspect") return { result: { query: args.query, version: args.version, data: { operationId: args.operationId ?? null, apiKey: "private" } } };
    if (name === "transcript") return { result: transcript };
    if (name === "complete") return { result: { text: "bounded completion", inputTokens: 2, outputTokens: 3 } };
    return { result: {} };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  cleanups.push(async () => { await stopAgentRuns(ports); await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true }); });
  const startProperties = Object.fromEntries(["operationId", "runId", "token", "lane", "cwd", "sessionDir", "prompt", "systemPrompt", "resources", "callbacks", "model", "configurationRevision"].map(key => [key, string]));
  Object.assign(startProperties, { sessionId: { type: ["string", "null"] }, deadline: { type: ["string", "null"] }, providerOptions: object, searchTools: { type: "boolean" }, images: { type: "array", items: object }, tools: { type: "array", items: object }, hostPaths: { type: "array", items: string }, content: { type: "array", items: object } });
  const backend = await db.module.create({ data: { workspaceId, name: "test-backend", status: "active", activeHash: "backend-v1" } });
  const manifest = moduleManifestSchema.parse({ name: backend.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["runtime-callback.event"], tools: Object.values(registration.endpoints).map(name => ({ name, description: name, visibility: ["kernel"], parameters: { type: "object", properties: name === "health" ? {} : name === "start" ? startProperties : name === "native" ? { operationId: string, request: object } : name === "inspect" ? { operationId: string, configurationRevision: string, query: string, version: { type: "number" }, args: object } : name === "transcript" ? { sessionDir: string, runId: string, limit: { type: "number" } } : name === "complete" ? { commandKey: string, prompt: string, system: string, model: string, thinking: string, configurationRevision: string, maxOutputTokens: { type: "number" }, timeoutMs: { type: "number" } } : { operationId: string, message: string } }, output: {} })).concat([{ name: "configure", description: "Provider configuration", visibility: ["owner"], parameters: { type: "object", properties: {} }, output: {} }]) });
  backend.activeHash = await installTestModuleVersion(ports, backend, manifest);
  const backendCaller = { kind: "module" as const, module: backend.name, moduleId: backend.id, hash: backend.activeHash! };
  async function installCaller(name: string) {
    const row = await db.module.create({ data: { workspaceId, name, status: "active", activeHash: "caller-v1" } });
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["agent.run", "agent.inspect", "agent.native", "agent.read", "agent.write", "agent.stop"], model: { tier: "any", maxCalls: 2, maxOutputTokens: 20 } });
    row.activeHash = await installTestModuleVersion(ports, row, manifest);
    return { kind: "module" as const, module: name, moduleId: row.id, hash: row.activeHash! };
  }
  const caller = await installCaller("entry-app");
  async function invoke(name: string, args: Record<string, unknown>, key = name) { return agent.handle({ ports, workspaceId, caller, call: { id: key, key }, run: { eventKey: "execution:offline" } }, name, args); }
  async function run(key: string, extra: Record<string, unknown> = {}) { return await invoke("run", { prompt: "private-prompt", ...extra }, key) as { runId: string; contextId: string }; }
  async function claim(runId: string) {
    const claimed = await createRuns(ports, workspaceId).claimNext("background");
    expect(claimed?.runId).toBe(runId);
    const row = await db.run.findUniqueOrThrow({ where: { id: runId } });
    const input: ProviderRunInput = { runId, token: claimed!.token, lane: row.lane as "background", cwd: row.cwd, sessionDir: join(dataDir, "sessions", row.sessionId!, ".chrona", "sessions"), sessionId: null, prompt: row.prompt, systemPrompt: "system", resources: "configured", deadline: row.deadlineAt };
    return input;
  }
  async function fence() {
    await db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
      await tx.module.update({ where: { id: caller.moduleId }, data: { executionFenceAt: ports.now() } });
    });
  }
  const principal: ModulePrincipal = { workspaceId, ownerId: "owner", caller };
  return { db, ports, workspaceId, backendCaller, caller, principal, installCaller, invoke, run, claim, fence, requests, setTranscript: (value: ProviderTranscriptItem[]) => { transcript = value; }, failNative: () => { nativeFails = true; }, unconfirmedStop: () => { confirmStop = false; } };
}

test("kernel boots without a provider and reports explicit unavailability", async () => {
  const f = await fixture();
  expect(await registeredProviderHealth(f.ports)).toMatchObject({ available: false });
  await expect(f.run("unconfigured")).rejects.toMatchObject({ code: "unavailable" });
  expect(await f.db.run.count()).toBe(0);
});

test("inspection negotiates the declared scope and version and uses the owned Run binding", async () => {
  const registration: AgentProviderRegistration = { ...declaration, endpoints: { ...declaration.endpoints, inspect: "inspect" },
    inspections: [{ query: "models", scope: "provider", version: 1 }, { query: "context", scope: "run", version: 1 }] };
  const f = await fixture(undefined, registration);
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const models = { providerId: declaration.id, query: "models", version: 1 };
  const origin = { ...kernelOrigin(f.workspaceId), caller: f.caller };
  await expect(callSync(f.ports, origin, "agent.inspect", models)).rejects.toMatchObject({ code: "unavailable" });
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, registration);
  expect(await f.invoke("providers", {})).toMatchObject({ items: [{ inspections: registration.inspections }] });
  expect((await callSync(f.ports, origin, "agent.inspect", models)).output).toEqual({ query: "models", version: 1, data: { operationId: null, apiKey: "[redacted]" } });
  await expect(callSync(f.ports, origin, "agent.inspect", { ...models, version: 2 })).rejects.toMatchObject({ code: "unavailable" });
  await expect(callSync(f.ports, origin, "agent.inspect", { ...models, query: "context" })).rejects.toMatchObject({ code: "unavailable" });
  const { runId } = await f.run("inspect-run");
  const context = { runId, query: "context", version: 1 };
  await expect(callSync(f.ports, origin, "agent.inspect", context)).rejects.toMatchObject({ code: "unavailable" });
  const input = await f.claim(runId);
  await startLocalProvider(f.ports, f.workspaceId, input);
  const intruder = await f.installCaller("other-app");
  await expect(callSync(f.ports, { ...origin, caller: intruder }, "agent.inspect", context)).rejects.toMatchObject({ code: "not_found" });
  expect((await callSync(f.ports, origin, "agent.inspect", context)).output).toEqual({ query: "context", version: 1, data: { operationId: runId, apiKey: "[redacted]" } });
  expect(f.requests.filter(row => row.name === "inspect")).toHaveLength(2);
  await f.invoke("stop", { runId }, "stop-inspection");
}, 10000);

test("normalized reads retain development transcripts larger than a native reply bound", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run("large-transcript");
  const text = "开发记录".repeat(18_000);
  f.setTranscript([{ at: new Date().toISOString(), kind: "result", tool: "read", text, error: false }]);
  const output = await f.invoke("read", { runId: admitted.runId }) as { run: { runId: string; status: string }; transcript: ProviderTranscriptItem[] };
  expect(Buffer.byteLength(JSON.stringify(output.transcript))).toBeGreaterThan(65_536);
  expect(output.transcript).toHaveLength(1);
  expect(output.transcript[0]).toMatchObject({ kind: "result", text });
  expect(output.run).toMatchObject({ runId: admitted.runId, status: "queued" });
  await f.invoke("stop", { runId: admitted.runId }, "stop-large-transcript");
});

test("normalized live text is visible only to the active Run it belongs to", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, { ...declaration, capabilities: { ...declaration.capabilities, liveTranscript: true } });
  const { runId } = await f.run("live-transcript");
  const live = { id: runId, at: new Date().toISOString(), kind: "text" as const, text: "in progress", partial: true as const };
  const call = { at: live.at, kind: "tool" as const, tool: "read", args: "{}", callId: "call-a" };
  f.setTranscript([call, { ...live, id: "another-run" }, live]);
  expect(await f.invoke("read", { runId, live: true })).toMatchObject({ ended: false, transcript: [call, live] });
  expect(f.requests.find(row => row.name === "transcript")?.args).toMatchObject({ runId });
  expect(await f.invoke("read", { runId })).toMatchObject({ ended: false, transcript: [call] });
  await f.invoke("stop", { runId }, "stop-live-transcript");
  expect(await f.invoke("read", { runId, live: true })).toMatchObject({ ended: true, transcript: [call] });
});

test("a terminal Run keeps transcript delivery pending until its Provider becomes available", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run("reply-after-stop");
  await f.invoke("stop", { runId: admitted.runId }, "stop-before-reply");
  await f.db.module.update({ where: { id: f.backendCaller.moduleId }, data: { status: "paused" } });
  expect(await f.invoke("read", { runId: admitted.runId })).toMatchObject({ ended: true, transcriptState: { status: "pending" } });
  await f.db.module.update({ where: { id: f.backendCaller.moduleId }, data: { status: "active" } });
  const record = { id: "record-1", at: new Date().toISOString(), kind: "text" as const, text: "retained reply" };
  f.setTranscript([record]);
  expect(await f.invoke("read", { runId: admitted.runId })).toMatchObject({
    ended: true, transcriptState: { status: "available" }, transcript: [record],
  });
  const intruder = await f.installCaller("reply-intruder");
  await expect(agent.handle({ ports: f.ports, workspaceId: f.workspaceId, caller: intruder }, "read", { runId: admitted.runId }))
    .rejects.toMatchObject({ code: "not_found" });
});

test("a Provider without transcript support reports unavailable separately from execution status", async () => {
  const f = await fixture();
  const { transcript: _transcript, ...endpoints } = declaration.endpoints;
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, { ...declaration, endpoints });
  const admitted = await f.run("no-transcript");
  await f.invoke("stop", { runId: admitted.runId }, "stop-no-transcript");
  expect(await f.invoke("read", { runId: admitted.runId })).toMatchObject({ ended: true, transcriptState: { status: "unavailable" } });
});

test("native retries through the public gateway ignore JSON object order and preserve array order", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run("canonical-native"), input = await f.claim(admitted.runId);
  const handle = await startLocalProvider(f.ports, f.workspaceId, input);
  const origin = { ...kernelOrigin(f.workspaceId), caller: f.caller };
  const invoke = (args: Record<string, unknown>) => callSync(f.ports, origin, "agent.native", args, { key: "canonical-native-command" });
  const first = await invoke({ runId: admitted.runId, request: { type: "future_command", nested: { z: [1, 2], a: { b: 3, a: 4 } } } });
  expect(first).not.toHaveProperty("error");
  expect(await invoke({ request: { nested: { a: { a: 4, b: 3 }, z: [1, 2] }, type: "future_command" }, runId: admitted.runId })).toEqual(first);
  expect(f.requests.filter(row => row.name === "native")).toHaveLength(1);
  await expect(invoke({ runId: admitted.runId, request: { type: "future_command", nested: { z: [2, 1], a: { b: 3, a: 4 } } } })).rejects.toMatchObject({ code: "conflict" });
  expect(f.requests.filter(row => row.name === "native")).toHaveLength(1);
  const callbackId = String(f.requests.find(row => row.name === "start")!.args.callbacks);
  await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: f.backendCaller }, "runtime-callback.event", { callbackId, event: { kind: "settled", operationId: admitted.runId, outcome: { outcome: "finished", sessionId: null, error: null } } });
  await handle.done;
}, 10000);

test("native forwards the existing bound operation, isolates owners, masks output, and never replays unknown effects", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run("native-run"), input = await f.claim(admitted.runId);
  const handle = await startLocalProvider(f.ports, f.workspaceId, input);
  const request = { type: "future_backend_command", nested: { keep: [1, 2] } };
  const output = await f.invoke("native", { runId: admitted.runId, request }, "native-once");
  expect(output).toEqual({ response: { operationId: admitted.runId, request, apiKey: "[redacted]" } });
  expect(await f.invoke("native", { runId: admitted.runId, request }, "native-once")).toEqual(output);
  expect(f.requests.filter(row => row.name === "native")).toHaveLength(1);
  const queued = await f.run("different-run");
  await expect(f.invoke("native", { runId: queued.runId, request }, "queued-native")).rejects.toMatchObject({ code: "conflict" });
  expect(f.requests.filter(row => row.name === "start")).toHaveLength(1);
  expect(f.requests.filter(row => row.name === "native")).toHaveLength(1);
  const intruder = await f.installCaller("other-app");
  await expect(agent.handle({ ports: f.ports, workspaceId: f.workspaceId, caller: intruder, call: { id: "cross", key: "cross" } }, "native", { runId: admitted.runId, request })).rejects.toMatchObject({ code: "not_found" });
  f.failNative();
  await expect(f.invoke("native", { runId: admitted.runId, request: { type: "uncertain" } }, "unknown-once")).rejects.toMatchObject({ code: "unknown" });
  await expect(f.invoke("native", { runId: admitted.runId, request: { type: "uncertain" } }, "unknown-once")).rejects.toMatchObject({ code: "unknown" });
  expect(f.requests.filter(row => row.name === "native")).toHaveLength(2);
  const invocationRows = await f.db.moduleInvocation.findMany({ where: { targetModuleId: f.backendCaller.moduleId, tool: { in: ["native", "start"] } } });
  const stored = JSON.stringify(invocationRows);
  expect(stored).not.toContain("private-prompt"); expect(stored).not.toContain(input.token); expect(stored).not.toContain("future_backend_command");
  const callbackId = String(f.requests.find(row => row.name === "start")!.args.callbacks);
  await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: f.backendCaller }, "runtime-callback.event", { callbackId, event: { kind: "settled", operationId: admitted.runId, outcome: { outcome: "finished", sessionId: null, error: null } } });
  await handle.done;
}, 10000);

test("callbacks require the exact provider and operation, and raw retention exposes gaps", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run("callback-run"), input = await f.claim(admitted.runId);
  const channel = createProviderChannel(f.ports, { workspaceId: f.workspaceId, id: admitted.runId, sessionId: admitted.contextId, deadlineAt: input.deadline, token: input.token });
  const handle = await startLocalProvider(f.ports, f.workspaceId, { ...input, events: channel.events });
  const callback = String(f.requests.find(row => row.name === "start")!.args.callbacks);
  const send = (caller: typeof f.caller, event: Record<string, unknown>) => callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller }, "runtime-callback.event", { callbackId: callback, event });
  await expect(send(f.caller, { kind: "raw", value: { type: "event" } })).rejects.toMatchObject({ code: "forbidden" });
  await expect(send(f.backendCaller, { kind: "settled", operationId: "wrong", outcome: { outcome: "finished", sessionId: null, error: null } })).rejects.toMatchObject({ code: "forbidden" });
  await send(f.backendCaller, { kind: "raw", value: { type: "event", authorization: "secret", exact: [1, 2, 3] } });
  await send(f.backendCaller, { kind: "raw", value: { type: "oversize", body: "x".repeat(17000) } });
  for (let index = 0; index < 301; index++) await channel.events.raw!({ type: "more", index });
  await channel.close();
  const rows = await f.db.runEvent.findMany({ where: { runId: admitted.runId, kind: "raw" }, orderBy: { sequence: "asc" } });
  expect(rows).toHaveLength(301);
  expect(rows.at(-1)!.payload).toMatchObject({ value: { type: "chrona_raw_gap", reason: "retention_limit", retainedEvents: 300 } });
  expect(rows.slice(0, 2).map(row => row.payload)).toMatchObject([{ value: { type: "event", authorization: "[redacted]", exact: [1, 2, 3] } }, { value: { type: "chrona_raw_gap", reason: "too_large" } }]);
  const native = await f.invoke("read", { runId: admitted.runId, view: "native", limit: 1 }) as { nextCursor: string };
  await expect(f.invoke("read", { runId: admitted.runId, view: "normalized", cursor: native.nextCursor })).rejects.toMatchObject({ code: "invalid" });
  await send(f.backendCaller, { kind: "settled", operationId: admitted.runId, outcome: { outcome: "finished", sessionId: null, error: null } });
  await handle.done;
}, 30000);

test("completion uses the same queue and admitted token and time budgets", async () => {
  const f = await fixture();
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { moduleModel: { maxCallsPerEvent: 2, maxOutputTokens: 20, dailyCalls: 10, eventTimeoutMs: 5000 } } } });
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, { ...declaration, configuration: { tool: "configure", revision: "completion-config-old" } });
  await expect(f.run("over-budget", { kind: "completion", providerOptions: { maxOutputTokens: 21 } })).rejects.toMatchObject({ code: "failed" });
  const admitted = await f.run("completion", { kind: "completion", providerOptions: { maxOutputTokens: 10 } });
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, { ...declaration, configuration: { tool: "configure", revision: "completion-config-new" } });
  const input = await f.claim(admitted.runId);
  expect(input.deadline!.getTime() - Date.now()).toBeLessThanOrEqual(5000);
  const handle = await startLocalProvider(f.ports, f.workspaceId, input);
  expect(await handle.done).toMatchObject({ outcome: "finished" });
  const args = f.requests.find(row => row.name === "complete")!.args;
  expect(args).toMatchObject({ commandKey: admitted.runId, maxOutputTokens: 10, configurationRevision: "completion-config-old" });
  expect(Number(args.timeoutMs)).toBeLessThanOrEqual(5000);
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model", status: "executed" } })).toMatchObject({ inputTokens: 2, outputTokens: 3 });
  expect(await f.db.run.count()).toBe(1);
  await f.db.module.update({ where: { id: f.backendCaller.moduleId }, data: { status: "paused" } });
  expect(await f.invoke("read", { runId: admitted.runId })).toMatchObject({ items: [{ kind: "completion", payload: { text: "bounded completion" } }] });
});


test.each(["stop", "caller-drain", "provider-drain"] as const)("unstarted completion %s settles its reservation and permits removal", async action => {
  const f = await fixture();
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { moduleModel: { maxCallsPerEvent: 2, maxOutputTokens: 20, dailyCalls: 10, eventTimeoutMs: 5000 } } } });
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run("unstarted-completion", { kind: "completion", providerOptions: { maxOutputTokens: 10 } });
  if (action === "stop") await f.invoke("stop", { runId: admitted.runId }, "stop-unstarted");
  else await fenceAgentModule(f.ports, f.workspaceId, action === "caller-drain" ? f.caller.moduleId : f.backendCaller.moduleId);
  expect(await f.invoke("read", { runId: admitted.runId })).toMatchObject({ run: { status: "cancelled", active: false } });
  expect(await requestRemove(moduleContext(f.ports, f.workspaceId), f.caller.moduleId, "remove drained caller")).toMatchObject({ status: "pending_approval" });
  expect(f.requests.filter(request => ["start", "complete", "abort"].includes(request.name))).toEqual([]);
});

test("stop confirms only the bound backend outcome receipt", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run("stop-run"), input = await f.claim(admitted.runId);
  const handle = await startLocalProvider(f.ports, f.workspaceId, input);
  expect(await f.invoke("stop", { runId: admitted.runId }, "stop-once")).toMatchObject({ active: false, stopConfirmed: true });
  expect(f.requests.find(row => row.name === "abort")!.args.operationId).toBe(admitted.runId);
  await handle.done;
}, 10000);


test("unconfirmed stop retains Run capacity and cannot masquerade as a stop receipt", async () => {
  const f = await fixture();
  f.unconfirmedStop();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run("uncertain-stop"), input = await f.claim(admitted.runId);
  const handle = await startLocalProvider(f.ports, f.workspaceId, input);
  await createRuns(f.ports, f.workspaceId).finish(admitted.runId, { outcome: "unavailable", sessionId: null, error: "Lost connection" });
  expect(await f.invoke("stop", { runId: admitted.runId }, "uncertain-stop-control")).toMatchObject({ active: true, status: "unknown", stopConfirmed: false });
  await expect(f.run("blocked-context", { contextId: admitted.contextId })).rejects.toMatchObject({ code: "conflict" });
  const waiting = await f.run("waiting-other-context");
  expect(await createRuns(f.ports, f.workspaceId).claimNext("background")).toBeNull();
  expect((await f.db.run.findUniqueOrThrow({ where: { id: waiting.runId } })).status).toBe("queued");
  const callbackId = String(f.requests.find(row => row.name === "start")!.args.callbacks);
  await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: f.backendCaller }, "runtime-callback.event", { callbackId, event: { kind: "settled", operationId: admitted.runId, outcome: { outcome: "finished", sessionId: null, error: null } } });
  await handle.done;
});

test("configuration changes preserve queued and continuing context revisions", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, { ...declaration, configuration: { tool: "configure", revision: "old-profile" } });
  const admitted = await f.run("old-profile-run"), pinned = await f.db.agentRunProvider.findUniqueOrThrow({ where: { runId: admitted.runId } });
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, { ...declaration, configuration: { tool: "configure", revision: "new-profile" } });
  const input = await f.claim(admitted.runId), handle = await startLocalProvider(f.ports, f.workspaceId, input);
  expect(f.requests.find(row => row.name === "start")!.args.configurationRevision).toBe("old-profile");
  await f.invoke("stop", { runId: admitted.runId }, "old-profile-stop");
  await handle.done;
  const continued = await f.run("continue-old", { contextId: admitted.contextId });
  expect(await f.db.agentRunProvider.findUniqueOrThrow({ where: { runId: continued.runId } })).toMatchObject({ revision: pinned.revision });
  const next = await f.run("new-context");
  const latest = await f.db.agentProvider.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId: f.workspaceId, id: "offline" } } });
  expect(await f.db.agentRunProvider.findUniqueOrThrow({ where: { runId: next.runId } })).toMatchObject({ revision: latest.revision });
}, 10000);


test("provider discovery keeps exact id filtering when a cursor is supplied", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  expect(await f.invoke("providers", { id: "missing", cursor: "a" })).toEqual({ items: [], nextCursor: null });
});

for (const name of ["native", "write"] as const) test(`${name} settles its admitted effect when drain begins during the backend await`, async () => {
  const entered = latch(), resume = latch();
  const endpoint = name === "native" ? "native" : "inject";
  const f = await fixture(async control => { if (control === endpoint) { entered.resolve(); await resume.promise; } });
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run(`drain-${name}`), input = await f.claim(admitted.runId);
  const handle = await startLocalProvider(f.ports, f.workspaceId, input);
  liveRuns.set(admitted.runId, handle);
  const requestKey = `drain-${name}-once`, request = { type: "during_drain" };
  const args = name === "native" ? { runId: admitted.runId, request } : { runId: admitted.runId, input: { kind: "message", text: "already admitted" } };
  const command = name === "native" ? { runId: admitted.runId, request, requestKey } : { runId: admitted.runId, message: "already admitted", requestKey };
  const pending = f.invoke(name, args, requestKey);
  try {
    await entered.promise;
    await f.fence();
  } finally { resume.resolve(); }
  const result = await pending;
  expect(result).toEqual(name === "native" ? { response: { operationId: admitted.runId, request, apiKey: "[redacted]" } } : { accepted: true });
  expect(await f.invoke(name, args, requestKey)).toEqual(result);
  // Use a fresh primitive call so the replay must come from the durable receipt, not the live handle.
  const replay = () => admitContextPrimitive(f.ports, f.principal, name, command);
  const original = await replay();
  expect(original).toMatchObject({ perform: false, ...(name === "native" ? { result } : {}) });
  // Repeated settlement cannot replace an already completed response.
  await admitContextPrimitive(f.ports, f.principal, name, command, true, { result: "replacement" });
  expect(await replay()).toEqual(original);
  await expect(admitContextPrimitive(f.ports, f.principal, name, { ...command, requestKey: "not-admitted" }, true)).rejects.toMatchObject({ code: "not_found" });
  await expect(admitContextPrimitive(f.ports, f.principal, name, { ...command, requestKey: "fresh-effect" })).rejects.toMatchObject({ code: "forbidden" });
  expect(f.requests.filter(row => row.name === endpoint)).toHaveLength(1);
  expect(await f.db.run.count()).toBe(1);
  expect(await f.invoke("stop", { runId: admitted.runId }, `drain-${name}-stop`)).toMatchObject({ active: false, stopConfirmed: true });
  await handle.done;
  liveRuns.delete(admitted.runId);
}, 10000);

test("an uncertain native effect stays unknown after drain and settlement binds the exact receipt identity", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run("unknown-drain");
  await f.claim(admitted.runId);
  const args = { runId: admitted.runId, request: { type: "lost_reply" } }, command = { ...args, requestKey: "unknown-drain-once" };
  // A persisted reservation with no response models a host lost after effect admission.
  expect(await admitContextPrimitive(f.ports, f.principal, "native", command)).toMatchObject({ perform: true });
  await f.fence();
  const replay = () => admitContextPrimitive(f.ports, f.principal, "native", command);
  await expect(replay()).rejects.toMatchObject({ code: "unknown" });
  await expect(admitContextPrimitive(f.ports, f.principal, "native", { ...command, request: { type: "changed" } }, true)).rejects.toMatchObject({ code: "conflict" });
  await expect(admitContextPrimitive(f.ports, { ...f.principal, caller: { ...f.principal.caller, hash: "caller-v2" } }, "native", command, true)).rejects.toMatchObject({ code: "forbidden" });
  const intruder = await f.installCaller("receipt-intruder");
  await expect(admitContextPrimitive(f.ports, { ...f.principal, caller: intruder }, "native", command, true)).rejects.toMatchObject({ code: "not_found" });
  const otherWorkspace = await f.db.workspace.create({ data: { name: "other receipt workspace" } });
  await expect(admitContextPrimitive(f.ports, { ...f.principal, workspaceId: otherWorkspace.id }, "native", command, true)).rejects.toMatchObject({ code: "not_found" });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.caller.moduleId, hash: f.caller.hash } }, data: { status: "draft" } });
  await expect(admitContextPrimitive(f.ports, f.principal, "native", command, true)).rejects.toMatchObject({ code: "forbidden" });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.caller.moduleId, hash: f.caller.hash } }, data: { status: "approved" } });
  await f.db.module.update({ where: { id: f.caller.moduleId }, data: { status: "paused" } });
  await expect(admitContextPrimitive(f.ports, f.principal, "native", command, true)).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: f.caller.moduleId }, data: { status: "active" } });
  await expect(replay()).rejects.toMatchObject({ code: "unknown" });
  expect(f.requests.filter(row => row.name === "native")).toHaveLength(0);
  expect(await f.db.run.count()).toBe(1);
}, 10000);

test("drain blocks public and low-level admission while old reads, stops, and queued completion remain available", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const admitted = await f.run("queued-before-drain"), cancelled = await f.run("stop-before-claim");
  await f.fence();
  expect(await f.run("queued-before-drain")).toEqual(admitted);
  await expect(f.run("fresh-during-drain")).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.run("continue-during-drain", { contextId: admitted.contextId })).rejects.toMatchObject({ code: "forbidden" });
  const runs = createRuns(f.ports, f.workspaceId);
  const enqueue = { sessionId: admitted.contextId, lane: "background" as const, trigger: "source" as const, prompt: "bypass attempt" };
  await expect(runs.enqueue(enqueue)).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.db.$transaction(tx => runs.enqueue(enqueue, tx))).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.run.count()).toBe(2);
  expect(await f.invoke("read", { runId: admitted.runId })).toMatchObject({ run: { runId: admitted.runId, status: "queued" } });
  expect(await f.invoke("stop", { runId: cancelled.runId }, "stop-during-drain")).toMatchObject({ active: false, stopConfirmed: true });
  const input = await f.claim(admitted.runId), handle = await startLocalProvider(f.ports, f.workspaceId, input);
  await f.invoke("stop", { runId: admitted.runId }, "stop-claimed-during-drain");
  await handle.done;
  expect(await f.invoke("read", { runId: admitted.runId })).toMatchObject({ ended: true });
  expect(await runs.claimNext("background")).toBeNull();
  expect(await f.db.run.count()).toBe(2);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.caller.moduleId } })).executionFenceAt).not.toBeNull();
}, 10000);

test("low-level Agent context admission requires the owning approved active module", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const session = await f.db.agentContext.create({ data: { workspaceId: f.workspaceId, ownerId: "owner", moduleId: f.caller.moduleId, hash: f.caller.hash } });
  const runs = createRuns(f.ports, f.workspaceId);
  const enqueue = { sessionId: session.id, lane: "background" as const, trigger: "source" as const, prompt: "ordinary module session" };
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.caller.moduleId, hash: f.caller.hash } }, data: { status: "draft" } });
  await expect(runs.enqueue(enqueue)).rejects.toMatchObject({ code: "forbidden" });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.caller.moduleId, hash: f.caller.hash } }, data: { status: "approved" } });
  await f.db.module.update({ where: { id: f.caller.moduleId }, data: { status: "paused" } });
  await expect(runs.enqueue(enqueue)).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: f.caller.moduleId }, data: { status: "active" } });
  const run = await runs.enqueue(enqueue);
  expect((await runs.claimNext("background"))?.runId).toBe(run.id);
  await runs.finish(run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
  expect(await f.db.run.count()).toBe(1);
});

test("Agent cwd is fixed for its context while Provider sessions stay in the session area", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const cwd = join(f.ports.dataDir, "prepared-project");
  const other = join(f.ports.dataDir, "other-project");
  await mkdir(cwd); await mkdir(other);
  const admitted = await f.run("prepared-cwd", { cwd });
  const input = await f.claim(admitted.runId);
  expect(input.cwd).toBe(cwd);
  expect(input.sessionDir).toBe(join(f.ports.dataDir, "sessions", admitted.contextId, ".chrona", "sessions"));
  const handle = await startLocalProvider(f.ports, f.workspaceId, input);
  expect(f.requests.find(row => row.name === "start")!.args).toMatchObject({ cwd, sessionDir: input.sessionDir });
  await f.invoke("stop", { runId: admitted.runId }, "stop-prepared-cwd");
  await handle.done;
  await expect(f.run("changed-cwd", { contextId: admitted.contextId, cwd: other })).rejects.toMatchObject({ code: "conflict" });
  const continued = await f.run("same-cwd", { contextId: admitted.contextId });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: continued.runId } })).toMatchObject({ cwd });
  await f.invoke("stop", { runId: continued.runId }, "stop-same-cwd");
  const explicit = await f.run("explicit-same-cwd", { contextId: admitted.contextId, cwd });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: explicit.runId } })).toMatchObject({ cwd });
});

test("Agent defaults cwd to its session directory and rejects unprepared paths before admission", async () => {
  const f = await fixture();
  await registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration);
  const file = join(f.ports.dataDir, "plain-file");
  await writeFile(file, "file");
  for (const cwd of ["relative/path", join(f.ports.dataDir, "missing"), file]) {
    await expect(f.run(`invalid-cwd-${cwd}`, { cwd })).rejects.toMatchObject({ code: "invalid" });
  }
  const admitted = await f.run("default-cwd");
  expect(await f.db.run.findUniqueOrThrow({ where: { id: admitted.runId } })).toMatchObject({ cwd: join(f.ports.dataDir, "sessions", admitted.contextId) });
});
