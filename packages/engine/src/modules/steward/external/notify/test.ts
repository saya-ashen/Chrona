import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule, paths } from "chrona/testing";
import { testDirectory } from "./test-directory";
import { verifyStoredData } from "./test-storage";

type Call = { id: string; method: string; params: { target?: string; mode?: string; key?: string; args?: Record<string, unknown> } };
// Continuity checks must exercise the supplied store before using isolated business fixtures.
verifyStoredData(paths.data);
const fixture = await mkdtemp(join(paths.data, "author-"));
const previousData = process.env.CHRONA_DATA;
process.env.CHRONA_DATA = fixture;
// The registered channel exposes its delivery tool to modules.
const directory = testDirectory();
let directoryUnavailable = true;
let releaseDirectory!: () => void;
const startupDirectory = new Promise<void>(resolve => { releaseDirectory = resolve; });
let startupDirectoryEntered = false;
async function listModules() {
  if (!startupDirectoryEntered) { startupDirectoryEntered = true; await startupDirectory; }
  return directoryPage(directory.modules);
}
function directoryPage(items: unknown[]) {
  if (directoryUnavailable) throw new Error("Module directory unavailable");
  return { items, nextCursor: null };
}
let module!: Awaited<ReturnType<typeof startModule>>;
const kernel = { kind: "kernel" };
// Delivery ticks use the wall clock. Events must stay due regardless of polling count or time of day.
const now = () => new Date(Date.now() - 1000).toISOString();
const tool = (id: string, args: Record<string, unknown>, caller: unknown = kernel) => module.send({ trigger: { kind: "tool", id, firedAt: now(), args, caller }, now: now(), params: {} });
// The kernel returns ascending cursor pages; the client completes them before Notify presents history.
const records = Array.from({ length: 101 }, (_, i) => ({ id: `activity-${i}`, at: new Date(Date.parse("2026-11-01T00:00:00Z") + i * 1000).toISOString(),
  kind: "module_enabled", subject: "notify-id", module: "notify", hash: null, approvalTitle: null, details: { source: "cli" } }));
