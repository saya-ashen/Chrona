import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, type AgentProviderRegistration, type ProviderRunInput } from "@chrona/contracts/steward";
import { assertProviderBinding, callProviderEndpoint, registerAgentProvider, runProviderBinding, selectAgentProvider } from "./agent-provider";
import { reconcileAgentStops } from "./agent-recovery";
import { admitContextPrimitive } from "./agent-context";
import { moduleContext } from "../modules/module-context";
import { requestStatus, setStatusIn } from "../modules/module-status";
import { moduleSupervisor } from "../modules/module-supervisor";
import { testModuleProcess } from "../modules/module-test-process";
import { testDb } from "../test-db";
import { startLocalProvider } from "../execution/local-runtime";
import { createRuns } from "../execution/runs";
import { agent } from "../system/agent";
import { registerSystemModules } from "../system-modules";
import { CallError } from "../modules/module-call-error";
import type { StewardPorts } from "../ports";
import "../modules/module-effects";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const declaration: AgentProviderRegistration = {
  id: "offline", name: "Fence recovery backend", protocolVersion: 1,
  capabilities: { conversation: true, completion: true, native: true, images: false, interactions: false, resume: true },
  endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release", native: "native", complete: "complete", transcript: "transcript" },
};
async function fixture({ activated = false, stage = "unknown", fenceApplication = false, confirmAbort = true }: { activated?: boolean; stage?: "queued" | "running" | "unknown"; fenceApplication?: boolean; confirmAbort?: boolean } = {}) {
  registerSystemModules();
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-provider-fence-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const workspaceId = (await db.workspace.create({ data: { name: "provider fence recovery" } })).id;
  const requests: { name: string; args: Record<string, unknown> }[] = [];
  let stopped = false;
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    const { id: name, args } = event.trigger;
    requests.push({ name, args });
    if (name === "health") return { result: { name: "offline", supportsRunModel: true, complete: true, available: true, sandboxed: false, error: null } };
    // Model an ambiguous submission with a durable launch receipt and no attached observer.
    if (name === "start") throw new CallError("unknown", "Submission response lost");
    if (name === "abort" && confirmAbort) stopped = true;
    if (name === "status") return { result: { operationId: args.operationId, outcome: stopped ? { outcome: "failed", sessionId: null, error: "Original operation stopped; external effects remain unconfirmed" } : null, failure: false } };
    return { result: {} };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true }); });
  const backend = await db.module.create({ data: { workspaceId, name: "fenced-backend", status: "active", activeHash: "backend-v1", activationId: "original-activation" } });
  const string = { type: "string" }, object = { type: "object", properties: {} };
  const startProperties = Object.fromEntries(["operationId", "runId", "token", "lane", "cwd", "sessionDir", "prompt", "systemPrompt", "resources", "callbacks", "model", "configurationRevision"].map(key => [key, string]));
  Object.assign(startProperties, { sessionId: { type: ["string", "null"] }, deadline: { type: ["string", "null"] }, providerOptions: object, execution: object, executionBudget: object, searchTools: { type: "boolean" }, images: { type: "array", items: object }, extraTools: { type: "array", items: string }, hostPaths: { type: "array", items: string }, content: { type: "array", items: object } });
  const manifest = moduleManifestSchema.parse({ name: backend.name, entry: "index.ts", tests: ["test.ts"], activated, uses: ["agent.register"], effects: [], tools: Object.values(declaration.endpoints).map(name => ({ name, description: name, visibility: ["kernel"], parameters: { type: "object", properties: name === "health" ? {} : name === "start" ? startProperties : { operationId: string } }, output: {} })) });
  await db.moduleVersion.create({ data: { moduleId: backend.id, hash: backend.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const backendCaller = { kind: "module" as const, module: backend.name, moduleId: backend.id, hash: backend.activeHash! };
  await registerAgentProvider(ports, workspaceId, backendCaller, declaration);
  const app = await db.module.create({ data: { workspaceId, name: "entry-app", activeHash: "app-v1" } });
  const appManifest = moduleManifestSchema.parse({ name: app.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses: ["agent.run", "agent.stop"], model: { tier: "any", maxCalls: 2, maxOutputTokens: 20 } });
  await db.moduleVersion.create({ data: { moduleId: app.id, hash: app.activeHash!, manifest: appManifest, source: "user", status: "approved", intent: {}, report: {} } });
  const caller = { kind: "module" as const, module: app.name, moduleId: app.id, hash: app.activeHash! };
  const admitted = await agent.handle({ ports, workspaceId, caller, call: { id: "original-run", key: "original-run" } }, "run", { prompt: "offline recovery" }) as { runId: string };
  const claimed = stage === "queued" ? null : await createRuns(ports, workspaceId).claimNext("background");
  if (stage !== "queued") expect(claimed?.runId).toBe(admitted.runId);
  const run = await db.run.findUniqueOrThrow({ where: { id: admitted.runId } });
  const input: ProviderRunInput = { runId: run.id, token: claimed?.token ?? "", lane: "background", cwd: run.cwd, sessionDir: join(dataDir, "sessions"), sessionId: null, prompt: run.prompt, systemPrompt: "system", resources: "configured", deadline: run.deadlineAt };
  if (stage !== "queued") await expect(startLocalProvider(ports, workspaceId, input)).rejects.toMatchObject({ code: "unknown" });
  if (stage === "unknown") await createRuns(ports, workspaceId).finish(run.id, { outcome: "unavailable", sessionId: null, error: "Lost observer" });
  const context = moduleContext(ports, workspaceId);
  await expect(requestStatus(context, fenceApplication ? app.id : backend.id, "paused", "drain")).rejects.toMatchObject({ code: "conflict" });
  const binding = await runProviderBinding(ports, workspaceId, run.id);
  const control = (endpoint: "status" | "abort" | "release", key?: string) => callProviderEndpoint(ports, workspaceId, binding, endpoint, { operationId: run.id }, key);
  return { db, ports, workspaceId, backend, backendCaller, manifest, context, binding, run, input, requests, control, app, caller, confirmStop: () => { stopped = true; } };
}

test("fenced original operation remains controllable; normal enable waits for real status proof and never replays launch", async () => {
  const f = await fixture();
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ status: "failed", stopStatus: "unknown" });
  const fenced = await f.db.module.findUniqueOrThrow({ where: { id: f.backend.id } });
  expect(fenced).toMatchObject({ status: "active", executionFenceAt: expect.any(Date) });
  await reconcileAgentStops(f.ports, f.workspaceId);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ stopStatus: "unknown" });
  await expect(requestStatus(f.context, f.backend.id, "active", "recover")).rejects.toMatchObject({ code: "conflict" });
  await expect(f.db.$transaction(tx => setStatusIn(f.context, tx, f.backend.id, "active", "owner"))).rejects.toMatchObject({ code: "conflict" });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.backend.id } })).executionFenceAt).toEqual(fenced.executionFenceAt);
  await f.control("abort", "original-abort");
  await expect(f.control("abort", "original-abort")).rejects.toMatchObject({ code: "unknown" });
  // Even an abort acknowledgement cannot itself release the fence or capacity.
  await expect(requestStatus(f.context, f.backend.id, "active", "abort ack only")).rejects.toMatchObject({ code: "conflict" });
  await reconcileAgentStops(f.ports, f.workspaceId);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ status: "failed", stopStatus: "confirmed" });
  await f.control("release");
  expect(await requestStatus(f.context, f.backend.id, "active", "confirmed drain")).toMatchObject({ status: "active" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.backend.id } })).toMatchObject({ executionFenceAt: null, activationId: "original-activation", activeHash: f.binding.hash });
  await requestStatus(f.context, f.backend.id, "active", "idempotent");
  expect(await f.db.audit.count({ where: { subjectId: f.backend.id, kind: "module_enabled" } })).toBe(1);
  await expect(startLocalProvider(f.ports, f.workspaceId, f.input)).rejects.toThrow();
  expect(f.requests.filter(row => row.name === "start")).toHaveLength(1);
  expect(f.requests.filter(row => row.name === "abort")).toHaveLength(1);
  expect(f.requests.filter(row => row.name === "release")).toHaveLength(1);
  expect(f.requests.filter(row => ["status", "abort", "release"].includes(row.name)).every(row => row.args.operationId === f.run.id)).toBe(true);
  const receipt = await f.db.moduleInvocation.findFirstOrThrow({ where: { key: "original-abort" } });
  expect(receipt).toMatchObject({ args: {}, output: null, status: "succeeded", targetHash: f.binding.hash, targetModuleId: f.backend.id });
});

