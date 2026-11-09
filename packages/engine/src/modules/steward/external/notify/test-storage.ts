import { strict as assert } from "node:assert";
import { validSettings } from "./budget";
import { createNotify } from "./notify";
import { openStore } from "./store";

/** Exercise the supplied continuity copy without delivering or changing its notifications. */
export function verifyStoredData(dir: string) {
  const store = openStore(dir);
  try {
    assert.deepEqual(store.db.query("PRAGMA integrity_check").all(), [{ integrity_check: "ok" }]);
    // Require the migrated column even on an empty table; never silently migrate in an author test.
    store.db.query("SELECT format FROM notifications LIMIT 0").all();
    const rows = store.rows("SELECT * FROM notifications ORDER BY created_at DESC, id DESC");
    for (const row of rows) {
      assert.ok(["text", "markdown"].includes(row.format));
      assert.deepEqual(store.byId(row.id), row);
      assert.deepEqual(store.byKey(row.key), row);
    }
    const unavailable = async (): Promise<never> => { throw new Error("Storage verification must not dispatch calls"); };
    const notify = createNotify({ store, publicUrl: null, directory: unavailable, call: unavailable, status: unavailable });
    const settings = store.settings();
    assert.ok(validSettings(settings));
    const now = new Date();
    assert.deepEqual(notify.handle("settings", {}, { kind: "kernel" }, now), { settings });
    const expected = rows.filter(row => row.status !== "suppressed").slice(0, 50).map(row => ({
      id: row.id, moduleId: row.module_id, sessionId: row.session_id, level: row.level, channel: row.channel,
      status: row.status === "sending" ? "queued" : row.status, title: row.title, body: row.body, format: row.format,
      link: row.link, attempts: row.attempts, lastError: row.last_error, createdAt: new Date(row.created_at).toISOString(),
      sentAt: row.sent_at === null ? null : new Date(row.sent_at).toISOString(), feedback: row.feedback,
    }));
    assert.deepEqual(notify.handle("list", { limit: 50 }, { kind: "kernel" }, now), { items: expected });
  } finally { store.close(); }
}
