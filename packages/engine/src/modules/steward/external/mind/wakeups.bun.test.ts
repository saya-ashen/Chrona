import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MindStore } from "./store";
import { MindWakeups, REVIEW_TIMER } from "./wakeups";
import { MindRuntime } from "./runtime";
import type { Call } from "./types";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mind-wake-")); roots.push(root);
  const store = new MindStore(root);
  let timer: { id: string; revision: string; status: string; schedule: unknown } | undefined;
  const writes: string[] = [];
  let revision = 0;
  const call: Call = async (target, args) => {
    if (target === "timers.list") return { items: timer ? [timer] : [], nextCursor: null };
    writes.push(target);
    if (target === "timers.set") timer = { id: REVIEW_TIMER, revision: String(++revision), status: "active", schedule: args.schedule };
    else if (target === "timers.cancel" && timer) timer.status = "cancelled";
    else throw new Error(`Unexpected call ${target}`);
    return timer;
  };
  return { root, store, call, writes, get timer() { return timer; } };
}
test("enable, restart, pause and resume reconcile one durable timer", async () => {
  const f = await fixture();
  const wake = new MindWakeups(f.store, f.call);
  await wake.sync(); expect(f.writes).toEqual([]);
  await f.store.update(s => { s.settings.enabled = true; });
  await Promise.all([wake.sync(), wake.sync()]);
  expect(f.writes).toEqual(["timers.set"]);
  await new MindWakeups(new MindStore(f.root), f.call).sync();
  expect(f.writes).toHaveLength(1);
  await f.store.update(s => { s.settings.enabled = false; }); await wake.sync();
  expect(f.timer?.status).toBe("cancelled");
  await f.store.update(s => { s.settings.enabled = true; }); await wake.sync(true);
  expect(f.timer?.revision).toBe("2");
});
test("unknown delivery blocks automatic rearming and records a durable recovery explanation", async () => {
  const f = await fixture(); const wake = new MindWakeups(f.store, f.call);
  await f.store.update(s => { s.settings.enabled = true; }); await wake.sync();
  f.timer!.status = "unknown";
  await expect(new MindWakeups(new MindStore(f.root), f.call).sync()).rejects.toThrow("未确认");
  expect(f.writes).toHaveLength(1);
  expect((await f.store.read()).runtime.wakeError).toContain("不会重放");
  await wake.sync(true); expect(f.timer?.revision).toBe("2");
  expect((await f.store.read()).runtime.wakeError).toBeNull();
});
test("receipt polling cannot initiate work even when automatic checks are enabled", async () => {
  const f = await fixture();
  await f.store.update(s => { s.settings.enabled = true; });
  const runtime = new MindRuntime(f.store, async target => { throw new Error(`Unexpected effect ${target}`); });
  await runtime.tick("2026-11-11T12:00:00.000Z", false, true);
  expect((await f.store.read()).decisions).toHaveLength(0);
  expect((await f.store.read()).runtime.lastCheckAt).toBeNull();
});
test("stale application binding is replaced once and lost set replies reconcile from the durable timer", async () => {
  const f = await fixture();
  await f.store.update(s => { s.settings.enabled = true; });
  let lost = true;
  const call: Call = async (target, args, options) => {
    const result = await f.call(target, args, options);
    if (target === "timers.set" && lost) { lost = false; throw new Error("reply lost"); }
    return result;
  };
  await expect(new MindWakeups(f.store, call).sync()).rejects.toThrow("reply lost");
  await new MindWakeups(new MindStore(f.root), call).sync();
  expect(f.writes).toEqual(["timers.set"]);
  f.timer!.status = "stale";
  const wake = new MindWakeups(f.store, call);
  await wake.sync(); await wake.sync();
  expect(f.writes).toEqual(["timers.set", "timers.set"]);
});