test("fence never grants admission, health, new effects, or unbound controls", async () => {
  const f = await fixture(), before = f.requests.length;
  await expect(assertProviderBinding(f.db, f.workspaceId, f.binding)).rejects.toMatchObject({ code: "forbidden" });
  await expect(selectAgentProvider(f.ports, f.workspaceId)).rejects.toMatchObject({ code: "unavailable" });
  await expect(registerAgentProvider(f.ports, f.workspaceId, f.backendCaller, declaration)).rejects.toMatchObject({ code: "forbidden" });
  for (const endpoint of ["health", "start", "complete", "inject", "native", "transcript"] as const) {
    await expect(callProviderEndpoint(f.ports, f.workspaceId, f.binding, endpoint, { operationId: f.run.id })).rejects.toMatchObject({ code: "forbidden" });
  }
  await expect(startLocalProvider(f.ports, f.workspaceId, f.input)).rejects.toMatchObject({ code: "forbidden" });
  for (const endpoint of ["status", "abort", "release"] as const) {
    await expect(callProviderEndpoint(f.ports, f.workspaceId, f.binding, endpoint, { operationId: "other-operation" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(callProviderEndpoint(f.ports, f.workspaceId, f.binding, endpoint, { operationId: f.run.id, request: "extra authority" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(callProviderEndpoint(f.ports, f.workspaceId, { ...f.binding, providerId: "different-provider" }, endpoint, { operationId: f.run.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(callProviderEndpoint(f.ports, "different-workspace", f.binding, endpoint, { operationId: f.run.id })).rejects.toMatchObject({ code: "forbidden" });
  }
  await f.db.providerLaunch.delete({ where: { runId: f.run.id } });
  await expect(f.control("status")).rejects.toMatchObject({ code: "forbidden" });
  expect(f.requests).toHaveLength(before);
});

test.each(["changed hash", "paused", "removed", "deleted", "revoked", "changed contract"] as const)("fenced controls reject %s without reaching the provider", async state => {
  const f = await fixture(), before = f.requests.length;
  if (state === "changed hash") await f.db.module.update({ where: { id: f.backend.id }, data: { activeHash: "different-approved-hash" } });
  if (state === "paused" || state === "removed") await f.db.module.update({ where: { id: f.backend.id }, data: { status: state } });
  if (state === "deleted") await f.db.module.delete({ where: { id: f.backend.id } });
  if (state === "revoked") await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.backend.id, hash: f.binding.hash } }, data: { status: "revoked" } });
  if (state === "changed contract") await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.backend.id, hash: f.binding.hash } }, data: { manifest: { ...f.manifest, tools: f.manifest.tools.map(tool => tool.name === "status" ? { ...tool, output: { type: "string" } } : tool) } } });
  for (const endpoint of ["status", "abort", "release"] as const) await expect(f.control(endpoint)).rejects.toMatchObject({ code: state === "changed contract" ? "conflict" : "forbidden" });
  await reconcileAgentStops(f.ports, f.workspaceId);
  expect((await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).stopStatus).toBe("unknown");
  expect(f.requests).toHaveLength(before);
});

test.each(["owner", "chrona"] as const)("%s enable clears a drained active fence only while the active version is approved", async source => {
  const f = await fixture();
  await f.control("abort");
  await reconcileAgentStops(f.ports, f.workspaceId);
  const enable = () => source === "chrona" ? requestStatus(f.context, f.backend.id, "active", "recover") : f.db.$transaction(tx => setStatusIn(f.context, tx, f.backend.id, "active", source));
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.backend.id, hash: f.binding.hash } }, data: { status: "revoked" } });
  await expect(enable()).rejects.toMatchObject({ code: "conflict" });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.backend.id } })).executionFenceAt).not.toBeNull();
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.backend.id, hash: f.binding.hash } }, data: { status: "approved" } });
  await enable();
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.backend.id } })).toMatchObject({ status: "active", executionFenceAt: null, activationId: "original-activation" });
});

