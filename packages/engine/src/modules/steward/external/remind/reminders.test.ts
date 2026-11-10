import { Database } from "bun:sqlite";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Reminders } from "./reminders";
import { nextOccurrence, scheduleRuleSchema } from "./rules";

export async function runOfflineChecks() {
  for (const [rule, after, zone, expected] of [
    [{ kind: "daily", time: "08:00" }, "2026-11-10T00:00:00Z", "Asia/Shanghai", "2026-11-11T00:00:00.000Z"],
    [{ kind: "weekly", days: [3], time: "08:00" }, "2026-11-10T00:00:00Z", "Asia/Shanghai", "2026-11-11T00:00:00.000Z"],
    [{ kind: "daily", time: "02:30" }, "2026-03-08T06:59:00Z", "America/New_York", "2026-03-09T06:30:00.000Z"],
    [{ kind: "every", minutes: 5 }, "2026-11-10T00:00:00Z", "UTC", "2026-11-10T00:05:00.000Z"],
  ] as const) assert.equal(nextOccurrence(scheduleRuleSchema.parse(rule), new Date(after), zone)?.toISOString(), expected);
  const directory = await mkdtemp(join(tmpdir(), "chrona-remind-offline-")), deliveries: unknown[] = [];
  let fail = false, malformed = false;
  const send = async (args: { key: string }) => { deliveries.push(args); if (fail) throw new Error("lost response"); return malformed ? undefined : { id: args.key, status: "queued", duplicate: false }; };
  let store = new Reminders(directory, send);
  const now = new Date("2026-11-10T00:00:00Z"), due = new Date("2026-11-10T00:05:00Z");
  const input = { rule: JSON.stringify({ kind: "at", at: due.toISOString() }), text: "喝水", label: "喝水", timezone: "UTC" };
  try {
    const created = store.create(input, now);
    assert.deepEqual(store.create(input, now), created);
    await Promise.all([store.tick(due), store.tick(due)]);
    assert.equal(deliveries.length, 1);
    assert.equal(store.list().reminders[0]?.status, "finished");
    assert.equal(store.create(input, due).status, "finished");
    await store.close();
    store = new Reminders(directory, send);
    await store.tick(due); assert.equal(deliveries.length, 1);
    const repeat = store.create({ ...input, rule: JSON.stringify({ kind: "every", minutes: 5 }), label: "休息" }, now);
    fail = true;
    await assert.rejects(store.tick(due), /lost response/);
    await store.close();
    fail = false; store = new Reminders(directory, send);
    await store.tick(new Date("2026-11-11T00:00:00Z"));
    assert.equal(deliveries.length, 2);
    assert.equal(store.list().reminders.find(row => row.key === repeat.key)?.status, "unknown");
    assert.deepEqual(store.cancel({ key: repeat.key }), { cancelled: true });
    assert.deepEqual(store.cancel({ key: repeat.key }), { cancelled: false });
    const cancelled = store.create({ ...input, label: "取消" }, now);
    store.cancel({ key: cancelled.key }); await store.tick(due); assert.equal(deliveries.length, 2);
    for (const bad of [{ ...input, rule: "{}" }, { ...input, timezone: "missing-zone" }, { ...input, until: now.toISOString() }, { ...input, text: "" }]) assert.throws(() => store.create(bad, now));
    assert.throws(() => store.create({ ...input, label: "已经过去" }, due));
    const periodic = store.create({ ...input, rule: JSON.stringify({ kind: "every", minutes: 5 }), label: "正常周期" }, now);
    await store.tick(due); await store.tick(due);
    assert.equal(store.list().reminders.find(row => row.key === periodic.key)?.nextAt, "2026-11-10T00:10:00.000Z");
    store.cancel({ key: periodic.key });
    const invalidReceipt = store.create({ ...input, label: "异常回执" }, now);
    malformed = true; await assert.rejects(store.tick(due));
    assert.equal(store.list().reminders.find(row => row.key === invalidReceipt.key)?.status, "unknown");
    const count = deliveries.length; await store.close();
    store = new Reminders(directory, send); await store.tick(due); assert.equal(deliveries.length, count);

  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
  const concurrentDir = await mkdtemp(join(tmpdir(), "chrona-remind-cancel-"));
  let started!: () => void, release!: () => void;
  const sending = new Promise<void>(resolve => { started = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const concurrent = new Reminders(concurrentDir, async () => { started(); await released; return { id: "notify-1", status: "queued", duplicate: false }; });
  try {
    const timer = concurrent.create({ ...input, rule: JSON.stringify({ kind: "every", minutes: 5 }) }, now);
    const tick = concurrent.tick(due);
    await sending; concurrent.cancel({ key: timer.key }); release(); await tick;
    assert.deepEqual(concurrent.list(), { reminders: [] });
    concurrent.create({ ...input, label: "损坏记录" }, now);
    const damaged = new Database(join(concurrentDir, "reminders.sqlite"));
    damaged.query("UPDATE reminders SET rule = '{}' WHERE status = 'active'").run(); damaged.close();
    assert.throws(() => concurrent.list());
  } finally { release(); await concurrent.close(); await rm(concurrentDir, { recursive: true, force: true }); }

}
