import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_MODULE_NAMES, OFFICIAL_EXTERNAL_MODULE_NAMES, compileModuleOutput, moduleOutputSchema, moduleManifestSchema, type ModuleTool } from "@chrona/contracts/steward";
import { isModulePaused } from "./module-availability";
import { createFiles } from "./applications/files/files";
import { createEvents, type Caller } from "./applications/events/events";
import { createNotify, type Caller as NotifyCaller } from "./applications/notify/notify";
import { openStore } from "./applications/notify/store";
import { conversationMemory } from "./applications/memory-local/conversation";
import { preferences } from "./applications/memory-local/preferences";

const manifests = await Promise.all([
  ...BUILTIN_MODULE_NAMES.map(name => ({ name, directory: "builtin" })),
  ...OFFICIAL_EXTERNAL_MODULE_NAMES.filter(name => !isModulePaused(name)).map(name => ({ name, directory: "applications" })),
].map(async ({ name, directory }) => {
  const parsed = moduleManifestSchema.parse(await Bun.file(join(import.meta.dirname, directory, name, "module.json")).json());
  expect(parsed.name).toBe(name);
  return [parsed.name, parsed] as const;
}));
const tools = new Map<string, ModuleTool>(manifests.flatMap(([module, manifest]) => (manifest.tools ?? [])
  .filter(tool => (tool.visibility ?? ["provider", "owner"]).some(audience => audience === "owner" || audience === "modules"))
  .map(tool => [`${module}.${tool.name}`, tool] as const)));

test("every shipped built-in and official external owner/module tool declares a compilable output contract", () => {
  expect(manifests.map(([name]) => name)).toEqual(expect.arrayContaining(["author", "events", "files", "memory-local", "notify", "qq", "web"]));
  expect([...tools.keys()]).toEqual(expect.arrayContaining(["author.prepare", "events.emit", "files.read", "notify.send", "qq.reply", "web.pages"]));
  expect(tools.size).toBeGreaterThanOrEqual(30);
  for (const [name, tool] of tools) {
    expect(tool.output, `${name} output`).toBeDefined();
    const schema = moduleOutputSchema.parse(tool.output);
    expect(compileModuleOutput(schema), `${name} compiles`).toBeDefined();
  }
});