test.skipIf(process.platform !== "linux")("cold actual Pi SDK rejects fenced activation yet reconciles only the original host's descendant-stop receipt", async () => {
  const f = await fixture({ activated: true });
  const data = join(f.ports.dataDir, "platform/data", f.backend.id), profile = join(data, "profile");
  await mkdir(profile, { recursive: true });
  await mkdir(join(data, "operations"));
  await mkdir(join(data, ".host-stops"));
  await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "fixture" }));
  const generation = "a".repeat(64), key = createHash("sha256").update(JSON.stringify(f.run.id)).digest("hex");
  const journal = join(data, "operations", `${key}.json`), stopReceipt = join(data, ".host-stops", `${generation}.json`);
  await writeFile(journal, JSON.stringify({ digest: "c".repeat(64), hostGeneration: generation }), { mode: 0o600 });
  const receipt = (treeClean: boolean) => JSON.stringify({ version: 1, generation, state: "stopped", scope: "descendants", treeClean });
  await writeFile(stopReceipt, receipt(false), { mode: 0o600 });
  const children: ReturnType<typeof Bun.spawn>[] = [];
  f.ports.sandbox!.startModule = input => {
    const child = Bun.spawn([process.execPath, "--no-install", join(import.meta.dir, "../../../../.generated/applications/pi/runtime.ts")], {
      cwd: join(import.meta.dir, "../../../.."), stdin: "ignore", stdout: "ignore", stderr: "pipe",
      env: { ...process.env, CHRONA_IPC_ENDPOINT: input.ipcEndpoint, CHRONA_IPC_TOKEN: input.ipcToken, CHRONA_DATA: input.dataDir,
        CHRONA_MODULE_BINDINGS: "{}", CHRONA_HOST_GENERATION: "b".repeat(64),
        CHRONA_PROVIDER_CONFIGURATION: JSON.stringify({ command: "/must-not-launch-pi", agentDir: profile, chronaExtension: "/fixture/bridge", agentUrl: "http://fixture.invalid" }), CHRONA_PROVIDER_MODEL_ENV: "{}" },
    });
    children.push(child);
    return { pid: child.pid, exited: child.exited.then(code => ({ code, signal: null })), stderr: () => "", kill: () => { child.kill(); } };
  };
  // The production SDK preserves the forbidden category for failed registration,
  // so the supervisor treats activation rejection as a nonfatal handler response.
  const now = f.ports.now().toISOString();
  await expect(moduleSupervisor(f.ports).deliver(f.backend.id, f.binding.hash, { now, params: {}, trigger: { kind: "activated", id: "activated", firedAt: now } })).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.control("status")).toMatchObject({ operationId: f.run.id, outcome: null, failure: true });
  await expect(f.control("release")).rejects.toMatchObject({ code: "conflict" });
  await reconcileAgentStops(f.ports, f.workspaceId);
  await expect(requestStatus(f.context, f.backend.id, "active", "no descendant proof")).rejects.toMatchObject({ code: "conflict" });
  // An abort on an orphaned operation is unknown, and cannot invent stop proof.
  await expect(f.control("abort")).rejects.toMatchObject({ code: "unknown" });
  expect((await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).stopStatus).toBe("unknown");
  expect(JSON.parse(await readFile(journal, "utf8"))).not.toHaveProperty("outcome");
  // That unknown reply intentionally retires this SDK process. Wait only for its
  // actual exit before the next cold host reads the trusted original receipt.
  await children[0]!.exited;
  await writeFile(stopReceipt, receipt(true));
  await reconcileAgentStops(f.ports, f.workspaceId);
  expect((await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).stopStatus).toBe("confirmed");
  expect(JSON.parse(await readFile(journal, "utf8"))).toMatchObject({ hostGeneration: generation, outcome: { outcome: "failed", error: expect.stringContaining("work was not replayed") } });
  await f.control("abort");
  await f.control("release");
  await requestStatus(f.context, f.backend.id, "active", "trusted descendant stop");
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.backend.id } })).executionFenceAt).toBeNull();
  expect(f.requests.filter(request => request.name === "start")).toHaveLength(1);
  expect(await f.db.providerLaunch.count({ where: { runId: f.run.id } })).toBe(1);
  expect(children).toHaveLength(2);
  expect(children[1]!.exitCode).toBeNull();
  expect(await f.db.moduleRun.count({ where: { moduleId: f.backend.id, triggerId: "activated", error: { not: null } } })).toBe(1);
});

