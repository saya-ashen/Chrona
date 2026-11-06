import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createEvents, type Directory } from "./builtin/events/events";
import { callSync, enqueueCall, runDueCalls, type CallOrigin } from "./module-calls";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { registerSystemModules } from "./system-modules";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

/** Real routed calls and P0 persisted target binding; callback processes are offline wire peers. */
test("events consumes kernel target binding: two real callback targets, one paused, one replaced after enqueue", async () => {
  registerSystemModules();
  const db = testDb(), dataDir = await mkdtemp("/tmp/events-routed-");
  const deliveries: { name: string; payload: unknown }[] = [];
  const peer = testModuleProcess(async (event, _call, input) => {
    if (event.trigger.kind === "tool") deliveries.push({ name: input.codeDir.split("/").at(-1)!, payload: event.trigger.args });
    return { result: { received: true } };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T04:00:00Z"), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  const workspaceId = (await db.workspace.create({ data: { name: "events-routed" } })).id;
  async function module(name: string, hash: string, tools: unknown[] = [], contributes = {}) {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], triggers: [], tools, contributes, uses: ["modules.list", "modules.tools", "modules.contributions"] });
    const row = await db.module.create({ data: { workspaceId, name, activeHash: hash, builtin: name === "events" } });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash, manifest, status: "approved", source: "user", intent: {}, report: {} } });
    const code = join(dataDir, "platform/store", hash); await mkdir(code, { recursive: true }); await writeFile(join(code, "index.ts"), "// offline wire peer\n");
    return row;
  }
  const tool = { name: "receive", description: "Receive an event", visibility: ["modules"], idempotent: false,
    parameters: { type: "object", properties: { event: { type: "string" }, from: { type: "string" }, payload: { type: "string" } }, required: ["event", "from", "payload"] },
    output: { type: "object", properties: { received: { type: "boolean" } }, required: ["received"] } };
  try {
    const eventsRow = await module("events", "e".repeat(64)), source = await module("source", "c".repeat(64), [], { events: { emits: [{ name: "changed" }] } });
    const alpha = await module("alpha", "a".repeat(64), [tool]), beta = await module("beta", "b".repeat(64), [tool]);
    const origin: CallOrigin = { workspaceId, caller: { kind: "module", module: "events", moduleId: eventsRow.id, hash: eventsRow.activeHash! }, chain: [], path: [] };
    const read = async (target: string, args = {}) => (await callSync(ports, origin, target, args)).output;
    const dir = join(dataDir, "event-state"); await mkdir(dir);
    const events = createEvents({ dataDir: dir, directory: async () => ({ modules: await read("modules.list"), tools: await read("modules.tools") }) as Directory,
      contributions: async () => await read("modules.contributions", { section: "events" }) as { module: string; value: unknown }[],
      call: (target, raw, options) => enqueueCall({ tx: db, ports, origin, target, raw }, options) });
    const from = (row: typeof alpha) => ({ kind: "module" as const, module: row.name, moduleId: row.id, hash: row.activeHash! });
    for (const row of [alpha, beta, alpha]) await events.handle("subscribe", { event: "source.changed", tool: "receive" }, from(row));
    const emit = (key: string) => events.handle("emit", { event: "changed", payload: '{"id":"one"}', key }, from(source));
    expect(await emit("first")).toEqual({ delivered: 2 });
    await emit("first"); await runDueCalls(ports, workspaceId);
    expect(deliveries.map(item => item.name).sort()).toEqual([alpha.activeHash!, beta.activeHash!].sort());
    const firstCalls = await db.moduleInvocation.findMany({ where: { workspaceId, tool: "receive" } });
    expect(firstCalls).toHaveLength(2);
    const alphaCall = firstCalls.find(call => call.target === "alpha")!;
    const alphaBinding = (await db.audit.findUniqueOrThrow({ where: { id: `module-invocation-target:${alphaCall.id}` } })).details as { moduleId: string; contractHash: string };
    expect(alphaBinding.moduleId).toBe(alpha.id);
    expect((await enqueueCall({ tx: db, ports, origin, target: "alpha.receive", raw: { event: "source.changed", from: "source", payload: '{}' } }, { key: alphaCall.key!, expectedTarget: alphaBinding })).duplicate).toBe(true);
    await expect(enqueueCall({ tx: db, ports, origin, target: "alpha.receive", raw: {} }, { key: alphaCall.key!, expectedTarget: { ...alphaBinding, moduleId: beta.id } })).rejects.toThrow("different registered target");
    expect(await db.audit.count({ where: { workspaceId, kind: "module_invocation_target", id: { in: firstCalls.map(call => `module-invocation-target:${call.id}`) } } })).toBe(2);
    let rolledBackId = "";
    await expect(db.$transaction(async tx => {
      const result = await enqueueCall({ tx, ports, origin, target: "alpha.receive", raw: { event: "source.changed", from: "source", payload: '{}' } }, { key: "rollback", expectedTarget: alphaBinding });
      rolledBackId = result.callId;
      throw new Error("rollback-fixture");
    })).rejects.toThrow("rollback-fixture");
    expect(rolledBackId).not.toBe("");
    expect(await db.moduleInvocation.findUnique({ where: { id: rolledBackId } })).toBeNull();
    expect(await db.audit.findUnique({ where: { id: `module-invocation-target:${rolledBackId}` } })).toBeNull();
    expect(await db.moduleInvocation.count({ where: { workspaceId, tool: "receive" } })).toBe(2);
    await db.module.update({ where: { id: alpha.id }, data: { status: "paused" } });
    expect(await emit("paused")).toEqual({ delivered: 1 }); await runDueCalls(ports, workspaceId);
    expect(deliveries.map(item => item.name)).toHaveLength(3); expect(deliveries.at(-1)!.name).toBe(beta.activeHash!);
    await db.module.update({ where: { id: alpha.id }, data: { status: "active" } });
    expect(await emit("replace-after-enqueue")).toEqual({ delivered: 2 });
    await db.module.delete({ where: { id: alpha.id } });
    const replacement = await module("alpha", "d".repeat(64), [tool]);
    await expect(enqueueCall({ tx: db, ports, origin, target: "alpha.receive", raw: { event: "source.changed", from: "source", payload: '{}' } }, { key: "stale-registration", expectedTarget: alphaBinding })).rejects.toThrow("target");
    await runDueCalls(ports, workspaceId);
    expect(deliveries).toHaveLength(4); expect(deliveries.some(item => item.name === replacement.activeHash)).toBe(false);
    const refused = await db.moduleInvocation.findFirst({ where: { target: "alpha", status: "failed" }, orderBy: { createdAt: "desc" } });
    expect(refused?.error).toContain("target identity or contract changed");
    expect(await events.handle("subscriptions", {}, from(replacement))).toEqual({ subscriptions: [] });
    expect(await emit("after-replacement")).toEqual({ delivered: 1 }); await runDueCalls(ports, workspaceId);
    expect(deliveries).toHaveLength(5); expect(deliveries.at(-1)!.name).toBe(beta.activeHash!);
  } finally { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
}, 30_000);
