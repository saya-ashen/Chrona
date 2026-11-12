import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createScriptSandbox } from "../../../../../../integrations/src/steward/script-sandbox";
import { openStore } from "./store";

const now = "2026-10-21T04:00:00.000Z";
test.each([false, true])("Notify author tests preserve storage and pass repeatedly (existing preferences and fixtures: %s)", async existing => {
  const root = await mkdtemp("/tmp/chrona-notify-continuity-");
  const data = join(root, "data");
  await mkdir(data);
  const sandbox = createScriptSandbox({ dataDir: root });
  const snapshot = () => {
    const store = openStore(data);
    try { return { rows: store.rows("SELECT * FROM notifications ORDER BY id"), kv: store.db.query("SELECT * FROM kv ORDER BY key").all() }; }
    finally { store.close(); }
  };
  try {
    const store = openStore(data);
    try {
      if (existing) {
        store.set("settings", JSON.stringify({ dailyCap: 0, quietHours: { start: "00:00", end: "23:59" }, timezone: "America/New_York", digestAt: "23:59" }));
        store.set("settings_at", String(Date.parse("2099-01-01T00:00:00Z")));
        store.set("channel:chrona_qqbot", JSON.stringify({ module: "previous", moduleId: "previous-id", tool: "deliver", ready: true, at: Date.parse("2099-01-01T00:00:00Z"), revision: "previous" }));
        for (let i = 0; i < 65; i++) {
          store.insert({ id: `existing-${i}`, key: ["k1", "k2", "k3", "gone", "module:o:k1"][i] ?? `existing-${i}`,
            module_id: null, app: null, session_id: null, approval_id: null, scoped: 0, level: "now", web: 0, responds: 0,
            status: ["sent", "queued", "folded", "uncertain", "suppressed"][i % 5]!, title: i === 2 ? "Ping" : "Maybe", body: `Existing body ${i}`,
            format: i % 2 ? "text" : "markdown", recipient: null, link: null, created_at: Date.parse("2099-01-01T00:00:00Z") + i,
            receipt_ref: `existing-receipt-${i}`, feedback: "useful" });
        }
      }
    } finally { store.close(); }
    const before = snapshot();
    for (const entry of ["test.ts", "test.ts", "format-test.ts"]) {
      const result = await sandbox.runModule({ codeDir: import.meta.dir, dataDir: data, entry, input: { now, params: {} }, network: false, timeoutMs: 20_000 });
      expect(result, `${entry}: ${result.error}`).toMatchObject({ status: "succeeded", exitCode: 0 });
      expect(snapshot()).toEqual(before);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 70_000);

test("Notify author continuity rejects an unapplied migration and unreadable settings", async () => {
  const root = await mkdtemp("/tmp/chrona-notify-invalid-");
  const data = join(root, "data");
  await mkdir(data);
  const sandbox = createScriptSandbox({ dataDir: root });
  const run = (entry: string, input: unknown = { now, params: {} }) => sandbox.runModule({
    codeDir: import.meta.dir, dataDir: data, entry, input, network: false, timeoutMs: 20_000,
  });
  try {
    let store = openStore(data);
    store.insert({ id: "legacy", key: "legacy", module_id: null, app: null, session_id: null, approval_id: null,
      scoped: 0, level: "now", web: 0, responds: 0, status: "uncertain", title: "Legacy", body: "Keep this body",
      recipient: null, link: null, created_at: Date.parse(now), receipt_ref: "legacy-receipt" });
    store.set("settings", JSON.stringify({ dailyCap: 7, quietHours: null, timezone: "UTC", digestAt: "09:00" }));
    const before = store.byId("legacy")!;
    store.db.exec("ALTER TABLE notifications DROP COLUMN format");
    store.close();
    expect(await run("test.ts")).toMatchObject({ status: "failed", exitCode: 1 });
    expect(await run("migrate.ts", { migrate: { from: 1, to: 2 }, now })).toMatchObject({ status: "succeeded", exitCode: 0 });
    expect(await run("test.ts")).toMatchObject({ status: "succeeded", exitCode: 0 });
    store = openStore(data);
    try {
      expect(store.byId("legacy")).toEqual(before);
      expect(store.settings().dailyCap).toBe(7);
      store.set("settings", "invalid json");
    } finally { store.close(); }
    expect(await run("test.ts")).toMatchObject({ status: "failed", exitCode: 1 });
    store = openStore(data);
    try { expect(store.get("settings")).toBe("invalid json"); expect(store.byId("legacy")).toEqual(before); }
    finally { store.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 70_000);