test.each(["queued", "running"] as const)("fenced application can stop only its existing %s Run through both principal checks", async stage => {
  const f = await fixture({ stage, fenceApplication: true, confirmAbort: false });
  const principal = { workspaceId: f.workspaceId, ownerId: "owner", caller: f.caller };
  const invoke = (name: string, args: Record<string, unknown>, key = name) => agent.handle({ ports: f.ports, workspaceId: f.workspaceId, caller: f.caller, call: { id: key, key } }, name, args);
  const enable = () => requestStatus(f.context, f.app.id, "active", "drained own run");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.app.id } })).toMatchObject({ status: "active", executionFenceAt: expect.any(Date) });
  await expect(enable()).rejects.toMatchObject({ code: "conflict" });
  await expect(invoke("run", { prompt: "new admission" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(invoke("write", { runId: f.run.id, input: { kind: "message", text: "new work" } })).rejects.toMatchObject({ code: "forbidden" });
  for (const name of ["run", "write", "respond", "native"] as const) {
    await expect(admitContextPrimitive(f.ports, principal, name, { runId: f.run.id, requestKey: `blocked-${name}`, questionId: "q", answer: { decision: "cancel" }, tools: [], content: [], lane: "background", prompt: "blocked" })).rejects.toMatchObject({ code: "forbidden" });
  }
  expect(await f.db.run.count({ where: { workspaceId: f.workspaceId } })).toBe(1);
  const first = await invoke("stop", { runId: f.run.id }, "own-stop");
  if (stage === "running") {
    expect(first).toMatchObject({ active: true, stopConfirmed: false });
    expect(await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ status: "running", stopStatus: "pending", cancelRequestedAt: expect.any(Date) });
    await expect(enable()).rejects.toMatchObject({ code: "conflict" });
    await invoke("stop", { runId: f.run.id }, "own-stop");
    expect(f.requests.filter(row => row.name === "abort")).toHaveLength(1);
    // An abort reply is not a stop receipt. Only the original bound status can settle it.
    f.confirmStop();
    expect(await invoke("stop", { runId: f.run.id }, "confirm-own-stop")).toMatchObject({ active: false, stopConfirmed: true });
    expect(f.requests.filter(row => row.name === "start")).toHaveLength(1);
    expect(f.requests.filter(row => row.name === "abort").every(row => row.args.operationId === f.run.id)).toBe(true);
    expect(await f.db.providerLaunch.count({ where: { runId: f.run.id } })).toBe(1);
  } else {
    expect(first).toMatchObject({ status: "cancelled", active: false, stopConfirmed: true });
    expect(await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ status: "cancelled", stopStatus: "confirmed", cancelRequestedAt: expect.any(Date) });
    expect(await f.db.providerLaunch.count({ where: { runId: f.run.id } })).toBe(0);
    expect(f.requests.filter(row => ["start", "abort", "status"].includes(row.name))).toHaveLength(0);
    expect(await createRuns(f.ports, f.workspaceId).claimNext("background")).toBeNull();
  }
  await enable();
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.app.id } })).executionFenceAt).toBeNull();
  await invoke("stop", { runId: f.run.id }, "own-stop");
  expect(await f.db.agentCommand.count({ where: { workspaceId: f.workspaceId, operation: "interrupt" } })).toBe(stage === "running" ? 2 : 1);
});

