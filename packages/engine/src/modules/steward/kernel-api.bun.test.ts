import { afterEach, expect, test } from "bun:test";
import { handleModuleCall } from "./module-effects";
import { createApprovals } from "./approvals";
import { mkdtemp, rm } from "node:fs/promises";
import { moduleCallSchema, moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { registerSystemModules } from "./system-modules";
import { callSync, enqueueCall, kernelOrigin, listSystemModules, callStatus, runDueCalls } from "./module-calls";
import { testModuleProcess } from "./module-test-process";
import { moduleSupervisor } from "./module-supervisor";
import { drainTimers } from "./timers";
import type { StewardPorts } from "./ports";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(handler?: Parameters<typeof testModuleProcess>[0]) {
  registerSystemModules();
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-api-");
  const workspace = await db.workspace.create({ data: { name: "public API" } });
  let time = Date.parse("2026-11-10T12:00:00Z");
  const received: unknown[] = [];
  const peer = testModuleProcess(async (event, call, input) => { received.push(event.trigger); return handler ? handler(event, call, input) : { result: { ok: true } }; });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(time), sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  cleanup.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  async function app(name: string, authority?: "owner") {
    const row = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: `${name}-v1` } });
    const manifest = moduleManifestSchema.parse({ name, authority, uses: ["*"], keepAlive: true, entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "observe", description: "Observe", visibility: ["modules", "owner"], parameters: { type: "object", properties: {} }, output: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } }] });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash: row.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const origin = { ...kernelOrigin(workspace.id), caller: { kind: "module" as const, module: name, moduleId: row.id, hash: row.activeHash! } };
    return { row, origin, manifest };
  }
  return { db, ports, workspace, app, received, advance: (ms: number) => { time += ms; }, owner: { ...kernelOrigin(workspace.id), caller: { kind: "owner" as const, via: null } } };
}

test("seven public namespaces expose exactly the target 42 tools; old names are rejected", async () => {
  const f = await fixture();
  expect(listSystemModules().map(row => row.name).sort()).toEqual(["activity", "agent", "approvals", "modules", "secrets", "settings", "timers"]);
  expect(listSystemModules().flatMap(row => row.tools)).toHaveLength(42);
  expect(listSystemModules().find(row => row.name === "agent")?.tools.map(tool => tool.name).sort()).toEqual(["native", "providers", "read", "register", "run", "stop", "write"]);
  for (const target of ["modules.tools", "modules.reference", "modules.diagnostics", "modules.admit-candidates", "modules.candidate-check"]) await expect(callSync(f.ports, f.owner, target, {})).rejects.toMatchObject({ code: "not_found" });
  const page = await callSync(f.ports, f.owner, "modules.list", { limit: 1 });
  expect(page.output).toMatchObject({ items: [], nextCursor: null });
});

test("wildcard dependencies grant no owner authority; approved explicit authority does", async () => {
  const f = await fixture(), ordinary = await f.app("ordinary"), entry = await f.app("entry", "owner");
  await expect(callSync(f.ports, ordinary.origin, "settings.update", { timezone: "UTC" })).rejects.toMatchObject({ code: "forbidden" });
  expect((await callSync(f.ports, entry.origin, "settings.update", { timezone: "UTC" })).output).toMatchObject({ timezone: "UTC" });
});

test("public wire requires application IDs and rejects JSON-text settings", async () => {
  expect(moduleCallSchema.safeParse({ id: "1", method: "call", params: { target: "mail.search" } }).success).toBe(false);
  expect(moduleCallSchema.safeParse({ id: "1", method: "call", params: { target: { moduleId: "mail-id", tool: "search" } } }).success).toBe(true);
  const manifest = { name: "strict-app", entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "read", description: "Read", parameters: { type: "object", properties: {} }, output: {} }] };
  expect(moduleManifestSchema.safeParse({ ...manifest, tools: [{ ...manifest.tools[0], callers: ["*"] }] }).success).toBe(false);
  const { output: _output, ...undeclared } = manifest.tools[0]!;
  expect(moduleManifestSchema.safeParse({ ...manifest, tools: [undeclared] }).success).toBe(false);
  const f = await fixture();
  await expect(callSync(f.ports, f.owner, "settings.update", { settings: '{"timezone":"UTC"}' })).rejects.toMatchObject({ code: "invalid" });
});

