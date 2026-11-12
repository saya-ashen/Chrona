import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { openStore } from "./store";
import { composeDigest } from "./budget";
import { createNotify, type Caller } from "./notify";
import { testDirectory } from "./test-directory";

test.each([
  ["  Gmail 重要邮件  \r\n\r\n1. ETH AI Center", "1. ETH AI Center"],
  ["Gmail 重要邮件", ""],
  ["Gmail 重要邮件已有更新\n详情", "Gmail 重要邮件已有更新\n详情"],
  ["独立正文\n详情", "独立正文\n详情"],
])("digest removes only a repeated title line: %s", (body, expected) => {
  expect(composeDigest([{ moduleTitle: "gmail", title: "Gmail 重要邮件", body }], { dayLabel: "今日" })).toEqual({ title: "今日日报", body: `gmail\n- Gmail 重要邮件：${expected}` });
});

const kernel: Caller = { kind: "kernel" };
const owner: Caller = { kind: "module", module: "transport", moduleId: "transport-id", hash: "h" };
const at = new Date("2026-11-02T04:00:00Z");
test.each([
  { name: "empty", statuses: [], queued: 0, failed: 0 },
  { name: "queued", statuses: ["queued", "queued"], queued: 2, failed: 0 },
  { name: "sending", statuses: ["sending", "sending"], queued: 2, failed: 0 },
  { name: "failed", statuses: ["failed", "failed"], queued: 0, failed: 2 },
  { name: "uncertain", statuses: ["uncertain", "uncertain"], queued: 0, failed: 2 },
  { name: "other statuses", statuses: ["sent", "folded", "suppressed"], queued: 0, failed: 0 },
  { name: "mixed", statuses: ["queued", "sending", "failed", "uncertain", "sent", "folded", "suppressed"], queued: 2, failed: 2 },
])("counts and status use the same queue semantics: $name", async ({ statuses, queued, failed }) => {
  const dir = await mkdtemp("/tmp/chrona-notify-counts-"), store = openStore(dir);
  let directoryCalls = 0;
  const notify = createNotify({ store, publicUrl: null,
    directory: async () => { directoryCalls++; throw new Error("Directory unavailable"); },
    call: async () => { throw new Error("Counts must not dispatch"); },
    status: async () => { throw new Error("Counts must not check delivery receipts"); },
  });
  try {
    for (const [i, status] of statuses.entries()) store.insert({ key: `count-${i}`, module_id: i % 2 ? "module-id" : null,
      app: null, session_id: null, approval_id: null, scoped: i % 2, level: i % 2 ? "now" : "web", web: i % 2, responds: i % 2,
      status, title: "Count", body: "Body", recipient: null, link: null, created_at: at.getTime() - i * 86_400_000,
      channel: i % 2 ? "transport" : "in_app" });
    const before = store.rows("SELECT * FROM notifications ORDER BY key");
    for (let i = 0; i < 2; i++) expect(notify.handle("counts", {}, kernel, at)).toEqual({ queued, failed });
    expect(notify.handle("status", {}, kernel, at)).toEqual({ chat: { channel: "in_app", bound: false, sentToday: 0 }, queued, failed });
    expect(directoryCalls).toBe(0);
    expect(store.rows("SELECT * FROM notifications ORDER BY key")).toEqual(before);
    expect(store.db.query("SELECT * FROM kv").all()).toEqual([]);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("channel registration is owned, idempotent and calls only the registering module; without a ready channel notifications go to the web", async () => {
  const dir = await mkdtemp("/tmp/chrona-notify-channels-"), store = openStore(dir);
  const calls: { target: string; args: Record<string, unknown> }[] = [];
  const ports = { store, publicUrl: null, directory: async () => testDirectory("transport"), call: async (target: string, args: Record<string, unknown>) => {
    calls.push({ target, args }); return { callId: `c${calls.length}`, status: "succeeded", output: { outcome: "accepted", receiptRef: "receipt" } };
  }, status: async () => ({ callId: "unused", status: "pending" }) };
  let notify = createNotify(ports);
  await notify.refresh();
  const handle = (tool: string, args: Record<string, unknown>, caller: Caller = kernel) => notify.handle(tool, args, caller, at);
  const registration = { channel: "chrona_qqbot", tool: "deliver", ready: true, at: at.toISOString() };
  try {
    // An old readiness-only record is not a registration: the web takes it until the channel registers.
    store.set("channel:chrona_qqbot", JSON.stringify({ ready: true, at: at.getTime() }));
    handle("send", { key: "early", level: "now", title: "Early", body: "Body", responds: true });
    await notify.tick(at);
    expect(calls).toHaveLength(0);
    expect(store.byKey("early")).toMatchObject({ status: "sent", channel: "in_app" });
    expect(handle("channel", registration)).toEqual({ ignored: true });
    expect(handle("channel", { ...registration, tool: "other.deliver" }, owner)).toMatchObject({ error: "invalid" });
    expect(handle("channel", registration, owner)).toEqual({ ready: true });
    expect(handle("channel", registration, owner)).toEqual({ ready: true });
    expect(handle("channel", registration, { ...owner, module: "imposter", moduleId: "other" })).toMatchObject({ error: "forbidden" });
    expect(handle("channel", { ...registration, ready: false, at: "2026-01-01T00:00:00Z" }, owner)).toEqual({ ignored: true });
    // Durable registration survives a notify process restart, without knowing this transport's name; a legacy queued row uses it.
    handle("import", { rows: JSON.stringify([{ id: "legacy", idempotencyKey: "old", title: "Old", level: "now", status: "queued", channel: "chrona_qqbot", createdAt: at.toISOString() }]) });
    notify = createNotify(ports);
    await notify.tick(at);
    expect(calls.map(call => call.target)).toEqual(["transport.deliver"]);
    expect(store.byKey("old")).toMatchObject({ status: "sent", channel: "chrona_qqbot", attempts: 1 });
    expect(handle("status", {})).toMatchObject({ chat: { channel: "chrona_qqbot", bound: true } });
    handle("channel", { ...registration, ready: false }, owner);
    handle("send", { key: "unready", level: "now", title: "Wait", body: "Body", responds: true });
    await notify.tick(at);
    expect(calls).toHaveLength(1);
    expect(store.byKey("unready")).toMatchObject({ status: "sent", channel: "in_app" });
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
