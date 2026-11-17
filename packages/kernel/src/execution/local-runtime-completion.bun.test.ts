import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { moduleManifestSchema, type AgentProviderRegistration, type ProviderRunInput } from "@chrona/contracts/steward";
import { createPiCompletion, launchPiProcess } from "@chrona/pi";
import { agent } from "../system/agent";
import { registerAgentProvider } from "../agent/agent-provider";
import { startLocalProvider } from "./local-runtime";
import { createRuns } from "./runs";
import { CallError } from "../modules/module-calls";
import { moduleSupervisor } from "../modules/module-supervisor";
import { testModuleProcess } from "../modules/module-test-process";
import { testDb } from "../test-db";
import type { StewardPorts } from "../ports";
import { createPiApplication, REGISTRATION } from "../../../../.generated/applications/pi/application";
import { manifest } from "../../../../.generated/applications/pi/build";
import "../modules/module-effects";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); }, 30000);
async function fixture(mode: "ok" | "hang", lostReceipt = false) {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/chrona-completion-kernel-");
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const workspaceId = (await db.workspace.create({ data: { name: "completion lifecycle", settings: { moduleModel: { maxCallsPerEvent: 2, maxOutputTokens: 20, dailyCalls: 10, eventTimeoutMs: 5000 } } } })).id;
  const profile = join(dataDir, "profile"), command = join(dataDir, "fake-pi"), processRecord = join(dataDir, "process.json");
  await mkdir(profile);
  await writeFile(command, `#!${process.execPath}
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
if (process.argv.includes('--version')) { console.log('1.5.0'); process.exit(0); }
writeFileSync(${JSON.stringify(processRecord)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
for await (const chunk of process.stdin) {}
const hooks = new Map();
const extension = await import(pathToFileURL(process.argv[process.argv.indexOf('-e') + 1]).href);
extension.default({ on: (key, fn) => hooks.set(key, fn) });
hooks.get('before_provider_request')({payload:{max_completion_tokens:100}}, {model:{provider:'fake',id:'exact',api:'openai-completions'}});
if (${JSON.stringify(mode)} === 'hang') setInterval(() => {}, 1000);
else console.log(JSON.stringify({type:'message_end',message:{role:'assistant',model:'exact',provider:'fake',stopReason:'stop',content:[{type:'text',text:'actual completion'}],usage:{input:2,output:3}}}));
`, { mode: 0o755 });
  let acceptClosure!: () => void, rejectClosure!: (error: Error) => void, actualClosed: Promise<unknown> | undefined, launches = 0;
  const closure = new Promise<void>((resolve, reject) => { acceptClosure = resolve; rejectClosure = reject; });
  void closure.catch(() => {});
  const requests: string[] = [];
  const application = createPiApplication({ data: join(dataDir, "backend"), options: { command, agentDir: profile, model: "fake/exact", expectedVersion: "1.5.0", chronaExtension: command, agentUrl: "http://fixture" },
    createProvider(options) { return { name: "pi", async health() { return { available: true, sandboxed: false, error: null }; }, start() { throw new Error("No conversation expected"); },
      complete: createPiCompletion({ ...options, launch(input) {
        const child = launchPiProcess(input);
        if (input.args.includes("--version")) return child;
        launches++; actualClosed = child.closed;
        return { ...child, closed: child.closed.then(async value => { await closure; return value; }) };
      } }),
    }; }, async call() { return {}; },
  });
  await application.activate();
  const settings = await application.handle("configure", { view: true }, { kind: "owner" }, "view") as { revision: string };
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    requests.push(event.trigger.id);
    const result = await application.handle(event.trigger.id, event.trigger.args, { kind: "kernel" });
    if (lostReceipt && event.trigger.id === "complete") throw new CallError("unknown", "Acceptance response lost");
    return { result };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  cleanups.push(async () => { acceptClosure(); await application.stop().catch(() => {}); await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true }); });
  const backend = await db.module.create({ data: { workspaceId, name: "pi", status: "active", activeHash: "pi-v1" } });
  await db.moduleVersion.create({ data: { moduleId: backend.id, hash: backend.activeHash!, manifest: moduleManifestSchema.parse(manifest()), source: "user", status: "approved", intent: {}, report: {} } });
  const declaration: AgentProviderRegistration = { ...REGISTRATION, configuration: { ...REGISTRATION.configuration!, revision: settings.revision } };
  await registerAgentProvider(ports, workspaceId, { kind: "module", module: "pi", moduleId: backend.id, hash: backend.activeHash! }, declaration);
  const callerModule = await db.module.create({ data: { workspaceId, name: "completion-caller", status: "active", activeHash: "caller-v1" } });
  await db.moduleVersion.create({ data: { moduleId: callerModule.id, hash: callerModule.activeHash!, manifest: moduleManifestSchema.parse({ name: callerModule.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["agent.run", "agent.stop", "agent.read"], model: { tier: "any", maxCalls: 2, maxOutputTokens: 20 } }), source: "user", status: "approved", intent: {}, report: {} } });
  const caller = { kind: "module" as const, module: callerModule.name, moduleId: callerModule.id, hash: callerModule.activeHash! };
  const invoke = (name: string, args: Record<string, unknown>, key = name) => agent.handle({ ports, workspaceId, caller, call: { id: key, key }, run: { eventKey: "execution:completion" } }, name, args);
  const admitted = await invoke("run", { kind: "completion", prompt: "private prompt", providerOptions: { maxOutputTokens: 10 } }, "admit") as { runId: string };
  const claimed = await createRuns(ports, workspaceId).claimNext("background"), row = await db.run.findUniqueOrThrow({ where: { id: admitted.runId } });
  expect(claimed?.runId).toBe(row.id);
  const input: ProviderRunInput = { runId: row.id, token: claimed!.token, lane: "background", cwd: row.cwd, sessionDir: join(dataDir, "sessions"), sessionId: null, prompt: row.prompt, systemPrompt: "system", resources: "configured", deadline: row.deadlineAt };
  async function launched() {
    for (let count = 0; count < 400; count++) {
      // spawn() can return before the fake process writes the record asserted after cancellation.
      if (actualClosed && await Bun.file(processRecord).exists() && Bun.file(processRecord).size > 0) return;
      await Bun.sleep(5);
    }
    throw new Error("Fake completion failed to launch");
  }
  return { ports, db, workspaceId, input, application, requests, invoke, launched, acceptClosure, rejectClosure, actualClosed: async () => { await launched(); await actualClosed; }, launches: () => launches, processRecord };
}