test("keyed synchronous calls retain their result, reject parameter drift, and can be looked up after a lost reply", async () => {
  const f = await fixture(), app = await f.app("receiver");
  const target = { moduleId: app.row.id, tool: "observe" };
  const original = await callSync(f.ports, f.owner, target, {}, { key: "one" });
  expect(await callSync(f.ports, f.owner, target, {}, { key: "one" })).toEqual(original);
  expect(f.received).toHaveLength(1);
  expect(f.received[0]).toMatchObject({ call: { key: "one" } });
  expect(await callStatus(f.ports, f.owner, { target, key: "one" })).toMatchObject({ callId: original.callId, status: "succeeded", output: { ok: true } });
  await expect(callSync(f.ports, f.owner, target, { extra: true }, { key: "one" })).rejects.toMatchObject({ code: "conflict" });
});

test("timer ownership, keyed replacement, missed-occurrence coalescing and cancellation", async () => {
  const f = await fixture(), app = await f.app("clock"), other = await f.app("other");
  const input = { id: "check", schedule: { kind: "every", milliseconds: 60_000 }, payload: { action: "inspect" } };
  const original = await callSync(f.ports, app.origin, "timers.set", input, { key: "set-1" });
  expect(await callSync(f.ports, app.origin, "timers.set", input, { key: "set-1" })).toEqual(original);
  expect((await callSync(f.ports, other.origin, "timers.list", {})).output).toMatchObject({ items: [] });
  f.advance(600_000); await drainTimers(f.ports, f.workspace.id);
  expect(f.received).toEqual([expect.objectContaining({ kind: "timer", timerId: "check", payload: { action: "inspect" }, eventId: expect.any(String) })]);
  await drainTimers(f.ports, f.workspace.id); expect(f.received).toHaveLength(1);
  await callSync(f.ports, app.origin, "timers.cancel", { id: "check" }, { key: "cancel" });
  f.advance(120_000); await drainTimers(f.ports, f.workspace.id); expect(f.received).toHaveLength(1);
});

test("timer minimum, wake budget and version drift prevent delivery", async () => {
  const f = await fixture(), app = await f.app("clock");
  await expect(callSync(f.ports, app.origin, "timers.set", { id: "fast", schedule: { kind: "every", milliseconds: 1000 } }, { key: "fast" })).rejects.toMatchObject({ code: "invalid" });
  await callSync(f.ports, app.origin, "timers.set", { id: "check", schedule: { kind: "every", milliseconds: 60_000 } }, { key: "set" });
  await callSync(f.ports, f.owner, "settings.update", { wake: { minIntervalMs: 60_000, dailyLimit: 0, moduleDailyLimit: 100 } });
  f.advance(120_000); await drainTimers(f.ports, f.workspace.id); expect(f.received).toHaveLength(0);
  await callSync(f.ports, f.owner, "settings.update", { wake: { minIntervalMs: 60_000, dailyLimit: 1000, moduleDailyLimit: 100 } });
  await f.db.module.update({ where: { id: app.row.id }, data: { activeHash: "clock-v2" } });
  await drainTimers(f.ports, f.workspace.id); expect(f.received).toHaveLength(0);
});

