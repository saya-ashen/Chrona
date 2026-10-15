import { expect, test } from "bun:test";
import { testDb } from "./test-db";
import { createSettings } from "./settings";

test("sentToday counts only successful chat sends in the configured local day", async () => {
  const db = testDb();
  try {
    await db.workspace.create({ data: { id: "settings", name: "Settings" } });
    const settings = createSettings({ db, workspaceId: "settings", now: () => new Date("2026-10-15T17:00:00Z") }, null);
    await settings.update({ notifications: { timezone: "Asia/Shanghai" } });
    for (const [id, channel, status, sentAt] of [
      ["today", "chrona_qqbot", "sent", "2026-10-15T16:00:00Z"],
      ["yesterday", "chrona_qqbot", "sent", "2026-10-15T15:59:59Z"],
      ["web", "in_app", "sent", "2026-10-15T16:30:00Z"],
      ["failed", "chrona_qqbot", "failed", null],
      ["queued", "chrona_qqbot", "queued", null],
    ] as const) {
      await db.notification.create({ data: { workspaceId: "settings", idempotencyKey: id, channel, status, title: id, body: id, sentAt: sentAt ? new Date(sentAt) : null } });
    }
    expect((await settings.get()).chat).toMatchObject({ bound: false, sentToday: 1 });
    const bound = createSettings({ db, workspaceId: "settings", now: () => new Date("2026-10-15T17:00:00Z") }, { channel: "chrona_qqbot", bound: async () => true });
    expect((await bound.get()).chat).toMatchObject({ bound: true, sentToday: 1 });
  } finally {
    await db.$disconnect();
  }
});
