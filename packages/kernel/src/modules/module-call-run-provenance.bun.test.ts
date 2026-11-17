import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import "./module-effects";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { moduleEventSchema, moduleManifestSchema, type AgentProviderRegistration, type ModuleEvent } from "@chrona/contracts/steward";
import type { Trigger } from "../../../app-sdk/sdk";
import { callSync, kernelOrigin, runDueCalls } from "./module-calls";
import { moduleSupervisor } from "./module-supervisor";
import { registerSystemModules } from "../system-modules";
import { testModuleProcess } from "./module-test-process";
import { testProviderManifest } from "../test-provider-process";
import { testDb } from "../test-db";
import { createRuns } from "../execution/runs";
import { createTools } from "../tools";
import type { StewardPorts } from "../ports";

type ToolTrigger = Extract<ModuleEvent["trigger"], { kind: "tool" }>;
type SdkCall = NonNullable<Extract<Trigger, { kind: "tool" }>["call"]>;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const parameters = { type: "object", properties: { executionRunId: { type: "string" }, caller: { type: "object", properties: {}, additionalProperties: true } } };
const declaration: AgentProviderRegistration = {
  id: "offline", name: "Offline provenance fixture", protocolVersion: 1,
  capabilities: { conversation: true, completion: false, native: false, images: false, interactions: false, resume: true },
  endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release" },
};

/** Real admission, token gateway, router, supervisor and wire; only application/provider handlers are fake. */
async function fixture() {
  registerSystemModules();
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-run-provenance-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const database = databases.find(row => row.name === "main")!.file;
  const workspaceId = (await db.workspace.create({ data: { name: "Run provenance" } })).id;
  const received: ToolTrigger[] = [], providerCalls: string[] = [];
  const peer = testModuleProcess(async (event, call, input) => {
    if (event.trigger.kind !== "tool") return {};
    const trigger = event.trigger;
    if (input.codeDir.endsWith("provider-v1")) {
      providerCalls.push(trigger.id);
      if (trigger.id !== "health") throw new Error(`Unexpected provider execution: ${trigger.id}`);
      return { result: { name: "offline", supportsRunModel: true, complete: false, available: true, sandboxed: false, error: null } };
    }
    if (trigger.id === "forward") return { result: await call("call", { target: "provenance-target.observe", args: z.record(z.string(), z.json()).parse(trigger.args), mode: "sync", reply: false }) };
    received.push(trigger);
    return { result: { caller: trigger.caller, call: trigger.call, args: trigger.args } };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  cleanups.push(async () => {
    await moduleSupervisor(ports).stop(); await db.$disconnect();
    await rm(dataDir, { recursive: true, force: true }); await rm(dirname(database), { recursive: true, force: true });
  });
  async function install(name: string, hash: string, manifest: unknown) {
    const module = await db.module.create({ data: { workspaceId, name, status: "active", activeHash: hash } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest: moduleManifestSchema.parse(manifest), source: "user", status: "approved", intent: {}, report: {} } });
    return { kind: "module" as const, module: name, moduleId: module.id, hash };
  }
  const provider = await install("test-provider", "provider-v1", testProviderManifest);
  const caller = await install("provenance-caller", "caller-v1", {
    name: "provenance-caller", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["agent.run", "provenance-target.observe"],
    tools: [{ name: "forward", description: "Forward untrusted arguments", visibility: ["kernel"], parameters, output: {} }],
  });
  const target = await install("provenance-target", "target-v1", {
    name: "provenance-target", entry: "index.ts", tests: ["test.ts"], effects: [],
    tools: [{ name: "observe", description: "Observe provenance", visibility: ["modules"], idempotent: true, parameters, output: {} }],
  });
  await callSync(ports, { ...kernelOrigin(workspaceId), caller: provider }, "agent.register", declaration);
  const origin = { ...kernelOrigin(workspaceId), caller };
  const runs = createRuns(ports, workspaceId), gateway = createTools(ports);
  async function start(key: string, contextId?: string) {
    const admitted = (await callSync(ports, origin, "agent.run", {
      prompt: "Offline provenance test", providerId: "offline", tools: [{ moduleId: target.moduleId, tool: "observe" }], ...(contextId ? { contextId } : {}),
    }, { key })).output as { runId: string; contextId: string };
    const run = await runs.claimNext("background");
    expect(run?.id).toBe(admitted.runId);
    return { run: run!, contextId: admitted.contextId };
  }
  const { run, contextId } = await start("original-run");
  const spoof = { executionRunId: "untrusted-argument-run", caller: provider };
  return { db, ports, workspaceId, caller, origin, run, contextId, runs, gateway, received, providerCalls, spoof, start };
}

test("selected Agent tool delivery carries its authenticated Run and original module/hash", async () => {
  const f = await fixture();
  const reply = await f.gateway.call(f.run.token, "m_provenance_target_observe", f.spoof, { timeoutSeconds: 5, key: "selected" });
  expect(f.received).toHaveLength(1);
  const event = f.received[0]!;
  expect(event).toMatchObject({ kind: "tool", id: "observe", args: f.spoof, caller: f.caller, call: { executionRunId: f.run.id, attempt: 1 } });
  expect(event.call!.executionRunId).not.toBe(f.spoof.executionRunId);
  expect(reply).toMatchObject({ result: { args: f.spoof, caller: f.caller, call: event.call } });
  const row = await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: event.call!.id } });
  expect(row).toMatchObject({ runId: f.run.id, callerModuleId: f.caller.moduleId, callerHash: f.caller.hash, status: "succeeded" });
  // Repeating the provider command returns its receipt, without changing identity or dispatching twice.
  expect(await f.gateway.call(f.run.token, "m_provenance_target_observe", f.spoof, { timeoutSeconds: 5, key: "selected" })).toEqual(reply);
  expect(f.received).toHaveLength(1);
  expect(f.providerCalls).toEqual(["health"]);
});