test("pagination is deterministic and refuses another endpoint's cursor", async () => {
  const f = await fixture(); await f.app("alpha"); await f.app("beta");
  const first = (await callSync(f.ports, f.owner, "modules.list", { limit: 1 })).output as { items: { id: string }[]; nextCursor: string };
  const second = (await callSync(f.ports, f.owner, "modules.list", { limit: 1, cursor: first.nextCursor })).output as { items: { id: string }[]; nextCursor: string | null };
  expect(first.items).toHaveLength(1); expect(second.items).toHaveLength(1);
  expect(first.items[0]!.id).not.toBe(second.items[0]!.id); expect(second.nextCursor).toBeNull();
  await expect(callSync(f.ports, f.owner, "approvals.list", { cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid" });
});

test("lifecycle writes expose fixed operations and can be reconciled by the original key", async () => {
  const f = await fixture(), app = await f.app("managed");
  const args = { moduleId: app.row.id, reason: "user paused" };
  await expect(callSync(f.ports, f.owner, "modules.disable", args)).rejects.toMatchObject({ code: "invalid" });
  const response = await callSync(f.ports, f.owner, "modules.disable", args, { key: "pause" });
  expect(response.output).toMatchObject({ moduleId: app.row.id, status: "done" });
  expect(await callSync(f.ports, f.owner, "modules.disable", args, { key: "pause" })).toEqual(response);
  expect((await callSync(f.ports, f.owner, "modules.operation", { moduleId: app.row.id, action: "disable", key: "pause" })).output).toEqual(response.output);
  await expect(callSync(f.ports, f.owner, "modules.disable", { ...args, reason: "different" }, { key: "pause" })).rejects.toMatchObject({ code: "conflict" });
});

test("same-name reinstall cannot inherit the old target's call receipt", async () => {
  const f = await fixture(), app = await f.app("receiver");
  const original = await callSync(f.ports, f.owner, { moduleId: app.row.id, tool: "observe" }, {}, { key: "same-key" });
  await f.db.module.update({ where: { id: app.row.id }, data: { name: "retired-receiver", status: "paused" } });
  const replacement = await f.app("receiver");
  const fresh = await callSync(f.ports, f.owner, { moduleId: replacement.row.id, tool: "observe" }, {}, { key: "same-key" });
  expect(fresh.callId).not.toBe(original.callId); expect(f.received).toHaveLength(2);
  expect(await callStatus(f.ports, f.owner, { target: { moduleId: app.row.id, tool: "observe" }, key: "same-key" })).toMatchObject({ callId: original.callId });
});

test("repeating an approval decision returns the original; reversing it is a conflict", async () => {
  const f = await fixture();
  const approval = await f.db.approval.create({ data: { workspaceId: f.workspace.id, action: "modify_external", title: "Decide", detail: "", preview: "", payload: { kind: "fixture" } } });
  const args = { approval: approval.id, decision: "deny" };
  const first = await callSync(f.ports, f.owner, "approvals.resolve", args);
  expect((await callSync(f.ports, f.owner, "approvals.resolve", args)).output).toEqual(first.output);
  await expect(callSync(f.ports, f.owner, "approvals.resolve", { ...args, decision: "approve" })).rejects.toMatchObject({ code: "conflict" });
});

test("record pagination crosses the old 200-row window without dropping equal timestamps", async () => {
  const f = await fixture();
  await f.db.audit.createMany({ data: Array.from({ length: 215 }, (_, i) => ({ id: `record-${String(i).padStart(3, "0")}`, workspaceId: f.workspace.id, actorKey: "chrona", kind: "settings_updated", details: {}, createdAt: f.ports.now() })) });
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const page = (await callSync(f.ports, f.owner, "activity.records", { limit: 37, ...(cursor ? { cursor } : {}) })).output as { items: { id: string }[]; nextCursor: string | null };
    ids.push(...page.items.map(row => row.id)); cursor = page.nextCursor;
  } while (cursor);
  expect(new Set(ids).size).toBe(215); expect(ids).toHaveLength(215);
});

test("run pagination includes runs older than the old 15-row window", async () => {
  const f = await fixture();
  await f.db.run.createMany({ data: Array.from({ length: 24 }, (_, i) => ({ id: `run-${String(i).padStart(3, "0")}`, workspaceId: f.workspace.id, lane: "background", trigger: "message", status: "queued", provider: "offline", tokenHash: `token-${i}`, cwd: f.ports.dataDir, prompt: "" })) });
  const first = (await callSync(f.ports, f.owner, "activity.runs", { limit: 12 })).output as { items: { id: string }[]; nextCursor: string };
  const second = (await callSync(f.ports, f.owner, "activity.runs", { limit: 12, cursor: first.nextCursor })).output as { items: { id: string }[]; nextCursor: string | null };
  expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(24); expect(second.nextCursor).toBeNull();
});

test("interrupted timer claims become unknown before any delivery and are never replayed", async () => {
  const f = await fixture(), app = await f.app("interrupted-clock");
  await callSync(f.ports, app.origin, "timers.set", { id: "check", schedule: { kind: "every", milliseconds: 60_000 } }, { key: "set" });
  const timer = await f.db.schedule.findFirstOrThrow({ where: { moduleId: app.row.id, mode: "timer" } });
  const revision = (timer.rule as { revision: string }).revision;
  await f.db.schedule.update({ where: { id: timer.id }, data: { status: "running" } });
  await f.db.moduleInvocation.create({ data: { workspaceId: f.workspace.id, caller: "kernel", target: app.row.name, targetIdentity: app.row.id, tool: "timer", mode: "timer", status: "running", key: "lost-event", args: { timerId: timer.id, revision } } });
  await drainTimers(f.ports, f.workspace.id); f.advance(120_000); await drainTimers(f.ports, f.workspace.id);
  expect(f.received).toHaveLength(0);
  expect((await f.db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).status).toBe("unknown");
});

test("async keys bind native arguments and can be recovered by target and key before delivery", async () => {
  const f = await fixture(), app = await f.app("queued-receiver"), target = { moduleId: app.row.id, tool: "observe" };
  const input = { tx: f.db, ports: f.ports, origin: f.owner, target, raw: {} };
  const first = await enqueueCall(input, { key: "async-original" });
  expect(await enqueueCall(input, { key: "async-original" })).toMatchObject({ callId: first.callId, duplicate: true });
  await expect(enqueueCall({ ...input, raw: { changed: true } }, { key: "async-original" })).rejects.toMatchObject({ code: "conflict" });
  expect(await callStatus(f.ports, f.owner, { target, key: "async-original" })).toMatchObject({ callId: first.callId, status: "queued" });
  expect(f.received).toHaveLength(0);
});

test("a timer can cancel itself while its handler is running; its late reply cannot reactivate it", async () => {
  const f = await fixture(async (event, call) => {
    if (event.trigger.kind === "timer") await call("call", { target: "timers.cancel", args: { id: event.trigger.timerId }, key: "self-cancel" });
    return { result: { ok: true } };
  }), app = await f.app("self-cancelling-clock");
  await callSync(f.ports, app.origin, "timers.set", { id: "check", schedule: { kind: "every", milliseconds: 60_000 } }, { key: "set" });
  f.advance(60_000); await drainTimers(f.ports, f.workspace.id);
  expect((await callSync(f.ports, app.origin, "timers.list", {})).output).toMatchObject({ items: [{ id: "check", status: "cancelled", nextAt: null }] });
  f.advance(120_000); await drainTimers(f.ports, f.workspace.id); expect(f.received).toHaveLength(1);
});

test("a confirmed null result is replayable without executing the handler twice", async () => {
  const f = await fixture(async () => ({ result: null })), app = await f.app("null-receiver");
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: app.row.id, hash: app.row.activeHash! } }, data: { manifest: { ...app.manifest, tools: [{ ...app.manifest.tools[0]!, output: { type: "null" } }] } } });
  const target = { moduleId: app.row.id, tool: "observe" };
  const first = await callSync(f.ports, f.owner, target, {}, { key: "null-result" });
  expect(first.output).toBeNull(); expect(await callSync(f.ports, f.owner, target, {}, { key: "null-result" })).toEqual(first);
  expect(f.received).toHaveLength(1);
  expect(await callStatus(f.ports, f.owner, { target, key: "null-result" })).toHaveProperty("output", null);
  const sender = await f.app("null-sender");
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin: sender.origin, target, raw: {} }, { key: "async-null", reply: true });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await callStatus(f.ports, sender.origin, { callId: queued.callId })).toHaveProperty("output", null);
  expect(f.received).toContainEqual(expect.objectContaining({ kind: "call_result", callId: queued.callId, output: null }));
});

