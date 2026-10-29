import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import { handleModuleCall } from "./module-effects";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleSandbox } from "./module-test-process";
import { MODULE_SCHEDULE_LIMIT } from "./schedules";
import { testDb } from "./test-db";
import { notice } from "./test-notices";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const now = new Date("2026-10-29T04:00:00Z");
const TIMERS = ["schedules.create", "schedules.cancel", "schedules.mine"];

/** v2-24: modules with their own timers; the fake sandbox notifies the payload's text when a schedule event arrives. */
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-timers-"));
  const workspace = await db.workspace.create({ data: { name: "timers" } }), w = workspace.id;
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null,
    sandbox: { available: true, isolated: true, async runModule(input) {
      const payload = (input.input as { trigger?: { payload?: { text?: string } } }).trigger?.payload;
      return { status: "succeeded", exitCode: 0, error: null, output: JSON.stringify({ effects: payload ? [{ type: "notify_user", key: "timer", level: "now", title: "日历", body: payload.text }] : [] }) };
    } } };
  ports.sandbox!.startModule = testModuleSandbox(input => ports.sandbox!.runModule!(input)).startModule;
  const api = createStewardService(ports).forWorkspace(w);
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  async function app(name: string, uses: string[], hash = `${name}-1`) {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], uses: ["notify.send", ...uses], tools: [{ name: "noop", description: "Fixture", parameters: { type: "object", properties: {}, required: [] } }], data: { schema: 1 } });
    const existing = await db.module.findFirst({ where: { workspaceId: w, name } });
    const module = existing ?? await db.module.create({ data: { workspaceId: w, name, status: "active" } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "test", intent: {}, report: {}, status: "approved" } });
    if (!existing) await db.module.update({ where: { id: module.id }, data: { activeHash: hash } });
    const call = async (target: string, args: Record<string, unknown>) => {
      const reply = await handleModuleCall(ports, { workspaceId: w, moduleId: module.id, hash, manifest }, { id: "test", method: "call", params: { target, args: args as never, mode: "sync", reply: false } });
      if ("error" in reply) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
      return (reply.result as { output: unknown }).output;
    };
    return { module, hash, call };
  }
  return { db, ports, w, api, app };
}
const timer = (key: string, text: string, at = now.toISOString()) => ({ key, rule: JSON.stringify({ kind: "at", at }), payload: JSON.stringify({ text }), label: text });

test("a module arranges, replaces, lists and cancels its own timers; each fires back to it with the payload", async () => {
  const f = await fixture();
  const calendar = await f.app("calendar", TIMERS);
  const later = new Date(now.getTime() + 3_600_000).toISOString();
  expect(await calendar.call("schedules.create", timer("evt-1:10m", "开会", later))).toMatchObject({ mode: "module", moduleId: calendar.module.id, createdBy: "module", label: "开会", nextAt: later });
  // The same key replaces the timer instead of adding one.
  await calendar.call("schedules.create", timer("evt-1:10m", "改期的会"));
  expect(await calendar.call("schedules.mine", {})).toMatchObject([{ key: "evt-1:10m", payload: { text: "改期的会" }, nextAt: now.toISOString() }]);
  expect(await f.api.schedules.fireDue()).toBe(1);
  expect(await f.api.schedules.fireDue()).toBe(0);
  expect(await notice(f.db, { moduleId: calendar.module.id })).toMatchObject({ title: "日历", body: "改期的会" });
  await calendar.call("schedules.create", timer("evt-2", "取消的事", later));
  expect(await calendar.call("schedules.cancel", { key: "evt-2" })).toEqual({ cancelled: true });
  expect(await calendar.call("schedules.cancel", { key: "evt-2" })).toEqual({ cancelled: false });
  expect(await calendar.call("schedules.mine", {})).toEqual([]);
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "schedule_created" } })).toMatchObject({ actorKey: "module:calendar" });
});

test("timers stay the module's own: undeclared callers are refused, keys are per module, bad input is invalid", async () => {
  const f = await fixture();
  const calendar = await f.app("calendar", TIMERS), other = await f.app("other", TIMERS), plain = await f.app("plain", []);
  await calendar.call("schedules.create", timer("shared", "calendar's"));
  await expect(plain.call("schedules.create", timer("x", "nope"))).rejects.toMatchObject({ code: "undeclared" });
  expect(await other.call("schedules.cancel", { key: "shared" })).toEqual({ cancelled: false });
  await other.call("schedules.create", timer("shared", "other's"));
  expect(await calendar.call("schedules.mine", {})).toMatchObject([{ payload: { text: "calendar's" } }]);
  expect(await f.db.schedule.count({ where: { status: "active" } })).toBe(2);
  await expect(calendar.call("schedules.create", { ...timer("big", "x"), payload: JSON.stringify({ text: "x".repeat(4001) }) })).rejects.toMatchObject({ code: "invalid" });
  await expect(calendar.call("schedules.create", { ...timer("bad", "x"), rule: "{" })).rejects.toMatchObject({ code: "invalid" });
  await expect(calendar.call("schedules.create", { ...timer("fast", "x"), rule: JSON.stringify({ kind: "every", minutes: 1 }) })).rejects.toMatchObject({ code: "invalid" });
  await expect(calendar.call("schedules.create", timer("../bad", "x"))).rejects.toMatchObject({ code: "invalid" });
});

test("a module keeps at most the limit of timers; replacing an existing key still works at the limit", async () => {
  const f = await fixture();
  const calendar = await f.app("calendar", TIMERS);
  await f.db.schedule.createMany({ data: Array.from({ length: MODULE_SCHEDULE_LIMIT }, (_, i) => ({ workspaceId: f.w, moduleId: calendar.module.id, mode: "module", text: `k${i}`, payload: { text: "t" }, rule: { kind: "at", at: "2026-11-01T00:00:00.000Z" }, label: "t", createdBy: "module", nextAt: new Date("2026-11-01T00:00:00Z") })) });
  await expect(calendar.call("schedules.create", timer("one-more", "x"))).rejects.toMatchObject({ code: "conflict" });
  expect(await calendar.call("schedules.create", timer("k0", "replaced"))).toMatchObject({ label: "replaced" });
});

test("a version that drops schedules.create ends the module's timers; one that keeps it keeps them", async () => {
  const f = await fixture();
  const calendar = await f.app("calendar", TIMERS);
  await calendar.call("schedules.create", timer("keep", "x", "2026-11-01T00:00:00.000Z"));
  await f.app("calendar", TIMERS, "calendar-2");
  await f.api.modules.activate(calendar.module.id, "calendar-2", "activate");
  expect(await f.db.schedule.findFirstOrThrow({ where: { text: "keep" } })).toMatchObject({ status: "active" });
  await f.app("calendar", [], "calendar-3");
  await f.api.modules.activate(calendar.module.id, "calendar-3", "activate");
  expect(await f.db.schedule.findFirstOrThrow({ where: { text: "keep" } })).toMatchObject({ status: "cancelled", nextAt: null });
});
