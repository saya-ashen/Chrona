import { afterAll, expect, test } from "bun:test";
import type { DeliveryOutcome } from "@chrona/contracts/steward";
import type { StewardPorts } from "./service";
import { testDb } from "./test-db";
import { createNotifications } from "./notify";
const db = testDb();
afterAll(() => db.$disconnect());
async function fixture(cap = 5) {
  let clock = new Date("2026-10-15T10:00:00Z"), outcome: DeliveryOutcome = { outcome: "accepted", receiptRef: "receipt" }, sends = 0;
  const ws = await db.workspace.create({ data: { name: "Notify", settings: { notifications: { dailyCap: cap, quietHours: { start: "23:00", end: "08:00" }, timezone: "UTC", digestAt: "09:00" } } } });
  const affair = await db.affair.create({ data: { workspaceId: ws.id, title: "服务", cadenceSeconds: 300, notify: "now" } });
  const ports: StewardPorts = { db, now: () => clock, publicUrl: null, sources: [], assessor: { name: "test", assess: async () => { throw Error(); } }, deliveries: ["in_app", "chrona_qqbot"].map(channel => ({ channel: channel as "in_app" | "chrona_qqbot", send: async () => { sends++; return outcome; } })), chat: { channel: "chrona_qqbot", bound: async () => true }, agentHealth: () => ({ available: true, name: "test", lastError: null }), agent: null };
  const n = createNotifications(ports, ws.id);
  const enqueue = (key: string, level: "now" | "digest" | "web" = "now", urgent = false) => n.enqueue({ affairId: affair.id, title: "Change", body: "What; why; view affair", level, urgent, dedupeKey: key });
  return { n, enqueue, ws, affair, ports, clock: (at: string) => { clock = new Date(at); }, outcome: (v: DeliveryOutcome) => { outcome = v; }, sends: () => sends };
}
test("budget reserves cap, quiet hours fold, urgent bypasses quiet only; web and dedupe", async () => {
  const f = await fixture(1);
  const first = await f.enqueue("a"); expect(first.status).toBe("queued"); expect(first.channel).toBe("chrona_qqbot");
  expect((await f.enqueue("b")).status).toBe("folded"); expect((await f.enqueue("a")).id).toBe(first.id);
  expect((await f.enqueue("web", "web")).channel).toBe("in_app");
  f.clock("2026-10-16T23:00:00Z"); expect((await f.enqueue("quiet")).status).toBe("folded");
  expect((await f.enqueue("urgent", "now", true)).status).toBe("queued");
  expect((await f.enqueue("urgent-cap", "now", true)).status).toBe("folded");
});
test("paused suppression and unbound chat fallback", async () => {
  const f = await fixture(); f.ports.chat = null;
  expect((await f.enqueue("fallback")).channel).toBe("in_app");
  await db.affair.update({ where: { id: f.affair.id }, data: { status: "paused" } });
  expect((await f.enqueue("paused")).status).toBe("suppressed"); await f.n.deliverDue(); expect(f.sends()).toBe(0);
});
test("accepted receipt, rejected backoff and six attempt limit, manual failed retry", async () => {
  const f = await fixture(); const a = await f.enqueue("accepted"); await f.n.deliverDue();
  expect((await db.notification.findUniqueOrThrow({ where: { id: a.id } })).receiptRef).toBe("receipt");
  f.outcome({ outcome: "rejected", retryable: true, error: "busy" }); const b = await f.enqueue("retry");
  await f.n.deliverDue(); let row = await db.notification.findUniqueOrThrow({ where: { id: b.id } });
  expect(row.nextAttemptAt?.toISOString()).toBe("2026-10-15T10:01:00.000Z");
  for (let i = 1; i < 6; i++) { await f.n.deliverDue(row.nextAttemptAt!); row = await db.notification.findUniqueOrThrow({ where: { id: b.id } }); }
  expect(row.status).toBe("failed"); expect(row.attempts).toBe(6); expect((await f.n.retry(b.id)).status).toBe("queued");
  f.outcome({ outcome: "rejected", retryable: false, error: "denied" }); await f.n.deliverDue(); expect((await db.notification.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("failed");
});
test("uncertain and expired leases never resend; acknowledged", async () => {
  const f = await fixture(); f.outcome({ outcome: "uncertain", error: "timeout" }); const a = await f.enqueue("uncertain");
  await f.n.deliverDue(); await f.n.deliverDue(); expect(f.sends()).toBe(1); await expect(f.n.retry(a.id)).rejects.toThrow("Only failed");
  const b = await f.enqueue("lease"); await db.notification.update({ where: { id: b.id }, data: { leaseToken: "old", leaseUntil: new Date(0) } });
  await f.n.deliverDue(); expect(f.sends()).toBe(1); expect((await f.n.list()).find(r => r.id === b.id)?.status).toBe("uncertain");
  expect((await f.n.acknowledge(a.id)).status).toBe("acknowledged");
});
test("digest once per local day bypasses cap, waits through quiet, includes folded rows once", async () => {
  const f = await fixture(0); await f.enqueue("fold"); f.clock("2026-10-15T23:00:00Z"); expect(await f.n.sendDigestIfDue()).toBeNull();
  f.clock("2026-10-16T08:00:00Z"); expect(await f.n.sendDigestIfDue()).toBeNull(); f.clock("2026-10-16T09:00:00Z");
  expect((await f.n.sendDigestIfDue())?.status).toBe("queued"); expect(await f.n.sendDigestIfDue()).toBeNull();
  await f.n.deliverDue(); expect(f.sends()).toBe(1);
  f.clock("2026-10-17T09:00:00Z"); expect(await f.n.sendDigestIfDue()).toBeNull();
});
test("two distinct not-useful feedbacks downgrade care with one learned preference", async () => {
  const f = await fixture(), a = await f.enqueue("one"), b = await f.enqueue("two");
  await f.n.recordFeedback(a.id, "not_useful"); await f.n.recordFeedback(a.id, "not_useful");
  expect((await db.affair.findUniqueOrThrow({ where: { id: f.affair.id } })).notify).toBe("now");
  await f.n.recordFeedback(b.id, "not_useful"); await f.n.recordFeedback(b.id, "not_useful");
  expect((await db.affair.findUniqueOrThrow({ where: { id: f.affair.id } })).notify).toBe("digest");
  expect(await db.preference.count({ where: { workspaceId: f.ws.id, origin: "learned" } })).toBe(1);
});
test("feedback window and workspace ownership", async () => {
  const f = await fixture(), a = await f.enqueue("old"); await f.n.recordFeedback(a.id, "not_useful");
  f.clock("2026-11-16T10:00:00Z"); const b = await f.enqueue("new"); await f.n.recordFeedback(b.id, "not_useful");
  expect((await db.affair.findUniqueOrThrow({ where: { id: f.affair.id } })).notify).toBe("now");
  const other = await fixture(); await expect(other.n.recordFeedback(a.id, "useful")).rejects.toThrow("not found");
});
