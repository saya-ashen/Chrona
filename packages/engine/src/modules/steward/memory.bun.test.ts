import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { selectedMemory, conversationMemory, memoryView, memoryForget, type MemoryJournal } from "./entry-app/memory";
import { createAgentConversations } from "./entry-app/conversations";
import { parseSnapshot } from "./applications/memory-local/conversation";
import { preferences } from "./applications/memory-local/preferences";
import { kernelAgentInputs, kernelAgentOutputs, moduleManifestSchema } from "@chrona/contracts/steward";

type Args = Record<string, unknown>;
const dirs: string[] = [];
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }); });
async function directory() { const path = await mkdtemp("/tmp/chrona-entry-memory-"); dirs.push(path); return path; }
const at = "2026-11-08T12:00:00.000Z";
const memoryTools = [["conversation-context", "snapshot"], ["conversation-retain", "snapshot"], ["recall", "query"], ["forget", "id"], ["preferences", undefined]].map(([name, argument]) => ({
  target: `memory-local.${name}`, moduleId: "memory-local-id", hash: "approved",
  inputSchema: { type: "object", properties: argument ? { [argument]: { type: "string" } } : {}, required: argument ? [argument] : [], additionalProperties: false },
}));
function fixture(values: Args = { provider: "memory-local" }) {
  const calls: { target: string; args: Args }[] = [];
  const session: { id: string; source: string; messages: { direction: string; text: string; createdAt: string }[]; memory?: MemoryJournal } = { id: "web-agent:local", source: "web", messages: [{ direction: "in", text: "past choice", createdAt: at }] };
  const call = async (target: string, args: Args = {}): Promise<unknown> => {
    calls.push({ target, args });
    if (["qq.settings", "web.settings", "mcp.settings"].includes(target)) return { provider: null, autoRecall: true, autoRetain: true, ...values };
    if (target === "modules.describe") return { items: args.query === "memory-local" ? memoryTools : [], nextCursor: null };
    if (target.endsWith(".conversation-context")) return { text: "Earlier choice: local files", recalled: true };
    if (target.endsWith(".conversation-retain")) return { retained: true, through: JSON.parse(String(args.snapshot)).messages.at(-1)?.at, chars: 10 };
    if (target.endsWith(".recall")) return { items: [{ id: "memory-id", content: "remembered" }] };
    if (target.endsWith(".forget")) return { forgotten: true };
    throw new Error(`Unexpected call ${target}`);
  };
  return { calls, session, call };
}
test("entry selects its app-owned preference and discovers currently approved tool contracts", async () => {
  const f = fixture();
  expect(await selectedMemory(f.call, "qq")).toMatchObject({ module: "memory-local", available: true });
  expect(f.calls).toEqual([{ target: "qq.settings", args: {} }, { target: "modules.describe", args: { query: "memory-local" } }]);
  const off = fixture({});
  expect(await selectedMemory(off.call, "web")).toMatchObject({ module: null, available: false });
  expect(off.calls.map(call => call.target)).toEqual(["web.settings"]);
  const missing = fixture({ provider: "not-installed" });
  expect(await selectedMemory(missing.call, "mcp")).toMatchObject({ module: "not-installed", available: false });
  expect(missing.calls).toEqual([{ target: "mcp.settings", args: {} }, { target: "modules.describe", args: { query: "not-installed" } }]);
});
test.each([null, {}, { type: "object", properties: {}, required: [] }, { type: "object", properties: { snapshot: { type: "number" } }, required: ["snapshot"] }, { type: "object", properties: { snapshot: { type: "string", enum: ["fixed"] } }, required: ["snapshot"] }])("entry rejects incompatible memory tool contracts: %j", async inputSchema => {
  const f = fixture();
  const call = (target: string, args?: Args) => target === "modules.describe" ? Promise.resolve({ items: memoryTools.map(tool => ({ ...tool, inputSchema })), nextCursor: null }) : f.call(target, args);
  expect(await selectedMemory(call, "web")).toMatchObject({ module: "memory-local", available: false });
});
test.each(["context", "retain"] as const)("entry honors %s opt-out without sending conversation data", async operation => {
  const f = fixture({ provider: "memory-local", autoRecall: false, autoRetain: false });
  expect(await conversationMemory(f.call, "web", f.session, operation, at)).toBe("");
  expect(f.calls.map(call => call.target)).toEqual(["web.settings", "modules.describe"]);
  expect(f.session.memory).toBeUndefined();
});
test("entry sanitizes before truncation, bounds snapshots, and advances only validated receipts", async () => {
  const f = fixture();
  f.session.messages = Array.from({ length: 205 }, (_, i) => ({ direction: "in", text: i === 204 ? `Bearer ${"x".repeat(25000)} tail` : `msg${i}`, createdAt: at }));
  const context = await conversationMemory(f.call, "web", f.session, "context", at);
  expect(context).toContain("not authorization");
  expect(f.session.memory?.recalled).toBe(true);
  const snapshot = JSON.parse(String(f.calls.at(-1)!.args.snapshot));
  expect(snapshot.messages).toHaveLength(200);
  expect(snapshot.messages.map((message: { text: string }) => message.text).join("")).toContain("[Redacted]");
  expect(snapshot.messages.map((message: { text: string }) => message.text).join("")).not.toContain("x".repeat(100));
  expect(snapshot.messages.reduce((n: number, message: { text: string }) => n + message.text.length, 0)).toBeLessThanOrEqual(20_000);
  await conversationMemory(f.call, "web", f.session, "retain", at);
  expect(f.session.memory?.retainedThrough).toBe(at);
  const failed = fixture();
  const invalid = async (target: string, args?: Args) => target.endsWith(".conversation-retain") ? { retained: true, through: "2099-01-01T00:00:00.000Z", chars: 1 } : failed.call(target, args);
  await conversationMemory(invalid, "web", failed.session, "retain", at);
  expect(failed.session.memory?.retainedThrough).toBeNull();
  const unavailable = async (target: string, args?: Args) => { if (target.startsWith("memory-local.")) throw new Error("unavailable"); return failed.call(target, args); };
  expect(await conversationMemory(unavailable, "web", failed.session, "context", at)).toBe("");
  expect(failed.session.memory?.recalled).toBe(false);
});
test("Web/MCP manual memory operations route to the selected app with no identity arguments", async () => {
  const f = fixture();
  expect(await memoryView(f.call, "mcp")).toMatchObject({ provider: "memory-local", available: true });
  expect(await memoryView(f.call, "web", "choice")).toEqual({ items: [{ id: "memory-id", content: "remembered" }] });
  expect(await memoryForget(f.call, "web", "memory-id")).toEqual({ forgotten: true });
  expect(f.calls.filter(call => call.target.startsWith("memory-local."))).toEqual([{ target: "memory-local.recall", args: { query: "choice" } }, { target: "memory-local.forget", args: { id: "memory-id" } }]);
  const disabled = fixture({});
  expect(await memoryView(disabled.call, "web", "choice")).toEqual({ items: [] });
  await expect(memoryForget(disabled.call, "web", "id")).rejects.toThrow("not available");
});
test("memory snapshot validates external data and attributes source to the real caller", () => {
  const snapshot = { session: { id: "s", source: "spoofed" }, messages: [{ direction: "in", text: "choice", at }], now: at, autoRecall: true, autoRetain: true, ending: false, recalled: false, retainedThrough: null };
  expect(parseSnapshot(JSON.stringify(snapshot), "qq").session).toEqual({ id: "s", source: "qq" });
  for (const invalid of ["null", "{}", ...[
    { session: null }, { session: { id: 42 } }, { session: { id: "x".repeat(201) } },
    { autoRetain: "yes" }, { now: 42 }, { retainedThrough: "invalid" },
    { messages: [null] }, { messages: [{ direction: "system", text: "x", at }] },
    { messages: [{ direction: "in", text: "x", at: 42 }] },
    { messages: [{ direction: "in", text: "x".repeat(20001), at }] },
  ].map(fields => JSON.stringify({ ...snapshot, ...fields }))]) expect(() => parseSnapshot(invalid, "web")).toThrow();
});
test("preferences are private application files, persistent, deduplicated and individually removable", async () => {
  const dataDir = await directory(), store = preferences(dataDir);
  expect(await store.list()).toEqual([]);
  const preference = await store.remember("简短中文", "general", at);
  expect(await store.remember("简短中文", "general", at)).toEqual(preference);
  expect(await preferences(dataDir).list()).toEqual([preference]);
  expect(await store.forget(preference.id)).toEqual({ forgotten: true });
  expect(await store.list()).toEqual([]);
  await expect(store.forget(preference.id)).rejects.toThrow("not found");
  await writeFile(join(dataDir, "preferences.json"), '{"bad":"journal"}');
  await expect(store.list()).rejects.toThrow("Invalid memory preference journal");
});
test.each(["web", "mcp", "qq"] as const)("%s retains its own journal/context and persists memory receipts across restart", async source => {
  const dataDir = await directory(), f = fixture(), replies: Args[] = [], prompts: string[] = [];
  const admissions: { args: Args; key?: string }[] = [];
  let failRun = true, active = true, clock = 0;
  const call = async (target: string, args: Args = {}, options: { key?: string } = {}): Promise<unknown> => {
    if (target === "agent.run") {
      const input = kernelAgentInputs.run.parse(args);
      expect(options.key).toStartWith(`${source}-run:`);
      admissions.push({ args, key: options.key }); prompts.push(input.prompt);
      if (failRun) { failRun = false; throw new Error("lost run receipt"); }
      return kernelAgentOutputs.run.parse({ runId: "run-1", contextId: "private-context", status: "running", active: true });
    }
    if (target === "agent.read") {
      expect(kernelAgentInputs.read.parse(args)).toMatchObject({ runId: "run-1", limit: 100 });
      return kernelAgentOutputs.read.parse({ run: { runId: "run-1", contextId: "private-context", status: active ? "running" : "finished", active }, items: [], nextCursor: null, ended: !active, transcript: [{ at, kind: "text", text: "done" }], interactions: [] });
    }
    return f.call(target, args);
  };
  const options = { source, dataDir, call, tools: [{ moduleId: "memory-local-id", tool: "recall" }], reply: (reply: Args) => { replies.push(reply); }, now: () => new Date(Date.parse(at) + clock++ * 1000) };
  let app = createAgentConversations(options);
  await expect(app.send({ text: "remember this", requestKey: "one" })).rejects.toThrow("lost run receipt");
  app = createAgentConversations(options);
  const sent = await app.send({ text: "remember this", requestKey: "one" });
  expect(prompts).toHaveLength(2); expect(prompts[0]).toBe(prompts[1]);
  expect(admissions[1]).toEqual(admissions[0]);
  expect(prompts[0]).toContain("Earlier choice");
  expect(f.calls.filter(call => call.target.endsWith(".conversation-context"))).toHaveLength(1);
  active = false; await app.poll();
  expect(replies).toHaveLength(1);
  const db = new Database(join(dataDir, "conversations/sessions.sqlite"));
  const saved = db.query<{ data: string }, [string]>("SELECT data FROM conversations WHERE id=?").get(sent.sessionId)!;
  const state = JSON.parse(saved.data);
  expect(state).toMatchObject({ source, contextId: "private-context", memory: { provider: "memory-local", recalled: true, retainedThrough: state.messages.at(-1).createdAt } });
  app = createAgentConversations(options); await app.poll();
  expect(replies).toHaveLength(1);
  await app.update(sent.sessionId, { status: "ended" });
  expect(JSON.parse(String(f.calls.filter(call => call.target.endsWith(".conversation-retain")).at(-1)!.args.snapshot)).ending).toBe(true);
  expect(f.calls.every(call => !call.target.startsWith("memory."))).toBe(true);
  try {
    for (const memory of [null, { provider: 42, recalled: false, retainedThrough: null }, { provider: "memory-local", recalled: false, retainedThrough: "invalid" }]) {
      db.query("UPDATE conversations SET data=? WHERE id=?").run(JSON.stringify({ ...state, memory }), sent.sessionId);
      await expect(createAgentConversations(options).list()).rejects.toThrow("Web conversation journal is invalid");
    }
  } finally { db.close(); }
});
test("memory-local SDK accepts direct callers and rejects kernel/lifecycle owner calls without opening a memory DB", async () => {
  const dataDir = await directory(), script = join(dataDir, "audiences.ts");
  await writeFile(script, `
    import { strict as assert } from "node:assert";
    import { startModule } from ${JSON.stringify(join(import.meta.dir, "../../../../integrations/src/steward/module-sdk/testing.ts"))};
    const app = await startModule(process.env.CHRONA_MODULE + "/index.ts");
    const now = ${JSON.stringify(at)};
    async function tool(id, args, caller) { return app.send({ trigger: { kind: "tool", id, args, caller, firedAt: now }, now, params: {} }); }
    try {
      const owner = { kind: "owner", via: "mcp" }, module = { kind: "module", module: "web", moduleId: "real-web", hash: "approved" };
      assert.ok("error" in await tool("preferences", {}, { kind: "kernel" }));
      assert.ok("error" in await tool("conversation-context", { snapshot: "{}" }, owner));
      const remembered = await tool("remember", { text: "short Chinese", source: "forged", at: "2099-01-01" }, module);
      assert.ok(!remembered.error, JSON.stringify(remembered));
      const preference = remembered.result.result;
      assert.equal(preference.createdAt, now);
      const listed = await tool("preferences", {}, owner);
      assert.equal(listed.result.result[0].id, preference.id);
      assert.equal((await tool("forget", { id: preference.id }, { kind: "provider", runId: "real-run" })).result.result.forgotten, true);
      const snapshot = { session: { id: "web-agent:test", source: "forged" }, messages: [], now, autoRecall: false, autoRetain: false, ending: false, recalled: false, retainedThrough: null };
      assert.equal((await tool("conversation-retain", { snapshot: JSON.stringify(snapshot) }, module)).result.result.retained, false);
    } finally { await app.stop(); }
  `);
  const child = Bun.spawn([process.execPath, "--no-install", script], { env: { ...process.env, CHRONA_MODULE: join(import.meta.dir, "applications/memory-local"), CHRONA_DATA: dataDir, CHRONA_CONTENT: dataDir }, stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  expect(await child.exited, stderr).toBe(0);
  await expect(access(join(dataDir, "memory.db"))).rejects.toThrow();
});
test("memory-local declares direct audiences and entry memory selection is private app configuration", async () => {
  const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(import.meta.dir, "applications/memory-local/module.json"), "utf8")));
  for (const tool of manifest.tools) {
    const expected: typeof tool.visibility = tool.name.startsWith("conversation-") ? ["modules"] : tool.name.startsWith("correct-") ? ["owner"] : ["modules", "owner", "provider"];
    expect(tool.visibility).toEqual(expected);
  }
  for (const app of ["applications/web", "applications/qq"]) {
    const entry = moduleManifestSchema.parse(JSON.parse(await readFile(join(import.meta.dir, app, "module.json"), "utf8")));
    expect(entry).not.toHaveProperty("settings");
    expect(entry.tools.find(tool => tool.name === "settings")).toMatchObject({ visibility: expect.arrayContaining(["owner"]) });
    expect(entry.uses).not.toContain("modules.contributions");
    expect(entry.uses).not.toContain("settings.preferences");
  }
});