test("public errors retain a bounded recovery reason across keyed replay", async () => {
  let receiverId = "", attempts = 0;
  const replies: unknown[] = [];
  const f = await fixture(async (_event, call, input) => {
    if (input.codeDir.endsWith("expired-receiver-v1")) { attempts++; throw Object.assign(new Error("Read cursor expired"), { code: "cursor_expired" }); }
    for (let i = 0; i < 2; i++) replies.push(await call("call", { target: { moduleId: receiverId, tool: "observe" }, args: {}, key: "original-cursor" }));
    return { result: { ok: true } };
  });
  receiverId = (await f.app("expired-receiver")).row.id;
  const sender = await f.app("reason-reader");
  await callSync(f.ports, f.owner, { moduleId: sender.row.id, tool: "observe" }, {});
  expect(replies).toEqual([expect.objectContaining({ error: expect.objectContaining({ code: "conflict", reason: "cursor_expired" }) }), expect.objectContaining({ error: expect.objectContaining({ code: "conflict", reason: "cursor_expired" }) })]);
  expect(attempts).toBe(1);
});


test("a paused caller cannot replay a previously successful keyed wire call", async () => {
  const f = await fixture(), app = await f.app("revoked-entry", "owner");
  const scope = { workspaceId: f.workspace.id, moduleId: app.row.id, hash: app.row.activeHash!, manifest: app.manifest };
  const request = moduleCallSchema.parse({ id: "wire", method: "call", params: { target: "settings.update", args: { timezone: "UTC" }, key: "before-pause" } });
  expect(await handleModuleCall(f.ports, scope, request)).toHaveProperty("result");
  await f.db.module.update({ where: { id: app.row.id }, data: { status: "paused" } });
  expect(await handleModuleCall(f.ports, scope, request)).toMatchObject({ error: { code: "forbidden" } });
});

