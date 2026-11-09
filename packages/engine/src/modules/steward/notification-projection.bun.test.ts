import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { messageSchema } from "@chrona/contracts/steward";
import { createNotify, type Caller } from "./external/notify/notify";
import { openStore } from "./external/notify/store";
import { testDirectory } from "./external/notify/test-directory";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const at = new Date("2026-11-05T00:00:00.000Z");
const caller: Caller = { kind: "module", module: "transport", moduleId: "transport-id", hash: "h" };
async function fixture() {
  const dir = await mkdtemp("/tmp/chrona-notification-projection-"), store = openStore(dir);
  cleanups.push(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const notify = createNotify({ store, publicUrl: null, directory: async () => testDirectory("transport"),
    call: async () => { throw new Error("Projection must not deliver notifications"); },
    status: async () => { throw new Error("Projection must not poll delivery receipts"); } });
  await notify.refresh();
  return { store, notify };
}

test("Notify owns bounded channel registration independently of conversation channels", async () => {
  const { store, notify } = await fixture();
  for (const channel of ["chrona_qqbot", "new-channel", "a".repeat(120)]) {
    expect(notify.handle("channel", { channel, tool: "deliver", ready: true, at: at.toISOString() }, caller, at)).toEqual({ ready: true });
    expect(JSON.parse(store.get(`channel:${channel}`)!)).toMatchObject({ moduleId: caller.moduleId, module: caller.module, tool: "deliver", ready: true });
  }
  for (const channel of [null, "", "a".repeat(121), 42, undefined, "in_app", "bad channel"]) {
    expect(notify.handle("channel", { channel, tool: "deliver", ready: true, at: at.toISOString() }, caller, at)).toMatchObject({ error: "invalid" });
  }
  expect(messageSchema.shape.channel.safeParse("third-party-room").success).toBe(false);
});

test("Notify list projects private records, arbitrary channels and delivery failure details", async () => {
  const { store, notify } = await fixture();
  for (const channel of ["in_app", "chrona_qqbot", "third-party-room", "a".repeat(120)]) {
    const id = `notice-${channel}`;
    store.insert({ id, key: id, module_id: "source-module", app: "source", session_id: "source-session", approval_id: null, scoped: 0,
      level: "now", web: 0, responds: 0, channel, status: "failed", title: "Title", body: "**Body**", format: "markdown",
      recipient: null, link: "/sessions/source-session", attempts: 3, last_error: "Delivery rejected", created_at: at.getTime(), sent_at: null });
    expect(notify.handle("list", { limit: 50 }, caller, at)).toEqual({ items: expect.arrayContaining([{
      id, moduleId: "source-module", sessionId: "source-session", level: "now", channel, status: "failed", title: "Title", body: "**Body**", format: "markdown",
      link: "/sessions/source-session", attempts: 3, lastError: "Delivery rejected", createdAt: at.toISOString(), sentAt: null, feedback: null,
    }]) });
  }
  const row = store.byKey("notice-in_app")!;
  store.update(row.id, { status: "sending", attempts: 4 });
  expect(notify.handle("list", {}, caller, at)).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: row.id, status: "queued", attempts: 4 })]) });
  expect(notify.handle("status", {}, caller, at)).toMatchObject({ queued: 1, failed: 3 });
});
