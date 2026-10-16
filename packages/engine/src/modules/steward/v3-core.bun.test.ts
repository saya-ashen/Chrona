import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { affairDetailSchema, todayViewSchema, settingsSchema, type DeliveryOutcome } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { consumeOnce } from "./grants";
let db: ReturnType<typeof testDb>;
let ports: StewardPorts;
let workspaceId: string;
let api: ReturnType<ReturnType<typeof createStewardService>["forWorkspace"]>;
let time: Date;
let sent: string[];
let outcome: DeliveryOutcome;
beforeEach(async () => {
  db = testDb(); time = new Date("2026-10-15T04:00:00Z"); sent = []; outcome = { outcome: "accepted", receiptRef: "fake" };
  workspaceId = (await db.workspace.create({ data: { name: "test" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-v2b-")), now: () => time, publicUrl: null, chat: { channel: "chrona_qqbot", bound: async () => true }, gitHealth: async () => true,
    deliveries: ["in_app", "chrona_qqbot"].map(channel => ({ channel: channel as "in_app" | "chrona_qqbot", send: async message => { sent.push(message.idempotencyKey); return outcome; } })) };
  api = createStewardService(ports).forWorkspace(workspaceId);
});
afterEach(async () => { await db.$disconnect(); });
async function affair() { return api.affairs.create({ title: "Study", request: "First paragraph.\n\nSecond paragraph." }); }
async function approval(affairId?: string, action = "send_external_message") { return api.approvals.create({ affairId, action, title: "Send draft", detail: "Send this", preview: "Hello", payload: { to: "test@example.invalid", body: "Hello" } }); }
async function notify(key: string, level: "now" | "digest" | "web" = "now", affairId?: string) { return api.notifications.enqueue({ dedupeKey: key, level, title: "Update", body: "Something changed", affairId }); }
describe("workspace affairs", () => {
  test("work prioritizes running then oldest eligible queue; detail bounds linked messages", async () => {
    const a = await affair();
    expect(a.work).toBeNull();
    expect((await api.affairs.detail(a.id)).messages).toEqual([]);
    await api.schedules.create(a.id, { mode: "wake", rule: { kind: "every", minutes: 5 }, text: "Internal instruction", label: "Visible label" });
    const deferred = await api.runs.enqueue({ affairId: a.id, lane: "background", trigger: "schedule", prompt: "Deferred" });
    await db.run.update({ where: { id: deferred.id }, data: { leaseUntil: new Date(time.getTime() + 60000) } });
    expect((await api.affairs.detail(a.id)).affair.work).toBeNull();
    const queued = await api.runs.enqueue({ affairId: a.id, lane: "background", trigger: "schedule", prompt: "Work", label: "Work label" });
    time = new Date(time.getTime() + 1000);
    await api.runs.enqueue({ affairId: a.id, lane: "background", trigger: "schedule", prompt: "Later", label: "Later label" });
    expect((await api.affairs.list())[0]!.work).toEqual({ state: "queued", since: queued.createdAt.toISOString(), label: "Work label" });
    await api.runs.claimNext("background");
    for (let i = 0; i < 105; i++) await db.message.create({ data: { workspaceId, affairId: a.id, channel: "in_app", direction: "in", conversationKey: i % 2 ? "one" : "two", text: `Message ${i}`, at: new Date(time.getTime() + i * 1000), attachments: [{ name: "x.png", path: null, mime: "image/png", size: 3, base64: "YWJj" }] } });
    await db.message.create({ data: { workspaceId, channel: "in_app", direction: "in", conversationKey: "one", text: "Unlinked", at: time } });
    const detail = affairDetailSchema.parse(await api.affairs.detail(a.id));
    expect(detail.affair.work).toEqual({ state: "running", since: time.toISOString(), label: "Work label" });
    expect(detail.affair.nextSchedule?.label).toBe("Visible label");
    expect(detail.runs.find(r => r.id === queued.id)?.label).toBe("Work label");
    expect(detail.messages.map(m => m.text)).toEqual(Array.from({ length: 100 }, (_, i) => `Message ${i + 5}`));
    expect(detail.messages[0]!.attachments[0]).not.toHaveProperty("base64");
  });
  test("README summary, bounded projection, filesystem ownership and detail", async () => {
    const a = await affair(); expect(a.summary).toBe("First paragraph.");
    const files = await api.affairs.files(a.id), readme = await files.read("README.md");
    await files.save("README.md", `# Study\n\n${"x".repeat(400)}\n\nOther`, readme.revision);
    expect((await api.affairs.list())[0]!.summary).toHaveLength(300);
    expect(affairDetailSchema.safeParse(await api.affairs.detail(a.id)).success).toBe(true);
    const other = (await db.workspace.create({ data: { name: "other" } })).id;
    await expect(createStewardService(ports).forWorkspace(other).affairs.files(a.id)).rejects.toMatchObject({ code: "not_found" });
    const row = await db.affair.findUniqueOrThrow({ where: { id: a.id } }); expect(row.dirName).toBe(a.id.replaceAll("-", ""));
  });
  for (const status of ["paused", "done"] as const) test(`${status} retains schedules but stops firing`, async () => {
    const a = await affair();
    const schedule = await db.schedule.create({ data: { workspaceId, affairId: a.id, mode: "remind", rule: { kind: "daily", time: "13:00" }, text: "Study", createdBy: "user", nextAt: new Date("2026-10-15T05:00:00Z") } });
    expect((await api.affairs.list())[0]!.nextSchedule?.mode).toBe("remind");
    expect((await api.affairs.update(a.id, { status })).nextSchedule).toBeNull();
    const retained = await db.schedule.findUniqueOrThrow({ where: { id: schedule.id } }); expect(retained.status).toBe("paused"); expect(retained.nextAt).toEqual(schedule.nextAt);
    await api.affairs.update(a.id, { status: "active" }); expect((await api.affairs.list())[0]!.nextSchedule).toBeNull();
    expect((await api.affairs.activity(a.id))).toHaveLength(2);
  });
});
describe("approval policy", () => {
  test("once grant returns private payload only on resolve, consumes atomically", async () => {
    const a = await affair(), p = await approval(a.id);
    expect(p).not.toHaveProperty("payload"); expect((await api.affairs.list())[0]!.openApprovals).toBe(1);
    const result = await api.approvals.resolve(p.id, { decision: "approve" });
    expect(result.payload).toEqual({ to: "test@example.invalid", body: "Hello" });
    expect((await api.grants.effectivePolicy("send_external_message", { affairId: a.id })).mode).toBe("preapproved");
    await db.$transaction(tx => consumeOnce(tx, workspaceId, result.grantId!, time));
    await expect(db.$transaction(tx => consumeOnce(tx, workspaceId, result.grantId!, time))).rejects.toMatchObject({ code: "conflict" });
    expect((await api.grants.effectivePolicy("send_external_message", { affairId: a.id })).mode).toBe("ask");
    await expect(api.approvals.resolve(p.id, { decision: "approve" })).rejects.toMatchObject({ code: "conflict" }); expect(sent).toEqual([]);
  });
  test("affair grant, revocation, denial, never and cross-workspace isolation", async () => {
    const a = await affair(), p = await approval(a.id);
    const result = await api.approvals.resolve(p.id, { decision: "approve", scope: "affair" });
    expect((await api.grants.list())[0]!.once).toBe(false);
    await api.grants.revoke(result.grantId!);
    expect((await api.grants.effectivePolicy("send_external_message", { affairId: a.id })).mode).toBe("ask");
    const denied = await api.approvals.resolve((await approval(a.id)).id, { decision: "deny" }); expect(denied.payload).toBeNull(); expect(denied.grantId).toBeNull();
    const never = await approval(a.id, "change_credentials");
    await expect(api.approvals.resolve(never.id, { decision: "approve" })).rejects.toMatchObject({ code: "forbidden" });
    expect((await api.approvals.list("open"))).toHaveLength(1); expect(await api.grants.list()).toHaveLength(1);
    const other = (await db.workspace.create({ data: { name: "other" } })).id;
    await expect(createStewardService(ports).forWorkspace(other).approvals.resolve(never.id, { decision: "deny" })).rejects.toMatchObject({ code: "not_found" });
  });
  test("explicit never grant cannot be bypassed by approving", async () => {
    const a = await affair();
    await api.grants.create({ action: "send_external_message", mode: "never", scope: { kind: "affair", affairId: a.id } });
    await expect(api.approvals.resolve((await approval(a.id)).id, { decision: "approve" })).rejects.toMatchObject({ code: "forbidden" });
  });
});
test("preferences and validated settings", async () => {
  const p = await api.preferences.add({ text: "Be concise" }); expect((await api.preferences.add({ text: "Be concise" })).id).toBe(p.id);
  expect((await api.preferences.markUsed(p.id)).lastUsedAt).toBe(time.toISOString());
  await api.preferences.delete(p.id); expect(await api.preferences.list()).toEqual([]);
  await expect(api.settings.update({ notifications: { timezone: "Invalid/Zone" } })).rejects.toMatchObject({ code: "invalid" });
  await expect(api.settings.update({ notifications: { digestAt: "99:99" } })).rejects.toMatchObject({ code: "invalid" });
  expect(settingsSchema.safeParse(await api.settings.update({ notifications: { dailyCap: 1 } })).success).toBe(true);
});
test("Today shows what happened per affair, what is coming, pointers and health — never wake instructions", async () => {
  time = new Date("2026-10-15T15:00:00Z"); // 23:00 Shanghai
  const a = await affair(), quiet = await affair(), files = await api.affairs.files(a.id);
  await db.affair.update({ where: { id: quiet.id }, data: { lastActivityAt: new Date("2026-10-01T00:00:00Z") } });
  await files.save("day.md", "Today's work", null); await files.save(".chrona/today", "day.md\n", null);
  await api.affairs.appendActivity(a.id, { actor: "chrona", kind: "edit", text: "Prepared day", data: { paths: ["day.md", "../escape"] } });
  await approval(a.id);
  await db.schedule.create({ data: { workspaceId, affairId: a.id, mode: "wake", rule: { kind: "at", at: "2026-10-15T15:30:00Z" }, text: "Internal instruction", createdBy: "chrona", nextAt: new Date("2026-10-15T15:30:00Z") } });
  await db.schedule.create({ data: { workspaceId, affairId: a.id, mode: "wake", label: "Prepare day 2", rule: { kind: "at", at: "2026-10-16T16:30:00Z" }, text: "Internal instruction", createdBy: "chrona", nextAt: new Date("2026-10-16T16:30:00Z") } });
  await db.schedule.create({ data: { workspaceId, affairId: a.id, mode: "remind", rule: { kind: "daily", time: "09:00" }, text: "Practise speaking", createdBy: "chrona", nextAt: new Date("2026-10-16T01:00:00Z") } });
  await db.schedule.create({ data: { workspaceId, affairId: a.id, mode: "remind", rule: { kind: "at", at: "2026-10-30T01:00:00Z" }, text: "Too far", createdBy: "chrona", nextAt: new Date("2026-10-30T01:00:00Z") } });
  await db.notification.create({ data: { workspaceId, affairId: a.id, level: "now", channel: "in_app", title: "Plan ready", body: "Open day 1", idempotencyKey: "n1", createdAt: time } });
  await db.run.create({ data: { workspaceId, affairId: a.id, lane: "background", trigger: "schedule", provider: "fake", status: "running", label: "Prepare materials", tokenHash: "fake", prompt: "test", cwd: "unused", startedAt: time } });
  const today = await api.today(); expect(todayViewSchema.safeParse(today).success).toBe(true);
  expect(today.upcoming.map(u => [u.label, u.mode])).toEqual([[null, "wake"], ["Practise speaking", "remind"], ["Prepare day 2", "wake"]]);
  expect(JSON.stringify(today)).not.toContain("Internal instruction");
  expect(today.progress.map(p => p.affair.id)).toEqual([a.id]);
  expect(today.progress[0]).toMatchObject({ changedPages: 1, updates: [{ title: "Plan ready", body: "Open day 1" }], affair: { work: { state: "running", label: "Prepare materials" } } });
  expect(today.approvals).toHaveLength(1); expect(today.todayPage).toEqual({ affairId: a.id, path: "day.md" });
  expect(today.health.provider.available).toBe(false); expect(today.health.runningRuns).toBe(1); expect(today.health.git).toBe(true);
});
describe("notification outbox", () => {
  test("invalid inputs and foreign workspace transactions cannot enqueue", async () => {
    await expect(api.notifications.enqueue({ dedupeKey: "invalid", level: "now", title: "", body: "x" })).rejects.toMatchObject({ code: "invalid" });
    const other = (await db.workspace.create({ data: { name: "other" } })).id;
    await expect(db.$transaction(tx => api.notifications.enqueueNotification(tx, { workspaceId: other, dedupeKey: "foreign", level: "now", title: "x", body: "x" }))).rejects.toMatchObject({ code: "forbidden" });
    expect(await api.notifications.list()).toEqual([]);
  });
  test("cap reserves queued sends, dedupe, web and digest routing", async () => {
    await api.settings.update({ notifications: { dailyCap: 1 } });
    const first = await notify("one"); expect(first.status).toBe("queued"); expect((await notify("one")).id).toBe(first.id);
    expect((await notify("two")).status).toBe("folded"); expect((await notify("web", "web")).channel).toBe("in_app"); expect((await notify("digest", "digest")).status).toBe("folded");
    await api.notifications.deliverDue(); expect(sent.sort()).toEqual(["one", "web"]);
    // Folded at noon, after today's 09:00 digest time: it waits for tomorrow's digest instead of interrupting now.
    expect(await api.notifications.sendDigestIfDue()).toBeNull();
    time = new Date("2026-10-16T01:00:00Z"); // 09:00 Shanghai
    expect(await api.notifications.sendDigestIfDue()).not.toBeNull(); expect(await api.notifications.sendDigestIfDue()).toBeNull();
    await api.notifications.deliverDue(); expect(sent).toContain("digest:2026-10-16");
  });
  test("a response to the user's own request ignores the cap and quiet hours and does not use the budget", async () => {
    await api.settings.update({ notifications: { dailyCap: 1 } });
    time = new Date("2026-10-15T16:00:00Z"); // 00:00 Shanghai, quiet hours
    expect((await api.notifications.enqueue({ dedupeKey: "response:r1:0", level: "now", title: "Done", body: "Your plan is ready", responds: true })).status).toBe("queued");
    expect((await api.notifications.enqueue({ dedupeKey: "response:r2:0", level: "digest", title: "Done", body: "Updated", responds: true })).status).toBe("queued");
    time = new Date("2026-10-15T04:00:00Z");
    expect((await notify("proactive")).status).toBe("queued");
    expect((await notify("second proactive")).status).toBe("folded");
  });
  test("quiet hours fold; urgent still obeys daily cap", async () => {
    time = new Date("2026-10-15T16:00:00Z"); expect((await notify("quiet")).status).toBe("folded");
    expect((await api.notifications.enqueue({ dedupeKey: "urgent", level: "now", title: "Urgent", body: "Urgent", urgent: true })).status).toBe("queued");
    await api.settings.update({ notifications: { dailyCap: 0 } });
    expect((await api.notifications.enqueue({ dedupeKey: "capped", level: "now", title: "Urgent", body: "Urgent", urgent: true })).status).toBe("folded");
  });
  test("unbound chat falls back to in-app and paused affairs suppress", async () => {
    ports.chat = null; api = createStewardService(ports).forWorkspace(workspaceId);
    expect((await notify("fallback")).channel).toBe("in_app");
    const a = await affair(); await notify("before-pause", "now", a.id); await api.affairs.update(a.id, { status: "paused" });
    expect((await notify("after-pause", "now", a.id)).status).toBe("suppressed");
    await api.notifications.deliverDue(); expect(sent).toEqual(["fallback"]);
  });
  test("retryable rejection backs off; uncertain outcomes never auto-retry", async () => {
    outcome = { outcome: "rejected", retryable: true, error: "offline" };
    await notify("retry"); await api.notifications.deliverDue(); await api.notifications.deliverDue(); expect(sent).toHaveLength(1);
    time = new Date(time.getTime() + 60001); outcome = { outcome: "uncertain", error: "unknown" }; await api.notifications.deliverDue(); expect(sent).toHaveLength(2);
    const row = (await api.notifications.list())[0]!; expect(row.status).toBe("uncertain");
    await expect(api.notifications.retry(row.id)).rejects.toMatchObject({ code: "conflict" });
    time = new Date(time.getTime() + 3600000); await api.notifications.deliverDue(); expect(sent).toHaveLength(2);
  });
  test("permanent failure requires explicit retry, acknowledgement keeps sentToday", async () => {
    outcome = { outcome: "rejected", retryable: false, error: "unavailable" };
    const row = await notify("failed"); await api.notifications.deliverDue();
    expect((await api.notifications.list())[0]!.status).toBe("failed");
    await api.notifications.retry(row.id); outcome = { outcome: "accepted", receiptRef: "fake" };
    await api.notifications.deliverDue(); await api.notifications.acknowledge(row.id);
    expect((await api.settings.get()).chat.sentToday).toBe(1);
  });
  test("expired delivery lease becomes uncertain without sending", async () => {
    const row = await notify("lease"); await db.notification.update({ where: { id: row.id }, data: { leaseToken: "old", leaseUntil: new Date(time.getTime() - 1) } });
    await api.notifications.deliverDue(); expect(sent).toEqual([]); expect((await api.notifications.list())[0]!.status).toBe("uncertain");
  });
  test("negative feedback downgrades future now notifications", async () => {
    const a = await affair(), one = await notify("n1", "now", a.id), two = await notify("n2", "now", a.id);
    await api.notifications.recordFeedback(one.id, "not_useful"); await api.notifications.recordFeedback(two.id, "not_useful");
    expect((await notify("n3", "now", a.id)).status).toBe("folded");
  });
});
