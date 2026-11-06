/* eslint-disable @typescript-eslint/no-explicit-any -- Offline author test: drives the untyped fake kernel and fetch stubs. */
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule, paths } from "chrona/testing";
import { openStore, type Store } from "./store";
import { createNotify } from "./notify";
import { migrateFormat } from "./migrate";
import { testDirectory } from "./test-directory";

const root = await mkdtemp(join(paths.data, "format-"));
const kernel = { kind: "kernel" } as const;
const channelOwner = { kind: "module", module: "qq", moduleId: "qq-id", hash: "h" } as const;
const noon = new Date("2026-10-21T04:00:00Z"); // 12:00 Shanghai
const nextDay = new Date("2026-10-22T04:00:00Z");
type Call = { target: string; args: Record<string, unknown>; options: { key: string; mode: string; reply: boolean }; callId: string };
function harness(store: Store) {
  const calls: Call[] = [];
  const notify = createNotify({ store, publicUrl: "https://chrona.example", directory: async () => testDirectory(), call: async (target, args, options) => {
    const callId = `call-${calls.length + 1}`;
    calls.push({ target, args, options, callId }); return { callId, status: "queued" };
  }, status: async callId => ({ callId, status: "queued" }) });
  const handle = (tool: string, args: Record<string, unknown>, at = noon) => notify.handle(tool, args, tool === "channel" ? channelOwner : kernel, at) as any;
  return { notify, handle, calls };
}
async function fresh(name: string) { const dir = join(root, name); await mkdir(dir); return dir; }
const message = (key: string, extra = {}) => ({ key, level: "now", title: "Trending", body: "## Repos\n- [repo](https://github.com/a/b)", ...extra });
const ready = async (h: ReturnType<typeof harness>) => { await h.notify.refresh(); return h.handle("channel", { channel: "chrona_qqbot", tool: "deliver", ready: true, at: noon.toISOString() }); };
try {
  // Send → durable row → stop → reopen → dispatch → real channel result semantics.
  const dir = await fresh("restart");
  let store = openStore(dir), h = harness(store);
  await ready(h);
  const saved = h.handle("send", message("md", { format: "markdown" }));
  h.handle("send", message("plain"));
  assert.equal(store.byId(saved.id)!.format, "markdown");
  assert.equal(h.handle("list", {}).items.find((r: any) => r.id === saved.id).format, "markdown");
  store.close();
  store = openStore(dir); h = harness(store);
  try {
    assert.equal(store.byKey("md")!.body, message("md").body);
    await h.notify.tick(noon);
    assert.equal(h.calls.length, 2);
    const md = h.calls.find(c => c.args.key === "md")!, plain = h.calls.find(c => c.args.key === "plain")!;
    assert.equal(md.target, "qq.deliver"); assert.equal(md.args.format, "markdown"); assert.equal(plain.args.format, "text");
    assert.equal(md.args.body, message("md").body);
    assert.equal(md.options.mode, "async"); assert.equal(md.options.reply, true);
    assert.notEqual(md.options.key, plain.options.key);
    assert.equal(h.handle("send", message("md", { format: "text", body: "changed" })).duplicate, true);
    assert.equal(store.byKey("md")!.format, "markdown");
    h.notify.result({ callId: md.callId, status: "succeeded", output: { outcome: "rejected", retryable: true, error: "rate limit" } }, noon);
    assert.equal(store.byKey("md")!.status, "queued");
    const retryAt = new Date(noon.getTime() + 60_000);
    await h.notify.tick(retryAt);
    const retry = h.calls[2]!;
    assert.equal(retry.args.format, "markdown"); assert.notEqual(retry.options.key, md.options.key);
    // Stale/duplicate completion cannot settle a newer attempt.
    h.notify.result({ callId: md.callId, status: "succeeded", output: { outcome: "accepted", receiptRef: "stale" } }, retryAt);
    assert.equal(store.byKey("md")!.status, "sending");
    h.notify.result({ callId: retry.callId, status: "succeeded", output: { outcome: "rejected", retryable: false, error: "QQ markdown rejected" } }, retryAt);
    assert.equal(store.byKey("md")!.status, "failed"); assert.equal(store.byKey("md")!.last_error, "QQ markdown rejected");
    h.notify.result({ callId: plain.callId, status: "unknown", error: "receipt lost" }, retryAt);
    await h.notify.tick(nextDay);
    assert.equal(store.byKey("plain")!.status, "uncertain"); assert.equal(h.calls.length, 3);
  } finally { store.close(); }

  // Strict format handling (including duplicate keys), no Markdown slicing, old text truncation.
  store = openStore(await fresh("validation")); h = harness(store);
  try {
    for (const format of ["html", "Markdown", "", null, 2, false, {}, []]) {
      assert.equal(h.handle("send", message("invalid", { format })).error, "invalid");
    }
    assert.equal(store.byKey("invalid"), null);
    for (const extra of [{ body: "x".repeat(4001) }, { title: "x".repeat(201) }]) {
      assert.equal(h.handle("send", message("long", { format: "markdown", ...extra })).error, "invalid");
    }
    assert.equal(store.byKey("long"), null);
    const exact = h.handle("send", message("exact", { format: "markdown", body: "x".repeat(4000), title: "x".repeat(200) }));
    assert.equal(store.byId(exact.id)!.body.length, 4000);
    assert.equal(h.handle("send", message("exact", { format: "html" })).error, "invalid");
    const text = h.handle("send", message("long-text", { body: "x".repeat(5000), title: "x".repeat(300) }));
    assert.equal(store.byId(text.id)!.body.length, 4000); assert.equal(store.byId(text.id)!.title.length, 200); assert.equal(store.byId(text.id)!.format, "text");
  } finally { store.close(); }

  // Budget/quiet/web routing is identical, digest always explicitly text for mixed sources.
  store = openStore(await fresh("budget")); h = harness(store);
  try {
    await ready(h);
    h.handle("configure", { "daily-cap": 0, timezone: "Asia/Shanghai", "digest-at": "09:00", at: noon.toISOString() });
    const folded = h.handle("send", message("fold-md", { format: "markdown" }));
    h.handle("send", message("fold-text"));
    assert.equal(folded.status, "folded");
    await h.notify.tick(noon); assert.equal(h.calls.length, 0);
    await h.notify.tick(nextDay);
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0]!.args.format, "text");
    assert.ok(String(h.calls[0]!.args.key).startsWith("digest:"));
    assert.equal(store.byId(folded.id)!.format, "markdown");
    assert.ok(store.byId(folded.id)!.digest_id);
    const web = h.handle("send", message("web", { format: "markdown", level: "web" }));
    await h.notify.tick(nextDay); assert.equal(h.calls.length, 1); assert.equal(store.byId(web.id)!.channel, "in_app");
    h.handle("configure", { "daily-cap": 5, timezone: "Asia/Shanghai", "digest-at": "09:00", "quiet-start": "23:00", "quiet-end": "08:00", at: nextDay.toISOString() });
    const quiet = new Date("2026-10-22T16:00:00Z");
    assert.equal(h.handle("send", message("quiet", { format: "markdown" }), quiet).status, "folded");
    const reply = h.handle("send", message("reply", { format: "markdown", responds: true }), quiet);
    assert.equal(reply.status, "queued"); // existing responds exception, not a new format bypass
    await h.notify.tick(quiet); assert.equal(h.calls.at(-1)!.args.key, "reply"); assert.equal(h.calls.at(-1)!.args.format, "markdown");
  } finally { store.close(); }

  // Historical import defaults to text; explicit format survives restart; invalid batch is not partially written.
  const importDir = await fresh("import"); store = openStore(importDir); h = harness(store);
  const old = { id: "old", idempotencyKey: "old", title: "Old", body: "**literal**", level: "now", status: "queued", createdAt: noon.toISOString() };
  try {
    assert.deepEqual(h.handle("import", { rows: JSON.stringify([old, { ...old, id: "import-md", idempotencyKey: "import-md", format: "markdown" }, { ...old, id: "leased", idempotencyKey: "leased", leaseToken: "held" }]) }), { imported: 3 });
    assert.equal(store.byKey("old")!.format, "text"); assert.equal(store.byKey("leased")!.status, "uncertain");
    assert.equal(h.handle("import", { rows: JSON.stringify([old]) }).imported, 0);
    for (const extra of [{ format: "html" }, { format: null }, { format: "markdown", body: "x".repeat(4001) }, { format: "markdown", title: "x".repeat(201) }]) {
      assert.equal(h.handle("import", { rows: JSON.stringify([{ ...old, id: "partial", idempotencyKey: "partial" }, { ...old, ...extra, id: "bad", idempotencyKey: "bad" }]) }).error, "invalid");
      assert.equal(store.byKey("partial"), null); assert.equal(store.byKey("bad"), null);
    }
  } finally { store.close(); }
  store = openStore(importDir); h = harness(store);
  try { ready(h); await h.notify.tick(noon); assert.equal(h.calls.find(c => c.args.key === "import-md")!.args.format, "markdown"); assert.equal(h.calls.find(c => c.args.key === "old")!.args.format, "text"); assert.equal(h.calls.length, 2); }
  finally { store.close(); }

  // Actual v1 SQLite fixture: all previous fields, receipt/lease/settings/readiness survive CLI upgrade.
  const legacyDir = await fresh("legacy"); const legacy = new Database(join(legacyDir, "notify.db"));
  legacy.exec(`CREATE TABLE notifications (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, module_id TEXT, app TEXT, session_id TEXT, approval_id TEXT, scoped INTEGER NOT NULL DEFAULT 0,
    level TEXT NOT NULL, web INTEGER NOT NULL DEFAULT 0, responds INTEGER NOT NULL DEFAULT 0, channel TEXT NOT NULL DEFAULT 'in_app', status TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, recipient TEXT, link TEXT, receipt_ref TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
    next_attempt_at INTEGER, call_id TEXT, call_at INTEGER, created_at INTEGER NOT NULL, sent_at INTEGER, feedback TEXT, digest_id TEXT);
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  legacy.run("INSERT INTO notifications (id,key,level,status,title,body,attempts,created_at,call_id,call_at,feedback,receipt_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", ["legacy", "legacy", "now", "sending", "old", "**not md**", 2, noon.getTime(), "old-call", noon.getTime(), "useful", "receipt"]);
  legacy.run("INSERT INTO kv VALUES (?,?)", ["channel:chrona_qqbot", JSON.stringify({ ready: true, at: noon.getTime() })]);
  legacy.run("INSERT INTO kv VALUES (?,?)", ["settings", JSON.stringify({ dailyCap: 7, quietHours: null, timezone: "UTC", digestAt: "09:00" })]);
  const before = legacy.query("SELECT * FROM notifications").get(); legacy.close();
  const migration = Bun.spawn([process.execPath, "--no-install", "migrate.ts"], { env: { ...process.env, CHRONA_DATA: legacyDir }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  migration.stdin.write(JSON.stringify({ migrate: { from: 1, to: 2 }, now: noon.toISOString() })); migration.stdin.end();
  assert.equal(await migration.exited, 0, await new Response(migration.stderr).text());
  migrateFormat(legacyDir); // repeat is harmless
  store = openStore(legacyDir); h = harness(store);
  try {
    const { format, ...after } = store.byKey("legacy")!;
    assert.equal(format, "text"); assert.deepEqual(after, before); assert.equal(store.settings().dailyCap, 7);
    // Legacy readiness survives migration but is not a channel registration.
    assert.equal(h.handle("status", {}).chat.bound, false);
    await ready(h);
    assert.equal(h.handle("status", {}).chat.bound, true);
    h.notify.result({ callId: "old-call", status: "succeeded", output: { outcome: "accepted", receiptRef: "after-migration" } }, noon);
    assert.equal(store.byKey("legacy")!.status, "sent"); assert.equal(store.byKey("legacy")!.receipt_ref, "after-migration");
  } finally { store.close(); }

  // Crash before call-id persistence: recovery reuses the exact call key and preserves format.
  const recoveryDir = await fresh("recovery"); store = openStore(recoveryDir); h = harness(store); await ready(h);
  const recovery = h.handle("send", message("recover", { format: "markdown" }));
  await h.notify.tick(noon); const originalKey = h.calls[0]!.options.key;
  store.update(recovery.id, { call_id: null }); store.close();
  store = openStore(recoveryDir); h = harness(store);
  try { await h.notify.tick(new Date(noon.getTime() + 61_000)); assert.equal(h.calls[0]!.options.key, originalKey); assert.equal(h.calls[0]!.args.format, "markdown"); }
  finally { store.close(); }

  // SDK integration, fake kernel only: declaration + tool validation + persisted restart + async result.
  const sdkDir = await fresh("sdk"); const previousData = process.env.CHRONA_DATA;
  process.env.CHRONA_DATA = sdkDir;
  let mod: Awaited<ReturnType<typeof startModule>> | undefined;
  try {
    const start = () => startModule("index.ts", { stubs: { "modules.list": () => testDirectory().modules, "modules.tools": () => testDirectory().tools } });
    mod = await start();
    let n = 0;
    const tool = (id: string, args: Record<string, unknown>) => mod!.send({ trigger: { kind: "tool", id, args, firedAt: new Date(noon.getTime() + n++ * 1000).toISOString(), caller: id === "channel" ? channelOwner : kernel }, now: noon.toISOString(), params: {} });
    assert.equal((await tool("send", message("sdk-bad", { format: "html" }))).result!.result.error, "invalid");
    await tool("channel", { channel: "chrona_qqbot", tool: "deliver", ready: true, at: noon.toISOString() });
    const queued = await tool("send", message("sdk-md", { format: "markdown", responds: true }));
    const id = queued.result!.result.id;
    const deliveries = () => mod!.calls.filter((c: { params: { target?: unknown } }) => c.params.target === "qq.deliver");
    for (let i = 0; i < 200 && !deliveries().length; i++) await Bun.sleep(10);
    assert.equal(deliveries().length, 1); const call = deliveries()[0]!;
    assert.equal((call.params.args as any).format, "markdown");
    await mod.stop(); mod = await start();
    assert.equal((await tool("list", {})).result!.result.items.find((r: any) => r.id === id).format, "markdown");
    await mod.send({ trigger: { kind: "call_result", id: "call", firedAt: noon.toISOString(), callId: call.id, target: "qq.deliver", key: String(call.params.key), status: "succeeded", output: { outcome: "accepted", receiptRef: "stub-only" } }, now: noon.toISOString(), params: {} });
    assert.equal((await tool("list", {})).result!.result.items.find((r: any) => r.id === id).status, "sent");
  } finally { if (mod) await mod.stop(); process.env.CHRONA_DATA = previousData; }
} finally { await rm(root, { recursive: true, force: true }); }
