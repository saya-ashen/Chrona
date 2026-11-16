import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { openStore } from "./applications/notify/store";
import { createNotify } from "./applications/notify/notify";
import { ingestKernelFacts } from "./applications/notify/facts";
import { testDb } from "./test-db";
import { acknowledgeKernelFacts, readKernelFacts, recordApprovalFact, recordWithdrawal, seedFactConsumer, selectFactConsumer, withdrawnKernelKeys } from "./notification-facts";

type Fact = { id: string; at: string; type: string; data: Record<string, unknown> };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const dir = await mkdtemp("/tmp/chrona-fact-ingestion-"), store = openStore(dir), now = new Date("2026-11-08T12:00:00Z");
  cleanups.push(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const create = () => createNotify({ store, publicUrl: null, listModules: async () => [], describeTools: async () => [], call: async () => { throw new Error("No external channel"); }, status: async () => { throw new Error("No pending delivery"); } });
  return { store, now, create, notify: create() };
}
test("notification preferences persist privately and reject malformed changes without publishing facts", async () => {
  const { store, notify, now, create } = await fixture(), caller = { kind: "owner" as const, via: null };
  const settings = { dailyCap: 8, timezone: "UTC", digestAt: "18:30", quietHours: null };
  expect(notify.handle("settings", { settings: JSON.stringify(settings) }, caller, now)).toEqual({ settings });
  expect(create().handle("settings", {}, caller, now)).toEqual({ settings });
  for (const value of ["{", JSON.stringify({ ...settings, timezone: "invalid/zone" }), JSON.stringify({ ...settings, dailyCap: -1 }), JSON.stringify({ ...settings, quietHours: { start: "25:00", end: "08:00" } }), JSON.stringify({ ...settings, arbitrary: true })]) {
    expect(notify.handle("settings", { settings: value }, caller, now)).toMatchObject({ error: "invalid" });
    expect(store.settings()).toEqual(settings);
  }
  expect(store.rows("SELECT * FROM notifications")).toEqual([]);
});
function notice(id: string, key = id): Fact { return { id, at: "2026-11-08T12:00:00Z", type: "lifecycle", data: { key, fact: { kind: "module-paused", app: key } } }; }
test("Notify renders structural runtime facts and chooses alert and activation policy locally", async () => {
  const { store, notify, now } = await fixture();
  notify.handle("settings", { settings: JSON.stringify({ dailyCap: 0, timezone: "UTC", digestAt: "18:00", quietHours: null }) }, { kind: "owner", via: null }, now);
  const facts: Fact[] = [
    { id: "input", at: now.toISOString(), type: "notice", data: { key: "provider:run-a", kind: "provider-input-required", run: "run-a", session: "session-a" } },
    { id: "activation", at: now.toISOString(), type: "lifecycle", data: { key: "activation", module: "module-a", fact: { kind: "module-activated", app: "app-a", update: true, hash: "hash-a" } } },
  ];
  let accepted = false;
  expect(await ingestKernelFacts(store, notify, async (target, args) => {
    if (target === "activity.facts") return { revision: "r", facts: accepted ? [] : facts };
    if (target === "activity.withdrawals") return { withdrawn: [] };
    accepted = true; return { acknowledged: args.ids };
  }, now)).toBe(true);
  expect(store.byKey("provider:run-a")).toMatchObject({ title: "处理需要你的输入", level: "now", status: "queued", session_id: "session-a" });
  expect(store.byKey("provider:run-a")?.body).toContain("run-a");
  expect(store.byKey("activation")).toMatchObject({ title: "应用 app-a 已自动更新", level: "digest", status: "folded" });
  expect(store.byKey("activation")?.body).toContain("hash-a");
  expect(store.get("kernel-facts:staged")).toBeNull();
});
test("lost ACK reply retains private staging and recovery never duplicates delivery", async () => {
  const { store, notify, now, create } = await fixture(), fact = notice("one");
  let consumed = false, loseReply = true;
  const call = async (target: string) => {
    if (target === "activity.facts") return { revision: "r1", facts: consumed ? [] : [fact] };
    if (target === "activity.withdrawals") return { withdrawn: [] };
    consumed = true;
    if (loseReply) { loseReply = false; throw new Error("ACK reply lost"); }
    return { acknowledged: [fact.id] };
  };
  await expect(ingestKernelFacts(store, notify, call, now)).rejects.toThrow("ACK reply lost");
  expect(store.byKey("one")).toMatchObject({ status: "queued", attempts: 0 });
  expect(store.get("kernel-facts:staged")).not.toBeNull();
  // Rebuild application runtime against the same durable private store.
  const recovered = create();
  expect(await ingestKernelFacts(store, recovered, call, now)).toBe(true);
  await recovered.tick(now);
  expect(store.byKey("one")).toMatchObject({ status: "sent", attempts: 1 });
  expect(await ingestKernelFacts(store, recovered, call, now)).toBe(true);
  await recovered.tick(now);
  expect(store.rows("SELECT * FROM notifications")).toHaveLength(1);
  expect(store.byKey("one")?.attempts).toBe(1);
});
test("a different consumer accepting a staged fact suppresses it when this app resumes", async () => {
  const { store, notify, now } = await fixture(), fact = notice("old");
  await expect(ingestKernelFacts(store, notify, async target => {
    if (target === "activity.facts") return { revision: "old", facts: [fact] };
    throw new Error("paused before ACK");
  }, now)).rejects.toThrow("paused before ACK");
  expect(await ingestKernelFacts(store, notify, async target => target === "activity.facts" ? { revision: "new", facts: [] } : { acknowledged: [] }, now)).toBe(true);
  await notify.tick(now);
  expect(store.byKey("old")).toMatchObject({ status: "suppressed", attempts: 0 });
});
test("withdrawal on a later page wins before delivery; late approvals cannot revive its tombstone", async () => {
  const { store, notify, now } = await fixture();
  const approval: Fact = { id: "approval", at: now.toISOString(), type: "approval", data: { approval: "a", title: "批准", action: "activate_module", detail: "详情", preview: "预览" } };
  const withdrawal: Fact = { id: "withdrawal", at: now.toISOString(), type: "withdraw", data: { key: "approval:a" } };
  const pages = [[approval], [withdrawal], [approval], []];
  expect(await ingestKernelFacts(store, notify, async (target, args) => target === "activity.facts" ? { revision: "r", facts: pages.shift()! } : { acknowledged: args.ids }, now)).toBe(true);
  await notify.tick(now);
  expect(store.byKey("approval:a")).toMatchObject({ status: "suppressed", attempts: 0 });
  expect(store.rows("SELECT * FROM notifications")).toHaveLength(1);
});
test("a backlog pass is bounded and does not deliver while unread pages may contain withdrawals", async () => {
  const { store, notify, now } = await fixture(); let n = 0;
  expect(await ingestKernelFacts(store, notify, async (target, args) => target === "activity.facts" ? { revision: "r", facts: [notice(`n${n++}`)] } : { acknowledged: args.ids }, now)).toBe(false);
  expect(n).toBe(10);
  expect(store.rows("SELECT * FROM notifications WHERE attempts > 0")).toEqual([]);
});
for (const late of [false, true]) test(`consumed withdrawal survives switching back to an app with ${late ? "a late" : "an acknowledged queued"} approval`, async () => {
  const first = await fixture(), second = await fixture(), db = testDb(), now = first.now;
  cleanups.push(() => db.$disconnect());
  const workspaceId = (await db.workspace.create({ data: { name: "switch" } })).id;
  const app = async (name: string) => {
    const row = await db.module.create({ data: { workspaceId, name, activeHash: `${name}-hash` } });
    return { kind: "module" as const, module: name, moduleId: row.id, hash: row.activeHash! };
  };
  const a = await app("first"), b = await app("second");
  const call = (caller: typeof a) => async (target: string, args: Record<string, unknown>) => {
    if (target === "activity.facts") return readKernelFacts(db, workspaceId, caller);
    if (target === "activity.withdrawals") return withdrawnKernelKeys(db, workspaceId, caller, String(args.revision), args.keys as string[]);
    return acknowledgeKernelFacts(db, workspaceId, caller, String(args.revision), args.ids as string[]);
  };
  const approval = () => recordApprovalFact(db, { workspaceId, id: "a", title: "批准", action: "activate_module", detail: "详情", preview: "预览", moduleId: null, createdAt: now });
  await seedFactConsumer(db, workspaceId, a.moduleId, now);
  if (!late) {
    await approval();
    expect(await ingestKernelFacts(first.store, first.notify, call(a), now)).toBe(true);
    expect(first.store.byKey("approval:a")?.attempts).toBe(0);
  }
  await db.module.update({ where: { id: a.moduleId }, data: { status: "paused" } });
  await selectFactConsumer(db, workspaceId, b.moduleId, now);
  await recordWithdrawal(db, workspaceId, "approval:a", now);
  expect(await ingestKernelFacts(second.store, second.notify, call(b), now)).toBe(true);
  await db.module.update({ where: { id: b.moduleId }, data: { status: "paused" } });
  await db.module.update({ where: { id: a.moduleId }, data: { status: "active" } });
  await selectFactConsumer(db, workspaceId, a.moduleId, now);
  if (late) await approval();
  expect(await ingestKernelFacts(first.store, first.notify, call(a), now)).toBe(true);
  await first.notify.tick(now);
  expect(first.store.byKey("approval:a")).toMatchObject({ status: "suppressed", attempts: 0 });
  expect((await readKernelFacts(db, workspaceId, a)).facts).toEqual([]);
});
for (const recovery of ["2026-11-08T23:00:00Z", "2026-11-09T12:00:00Z"]) test(`backlog budgets use recovery time ${recovery}, not source time`, async () => {
  const { store, notify, now } = await fixture(), fact = notice("backlog");
  notify.handle("configure", { "daily-cap": 1, timezone: "UTC", "digest-at": "18:00", "quiet-start": "22:00", "quiet-end": "08:00", at: now.toISOString() }, { kind: "kernel" }, now);
  const recovered = new Date(recovery);
  notify.handle("send", { key: "already-today", title: "已用限额", body: "正文", level: "now" }, { kind: "kernel" }, recovered);
  let accepted = false;
  expect(await ingestKernelFacts(store, notify, async (target, args) => {
    if (target === "activity.facts") return { revision: "r", facts: accepted ? [] : [fact] };
    if (target === "activity.withdrawals") return { withdrawn: [] };
    accepted = true; return { acknowledged: args.ids };
  }, recovered)).toBe(true);
  expect(store.byKey("backlog")).toMatchObject({ status: "folded", created_at: recovered.getTime(), attempts: 0 });
});