test.each(["changed hash", "paused", "removed", "revoked", "other caller", "other workspace", "other context hash"] as const)("application fence stop rejects %s at entry and at transaction admission", async state => {
  const f = await fixture({ stage: "queued", fenceApplication: true });
  if (state === "changed hash") await f.db.module.update({ where: { id: f.app.id }, data: { activeHash: "different-version" } });
  if (state === "paused" || state === "removed") await f.db.module.update({ where: { id: f.app.id }, data: { status: state } });
  if (state === "revoked") await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.app.id, hash: f.caller.hash } }, data: { status: "revoked" } });
  if (state === "other context hash") await f.db.agentContext.update({ where: { sessionId: f.run.sessionId! }, data: { hash: "different-version" } });
  const caller = state === "other caller" ? f.backendCaller : f.caller;
  const workspaceId = state === "other workspace" ? "another-workspace" : f.workspaceId;
  const code = state === "other caller" || state === "other context hash" ? "not_found" : "forbidden";
  await expect(agent.handle({ ports: f.ports, workspaceId, caller, call: { id: "invalid-stop", key: "invalid-stop" } }, "stop", { runId: f.run.id })).rejects.toMatchObject({ code });
  await expect(admitContextPrimitive(f.ports, { workspaceId, ownerId: "owner", caller }, "interrupt", { runId: f.run.id, requestKey: "invalid-direct-stop" })).rejects.toMatchObject({ code });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ status: "queued", stopStatus: "pending", cancelRequestedAt: null });
  expect(await f.db.agentCommand.count({ where: { operation: "interrupt" } })).toBe(0);
  expect(f.requests.filter(row => ["start", "abort", "status"].includes(row.name))).toHaveLength(0);
});