test("actual files and events handler results satisfy declared outputs, including empty and error branches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chrona-output-contracts-"));
  try {
    const filesDir = join(dir, "content"), dataDir = join(dir, "data");
    await mkdir(filesDir); await mkdir(dataDir);
    const files = createFiles(filesDir, dataDir);
    const check = (name: string, output: unknown) => {
      const schema = moduleOutputSchema.parse(tools.get(name)?.output);
      expect(compileModuleOutput(schema).safeParse(output).success, `${name}: ${JSON.stringify(output)}`).toBe(true);
    };
    check("files.list", await files.tool("list", {}, "2026-10-22T00:00:00Z"));
    check("files.history", await files.tool("history", { path: "empty.txt" }, "2026-10-22T00:00:00Z"));
    check("files.write", await files.tool("write", { path: "note.txt", content: "hello" }, "2026-10-22T00:00:00Z"));
    check("files.read", await files.tool("read", { path: "note.txt" }, "2026-10-22T00:00:00Z"));
    check("files.read", await files.tool("read", { path: "../escape" }, "2026-10-22T00:00:00Z"));
    check("files.history", await files.tool("history", { path: "note.txt" }, "2026-10-22T00:00:00Z"));
    check("files.move", await files.tool("move", { from: "note.txt", to: "moved.txt" }, "2026-10-22T00:00:00Z"));
    const removed = await files.tool("delete", { path: "moved.txt" }, "2026-10-22T00:00:00Z");
    check("files.delete", removed);
    const versions = await files.tool("history", { path: "moved.txt" }, "2026-10-22T00:00:00Z") as { versions: { version: string }[] };
    check("files.restore", await files.tool("restore", { path: "moved.txt", version: versions.versions[0]!.version }, "2026-10-22T00:00:00Z"));

    const eventsDir = join(dir, "events"); await mkdir(eventsDir);
    const events = createEvents({ dataDir: eventsDir,
      directory: async () => ({ modules: [{ id: "sample-id", name: "sample", status: "active", activeHash: "hash" }], tools: [{ target: "sample.receive", moduleId: "sample-id", hash: "hash", inputSchema: { type: "object", properties: { event: { type: "string" }, from: { type: "string" }, payload: { type: "string" } }, required: ["event", "from", "payload"] } }] }), call: async () => ({ callId: "call-1" }) });
    const caller: Caller = { kind: "module", module: "sample", moduleId: "sample-id", hash: "hash" };
    check("events.register", await events.handle("register", { emits: JSON.stringify([{ name: "changed", payload: { type: "object", required: ["id"], properties: { id: { type: "string" } } } }]) }, caller));
    check("events.subscriptions", await events.handle("subscriptions", {}, caller));
    check("events.subscribe", await events.handle("subscribe", { event: "sample.changed", tool: "receive" }, caller));
    check("events.emit", await events.handle("emit", { event: "changed", payload: JSON.stringify({ id: "1" }), key: "k" }, caller));
    check("events.unsubscribe", await events.handle("unsubscribe", { event: "sample.changed", tool: "receive" }, caller));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("actual notify handler results satisfy contracts for success, errors, empty lists, and nullable fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chrona-notify-contracts-"));
  const store = openStore(dir);
  try {
    const notify = createNotify({ store, publicUrl: null, listModules: async () => [], describeTools: async () => [], call: async () => ({ callId: "unused", status: "pending" }), status: async () => ({ callId: "unused", status: "pending" }) });
    const owner: NotifyCaller = { kind: "owner", via: "test" };
    const check = (name: string, output: unknown) => {
      const schema = moduleOutputSchema.parse(tools.get(name)?.output);
      expect(compileModuleOutput(schema).safeParse(output).success, `${name}: ${JSON.stringify(output)}`).toBe(true);
    };
    const now = new Date("2026-10-22T12:00:00.000Z");
    check("notify.send", notify.handle("send", { key: "k", level: "now", title: "title", body: "body" }, owner, now));
    check("notify.send", notify.handle("send", { key: "k", level: "now", title: "title", body: "body" }, owner, now));
    check("notify.list", notify.handle("list", {}, owner, now));
    check("notify.feedback", notify.handle("feedback", { id: "missing", feedback: "useful" }, owner, now));
    check("notify.feedback", notify.handle("feedback", { id: (notify.handle("list", {}, owner, now) as { items: { id: string }[] }).items[0]!.id, feedback: "useful" }, owner, now));
    notify.handle("import", { rows: JSON.stringify([{ id: "failed", idempotencyKey: "failed", title: "t", status: "failed", level: "now" }]) }, owner, now);
    check("notify.retry", notify.handle("retry", { id: "failed" }, owner, now));
    check("notify.retry", notify.handle("retry", { id: "missing" }, owner, now));
    check("notify.channel", notify.handle("channel", { channel: "chrona_qqbot", ready: true, at: now.toISOString() }, owner, now));
    check("notify.channel", notify.handle("channel", { channel: "chrona_qqbot", ready: false, at: "invalid" }, owner, now));
    check("notify.channel", notify.handle("channel", { channel: "chrona_qqbot", ready: false, at: "2020-01-01T00:00:00.000Z" }, owner, now));
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("memory-local outputs match conversation and preference handlers and reject malformed results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chrona-memory-contracts-"));
  const at = "2026-11-08T12:00:00.000Z";
  const check = (name: string, output: unknown, valid = true) => {
    const validator = compileModuleOutput(moduleOutputSchema.parse(tools.get(`memory-local.${name}`)?.output));
    expect(validator.safeParse(output).success, `${name}: ${JSON.stringify(output)}`).toBe(valid);
  };
  try {
    const store = preferences(dir);
    check("preferences", await store.list());
    const preference = await store.remember("简短中文", "ui", at);
    check("remember", preference);
    check("preferences", await store.list());
    check("forget", await store.forget(preference.id));
    // Missing preferences throw; SDK errors are not tool output values.
    await expect(store.forget(preference.id)).rejects.toThrow("Preference not found");
    const policy = conversationMemory({ recall: async () => ({ items: [{ id: "m1", content: "choice", at }] }), retain: async () => ({ id: "m2" }) });
    const snapshot = { session: { id: "s1", source: "web" }, messages: [{ direction: "in", text: "choice", at }], now: at, autoRecall: true, autoRetain: true, ending: true, recalled: false, retainedThrough: null };
    check("conversation-context", await policy.context(snapshot));
    check("conversation-context", await policy.context({ ...snapshot, autoRecall: false }));
    check("conversation-retain", await policy.retain(snapshot));
    check("conversation-retain", await policy.retain({ ...snapshot, autoRetain: false }));
    check("retain", { id: "m1" });
    check("recall", { items: [] });
    check("recall", { items: [{ id: "m1", content: "choice", score: 0.5 }, { id: "m2", content: "other", at, score: 1 }] });
    check("forget", { forgotten: false });
    check("conversation-retain", { retained: true }, false);
    check("conversation-retain", { retained: false, through: at, chars: 1 }, false);
    check("recall", { items: [{ id: "m1", content: "choice" }] }, false);
    check("remember", { ...preference, topic: "invalid" }, false);
    check("remember", { ...preference, lastUsedAt: at }, false);
    for (const name of ["conversation-context", "conversation-retain", "retain", "recall", "forget", "preferences", "remember"]) {
      check(name, { ignored: "no caller" });
      check(name, {}, false);
      check(name, { error: "Preference not found" }, false);
      check(name, { ignored: "unknown" }, false);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("QQ and web output contracts accept success, error, empty, and nullable shapes", () => {
  const fixtures: Record<string, unknown[]> = {
    "notify.send": [{ id: "n1", status: "queued", duplicate: false }, { id: "n1", status: "queued", duplicate: true }],
    "notify.channel": [{ ready: true }, { ignored: true }, { error: "invalid", message: "at must be a time" }],
    "notify.list": [{ items: [] }, { items: [{ id: "n1", moduleId: null, sessionId: null, level: "now", channel: null, status: "queued", title: "t", body: "b", format: "markdown", link: null, attempts: 0, lastError: null, createdAt: "2026-10-22T00:00:00.000Z", sentAt: null, feedback: null }] }],
    "notify.feedback": [{ notification: { id: "n1", moduleId: null, sessionId: null, level: "now", channel: null, status: "sent", title: "t", body: "b", format: "text", link: null, attempts: 0, lastError: null, createdAt: "2026-10-22T00:00:00.000Z", sentAt: null, feedback: "useful" } }, { error: "not_found", message: "Notification not found" }],
    "notify.retry": [{ notification: { id: "n1", moduleId: null, sessionId: null, level: "now", channel: null, status: "queued", title: "t", body: "b", format: "markdown", link: null, attempts: 0, lastError: null, createdAt: "2026-10-22T00:00:00.000Z", sentAt: null, feedback: null } }, { error: "conflict", message: "Only failed notifications may be retried" }],
    "qq.deliver": [{ outcome: "accepted", receiptRef: "chrona_qq:1" }, { outcome: "accepted", receiptRef: null }, { outcome: "rejected", retryable: false, error: "QQ bot is not configured" }, { outcome: "uncertain", error: "unknown receipt" }],
    "qq.reply": [{ delivered: "sent" }, { delivered: "unconfigured" }],
    "web.reply": [{ pages: 0 }, { pages: 2 }],
  };
  for (const [name, outputs] of Object.entries(fixtures)) {
    const schema = moduleOutputSchema.parse(tools.get(name)?.output);
    const validator = compileModuleOutput(schema);
    for (const output of outputs) expect(validator.safeParse(output).success, `${name}: ${JSON.stringify(output)}`).toBe(true);
  }
});
