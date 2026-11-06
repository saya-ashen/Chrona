import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule } from "chrona/testing";
import { testDirectory } from "./test-directory";

type Call = { id: string; method: string; params: { target?: string; mode?: string; key?: string; args?: Record<string, unknown> } };
// The registered channel exposes its delivery tool to modules.
const directory = testDirectory();
const module = await startModule("index.ts", { stubs: { "modules.list": () => directory.modules, "modules.tools": () => directory.tools } });
const kernel = { kind: "kernel" };
// A fixed daytime clock (12:00 in the default Asia/Shanghai zone): the wall clock would fall in quiet hours at night and fold.
let clock = Date.parse("2026-10-21T04:00:00.000Z");
const now = () => new Date(clock += 1000).toISOString();
const tool = (id: string, args: Record<string, unknown>, caller: unknown = kernel) => module.send({ trigger: { kind: "tool", id, firedAt: now(), args, caller }, now: now(), params: {} });
const deliveries = () => (module.calls as Call[]).filter(call => call.method === "call" && call.params.target === "qq.deliver");
async function until(condition: () => boolean) { for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(condition()); }
try {
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
} finally { await module.stop(); }