test("ordinary module wire calls cannot spoof Run provenance or caller through arguments", async () => {
  const f = await fixture();
  // A real Run is outstanding for this same caller. Its existence must not confer provenance.
  const args = { ...f.spoof, executionRunId: f.run.id };
  await callSync(f.ports, kernelOrigin(f.workspaceId), "provenance-caller.forward", args);
  expect(f.received).toHaveLength(1);
  expect(f.received[0]).toMatchObject({ args, caller: f.caller, call: { attempt: 1 } });
  expect(f.received[0]!.call).not.toHaveProperty("executionRunId");
  const row = await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: f.received[0]!.call!.id } });
  expect(row.runId).toBeNull();
  // Even an internal origin with a real Run ID lacks the private Agent-entry proof.
  await callSync(f.ports, { ...f.origin, run: { executionRunId: f.run.id } }, "provenance-target.observe", args);
  expect(f.received).toHaveLength(2);
  expect(f.received[1]).toMatchObject({ args, caller: f.caller });
  expect(f.received[1]!.call).not.toHaveProperty("executionRunId");
});

test("retained delivery preserves the original Run and caller after a newer Run starts", async () => {
  const f = await fixture();
  await f.gateway.call(f.run.token, "m_provenance_target_observe", f.spoof, { timeoutSeconds: 5, key: "retained" });
  const original = f.received[0]!;
  expect(original.call!.executionRunId).toBe(f.run.id);
  await f.runs.finish(f.run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "never_started" });
  const newer = await f.start("newer-run", f.contextId);
  expect(newer.run.id).not.toBe(f.run.id);
  expect(newer.run.sessionId).toBe(f.run.sessionId);
  // Stage the real identity-bound receipt as an interrupted retained delivery. The worker
  // accepts async rows; keep its original runId, caller, target binding, args and call key.
  await f.db.moduleInvocation.update({ where: { id: original.call!.id }, data: {
    mode: "async", status: "running", attempts: 1, leaseToken: "expired-provenance-delivery", leaseUntil: new Date(0), finishedAt: null,
  } });
  expect(await runDueCalls(f.ports, f.workspaceId)).toBe(1);
  const settled = await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: original.call!.id } });
  expect({ status: settled.status, error: settled.error }).toEqual({ status: "succeeded", error: null });
  expect(f.received).toHaveLength(2);
  const replay = f.received[1]!;
  expect(replay).toMatchObject({ args: original.args, caller: original.caller, call: { ...original.call, attempt: 2 } });
  expect(replay.call!.executionRunId).toBe(f.run.id);
  expect(replay.call!.executionRunId).not.toBe(newer.run.id);
  expect(settled).toMatchObject({ runId: f.run.id, callerModuleId: f.caller.moduleId, callerHash: f.caller.hash, attempts: 2, status: "succeeded" });
});

test("wire schema and SDK call type support an optional bounded executionRunId", () => {
  const call = { id: "call", key: null, attempt: 1, chain: [] } satisfies SdkCall;
  const trusted = { ...call, executionRunId: "original-run" } satisfies SdkCall;
  // Keep both writing and reading the public SDK property checked by TypeScript.
  const readRunId = (value: SdkCall): string | undefined => value.executionRunId;
  expect(readRunId(call)).toBeUndefined();
  expect(readRunId(trusted)).toBe("original-run");
  const event = { trigger: { kind: "tool", id: "observe", args: {}, call, firedAt: "2026-11-13T00:00:00Z" }, now: "2026-11-13T00:00:00Z", params: {} };
  const parse = (value: unknown) => moduleEventSchema.safeParse({ ...event, trigger: { ...event.trigger, call: value } });
  expect(parse(call).success).toBe(true);
  expect(parse(trusted)).toMatchObject({ success: true, data: { trigger: { call: trusted } } });
  expect(parse({ ...call, executionRunId: "r".repeat(128) }).success).toBe(true);
  for (const executionRunId of ["", "r".repeat(129), null, 42, {}, []]) expect(parse({ ...call, executionRunId }).success).toBe(false);
});