test("repeating an approved decision does not repeat its external callback", async () => {
  const f = await fixture(); let approved = 0;
  const service = createApprovals({ db: f.db, workspaceId: f.workspace.id, now: f.ports.now }, async () => { approved++; });
  const row = await service.create({ action: "modify_external", title: "One action", detail: "", preview: "", payload: { kind: "fixture" } });
  await service.resolve(row.id, { decision: "approve" });
  await service.resolve(row.id, { decision: "approve" });
  expect(approved).toBe(1);
});

test("an exhausted app's 100 due timers do not starve another app", async () => {
  const f = await fixture(), busy = await f.app("busy-clock"), other = await f.app("other-clock");
  await callSync(f.ports, f.owner, "settings.update", { wake: { moduleDailyLimit: 1 } });
  for (let i = 0; i < 100; i++) await callSync(f.ports, busy.origin, "timers.set", { id: `check-${i}`, schedule: { kind: "every", milliseconds: 60_000 } }, { key: `set-${i}` });
  await callSync(f.ports, other.origin, "timers.set", { id: "other", schedule: { kind: "at", at: new Date(f.ports.now().getTime() + 180_000).toISOString() } }, { key: "set-other" });
  f.advance(60_000); await drainTimers(f.ports, f.workspace.id);
  expect(f.received).toHaveLength(1);
  f.advance(120_000); await drainTimers(f.ports, f.workspace.id);
  expect(f.received).toHaveLength(2);
  expect(f.received[1]).toMatchObject({ kind: "timer", timerId: "other" });
});

test("private fact results are not copied into durable generic call receipts", async () => {
  const f = await fixture(), consumer = await f.app("private-fact-reader");
  await callSync(f.ports, f.owner, "activity.consumer", { moduleId: consumer.row.id });
  const first = await callSync(f.ports, consumer.origin, "activity.facts", {}, { key: "private-read" });
  expect(first.output).toHaveProperty("facts");
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: first.callId } })).toMatchObject({ output: null, args: {} });
  await expect(callSync(f.ports, consumer.origin, "activity.facts", {}, { key: "private-read" })).rejects.toMatchObject({ code: "unknown" });
});