test("kernel completion waits for actual closure and durable result, reconciles lost acceptance without replay, then settles budget once", async () => {
  const f = await fixture("ok", true), handle = await startLocalProvider(f.ports, f.workspaceId, f.input);
  let settled = false, settledError: unknown; void handle.done.then(() => { settled = true; }, error => { settled = true; settledError = error; });
  await f.actualClosed(); await Bun.sleep(150);
  expect(settledError).toBeUndefined(); expect(settled).toBe(false);
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending", outputTokens: null });
  expect(await f.db.runEvent.count({ where: { runId: f.input.runId, kind: "completion" } })).toBe(0);
  expect(await f.application.handle("status", { operationId: f.input.runId }, { kind: "kernel" })).toMatchObject({ outcome: null, failure: false });
  f.acceptClosure(); expect(await handle.done).toMatchObject({ outcome: "finished" });
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "executed", inputTokens: 2, outputTokens: 3 });
  expect(await f.db.runEvent.count({ where: { runId: f.input.runId, kind: "completion" } })).toBe(1);
  expect(f.requests.filter(name => name === "complete")).toHaveLength(1); expect(f.launches()).toBe(1);
  await expect(startLocalProvider(f.ports, f.workspaceId, f.input)).rejects.toMatchObject({ code: "unknown" });
  const record = JSON.parse(await readFile(f.processRecord, "utf8")); expect(await stat(record.cwd).catch(() => null)).toBeNull();
}, 10000);

test("kernel stop remains unconfirmed while completion closure is pending, then records actual closure and failed budget", async () => {
  const f = await fixture("hang"), handle = await startLocalProvider(f.ports, f.workspaceId, f.input);
  await f.launched();
  expect(await f.invoke("stop", { runId: f.input.runId }, "stop-pending")).toMatchObject({ active: true, stopConfirmed: false });
  await f.actualClosed();
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending" });
  await expect(f.application.handle("release", { operationId: f.input.runId }, { kind: "kernel" })).rejects.toMatchObject({ code: "conflict" });
  f.acceptClosure(); expect(await handle.done).toMatchObject({ outcome: "failed", error: "Pi completion was stopped" });
  expect(await f.invoke("stop", { runId: f.input.runId }, "stop-confirmed")).toMatchObject({ active: false, stopConfirmed: true });
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "failed" });
  expect(f.launches()).toBe(1);
}, 10000);

test("unknown completion closure propagates unknown and retains budget, stop capacity and operation identity", async () => {
  const f = await fixture("hang"), handle = await startLocalProvider(f.ports, f.workspaceId, f.input);
  await f.launched(); await handle.abort(); await f.actualClosed(); f.rejectClosure(new Error("private closure uncertainty"));
  await expect(handle.done).rejects.toMatchObject({ code: "unknown" });
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending", outputTokens: null });
  expect(await f.application.handle("status", { operationId: f.input.runId }, { kind: "kernel" })).toMatchObject({ failure: true, outcome: null });
  await expect(f.application.handle("release", { operationId: f.input.runId }, { kind: "kernel" })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.invoke("stop", { runId: f.input.runId }, "stop-unknown")).toMatchObject({ active: true, stopConfirmed: false });
  await expect(startLocalProvider(f.ports, f.workspaceId, f.input)).rejects.toThrow();
  expect(f.launches()).toBe(1); expect(f.requests).not.toContain("release");
  const record = JSON.parse(await readFile(f.processRecord, "utf8")); cleanups.push(() => rm(record.cwd, { recursive: true, force: true }));
  expect((await stat(record.cwd)).isDirectory()).toBe(true);
}, 10000);

test("completion deadline requests stop and waits for closure before settling timeout", async () => {
  const f = await fixture("hang");
  const handle = await startLocalProvider(f.ports, f.workspaceId, { ...f.input, deadline: new Date(Date.now() + 700) });
  await f.actualClosed();
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending" });
  f.acceptClosure(); expect(await handle.done).toMatchObject({ outcome: "timed_out" });
  expect(f.requests).toContain("abort");
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "failed" }); expect(f.launches()).toBe(1);
}, 10000);