const recordCalls: Record<string, unknown>[] = [];
function activityRecords(args: Record<string, unknown>) {
  recordCalls.push(args);
  assert.deepEqual(args, { limit: 100, ...(args.cursor ? { cursor: "opaque-next-records-page" } : {}) });
  return args.cursor ? { items: records.slice(100), nextCursor: null } : { items: records.slice(0, 100), nextCursor: "opaque-next-records-page" };
}
const deliveries = () => (module.calls as Call[]).filter(call => call.method === "call" && targetName(call.params.target) === "qq.deliver");
const directoryCalls = () => (module.calls as Call[]).filter(call => call.method === "call" && ["modules.list", "modules.describe"].includes(targetName(call.params.target))).length;
async function until(condition: () => boolean) { for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(condition()); }
try {
  module = await startModule("index.ts", { stubs: { "modules.list": listModules, "modules.describe": () => directoryPage(directory.tools), "activity.records": activityRecords, "activity.facts": () => ({ revision: "test", facts: [] }), "activity.withdrawals": () => ({ withdrawn: [] }) } });
  // Hold the startup directory refresh open: counts must complete independently, without another directory call.
  await until(() => startupDirectoryEntered);
  const beforeCounts = directoryCalls();
  for (let i = 0; i < 2; i++) assert.deepEqual((await tool("counts", {}, { kind: "owner" })).result.result, { queued: 0, failed: 0 });
  assert.equal(directoryCalls(), beforeCounts);
  // Full status checks the current directory on every call, including failures.
  for (let i = 0; i < 2; i++) {
    const beforeStatus = directoryCalls();
    assert.equal((await tool("status", {})).result.result.error, "unavailable");
    assert.equal(directoryCalls(), beforeStatus + 1);
  }
  const afterStatus = directoryCalls();
  assert.deepEqual((await tool("counts", {}, { kind: "owner" })).result.result, { queued: 0, failed: 0 });
  assert.equal(directoryCalls(), afterStatus);
  directoryUnavailable = false;
  releaseDirectory();
  const activity = (await tool("activity", { limit: 2 })).result.result;
  assert.deepEqual(activity.items.map((item: { id: string }) => item.id), ["activity-100", "activity-99"]);
  assert.equal(activity.items[0].text, "你在命令行恢复了 notify");
  assert.equal(activity.before, records[99]!.at);
  assert.deepEqual(recordCalls, [{ limit: 100 }, { limit: 100, cursor: "opaque-next-records-page" }]);
  const older = (await tool("activity", { before: activity.before, limit: 2 })).result.result;
  assert.deepEqual(older.items.map((item: { id: string }) => item.id), ["activity-98", "activity-97"]);
  assert.deepEqual((await tool("activity", { module: "missing" })).result.result, { items: [], before: null });
  assert.deepEqual((await tool("activity", { before: records[0]!.at })).result.result, { items: [], before: null });
  // Explicit preferences in the fixture only; existing settings and their timestamps stay untouched.
  assert.deepEqual((await tool("settings", { settings: JSON.stringify({ dailyCap: 5, quietHours: null, timezone: "UTC", digestAt: "00:00" }) })).result.result.settings,
    { dailyCap: 5, quietHours: null, timezone: "UTC", digestAt: "00:00" });
  // Without a ready chat channel a notification is recorded for the web.
  const first = await tool("send", { key: "k1", level: "now", title: "Hello", body: "World" });
  assert.equal(first.result.result.duplicate, false);
  assert.equal((await tool("send", { key: "k1", level: "now", title: "Hello", body: "World" })).result.result.duplicate, true);
  // The channel is chosen when sending: wait until it went to the web before qq registers.
  let list: { title: string; status: string; channel: string }[] = [];
  for (let i = 0; i < 200 && list[0]?.status !== "sent"; i++) { list = (await tool("list", { limit: 10 })).result.result.items; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.deepEqual(list.map(item => [item.status, item.channel]), [["sent", "in_app"]]);

  // Once qq reports ready, a send goes out as an async qq.deliver call, and its result settles the receipt.
  const qq = { kind: "module", module: "qq", moduleId: "qq-id", hash: "h" };
  assert.equal((await tool("channel", { channel: "other", tool: "missing", ready: true, at: now() }, qq)).result.result.error, "forbidden");
  assert.deepEqual((await tool("channel", { channel: "chrona_qqbot", tool: "deliver", ready: true, at: now() }, qq)).result.result, { ready: true });
  await tool("send", { key: "k2", level: "now", title: "Ping", body: "Body", responds: true });
  await until(() => deliveries().length === 1);
  const call = deliveries()[0]!;
  assert.equal(call.params.mode, "async");
  assert.equal(call.params.args!.title, "Ping");
  await module.send({ trigger: { kind: "call_result", id: "call", firedAt: now(), callId: call.id, target: "qq.deliver", key: call.params.key, status: "succeeded", output: { outcome: "accepted", receiptRef: "chrona_qq:1" } }, now: now(), params: {} });
  list = (await tool("list", {})).result.result.items;
  assert.equal(list.find(item => item.title === "Ping")!.status, "sent");
  assert.equal(list.find(item => item.title === "Ping")!.channel, "chrona_qqbot");

  // An unknown outcome is never resent.
  await tool("send", { key: "k3", level: "now", title: "Maybe", body: "Body", responds: true });
  await until(() => deliveries().length === 2);
  const second = deliveries()[1]!;
  await module.send({ trigger: { kind: "call_result", id: "call", firedAt: now(), callId: second.id, target: "qq.deliver", key: second.params.key, status: "unknown", error: "lost" }, now: now(), params: {} });
  list = (await tool("list", {})).result.result.items;
  assert.equal(list.find(item => item.title === "Maybe")!.status, "uncertain");

  // A module's key cannot collide with Chrona's; withdrawn keys stay dropped; business errors are results.
  assert.equal((await tool("send", { key: "k1", level: "digest", title: "Other", body: "Body" }, { kind: "module", module: "other", moduleId: "o", hash: "h" })).result.result.duplicate, false);
  assert.deepEqual((await tool("withdraw", { key: "gone" })).result.result, { withdrawn: true });
  assert.equal((await tool("send", { key: "gone", level: "now", title: "Late", body: "Body" })).result.result.duplicate, true);
  assert.equal((await tool("feedback", { id: "missing", feedback: "useful" })).result.result.error, "not_found");
  assert.equal((await tool("configure", { "daily-cap": 3, timezone: "Nowhere/Invalid", "digest-at": "09:00", at: now() })).result.result.error, "invalid");
  assert.equal((await tool("import", { rows: "not json" })).result.result.error, "invalid");
  const status = (await tool("status", {})).result.result;
  // Replies to the user (responds) do not count against the proactive daily budget.
  assert.deepEqual(status.chat, { channel: "chrona_qqbot", bound: true, sentToday: 0 });
  assert.deepEqual((await tool("counts", {}, { kind: "owner" })).result.result, { queued: status.queued, failed: status.failed });
} finally {
  if (module) await module.stop();
  if (previousData === undefined) delete process.env.CHRONA_DATA; else process.env.CHRONA_DATA = previousData;
  await rm(fixture, { recursive: true, force: true });
}

function targetName(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const target = raw as { moduleId: string; tool: string };
  const names: Record<string, string> = {};
  return `${names[target.moduleId] ?? target.moduleId.replace(/-id$/, "")}.${target.tool}`;
}
