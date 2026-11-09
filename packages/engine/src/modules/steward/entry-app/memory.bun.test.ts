import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreferences } from "./preferences";
import { conversationMemory, memoryForget, memoryPreferences, memoryView, selectedMemory, type MemoryJournal } from "./memory";

type Args = Record<string, unknown>;
const now = "2026-11-08T00:00:00.000Z";
function contracts(module = "memory-local") {
  return [["conversation-context", "snapshot"], ["conversation-retain", "snapshot"], ["recall", "query"], ["forget", "id"], ["preferences", undefined]].map(([name, argument]) => ({
    target: `${module}.${name}`, moduleId: "approved-current-id", hash: "current-hash", inputSchema: { type: "object", properties: argument ? { [argument]: { type: "string" } } : {}, required: argument ? [argument] : [] },
  }));
}
function fixture() {
  const calls: { target: string; args: Args }[] = [];
  const config = { provider: "memory-local" as string | null, autoRecall: true, autoRetain: true };
  let tools = contracts();
  const call = async (target: string, args: Args = {}): Promise<unknown> => {
    calls.push({ target, args });
    if (target === "web.settings" || target === "qq.settings") return config;
    if (target === "modules.tools") return tools;
    if (target === "memory-local.conversation-context") return { text: "local context", recalled: true };
    if (target === "memory-local.conversation-retain") return { retained: true, through: JSON.parse(String(args.snapshot)).messages.at(-1)?.at, chars: 3 };
    if (target === "memory-local.recall") return { items: ["memory"] };
    if (target === "memory-local.forget") return { forgotten: true };
    if (target === "memory-local.preferences") return [{ id: "p", text: "中文" }];
    throw new Error(`Unexpected ${target}`);
  };
  return { config, calls, call, tools, setTools: (value: typeof tools) => { tools = value; } };
}
const session = () => ({ id: "web-agent:test", source: "web", memory: undefined as MemoryJournal | undefined, messages: [
  { direction: "in", text: "Choose local files", createdAt: now },
  { direction: "out", text: "Okay", createdAt: "2026-11-08T00:00:01.000Z" },
] });

test("selection uses own settings and current exact tool schemas, without contributions", async () => {
  const f = fixture();
  expect(await selectedMemory(f.call, "qq")).toMatchObject({ module: "memory-local", autoRecall: true, autoRetain: true, available: true });
  expect(f.calls).toEqual([{ target: "qq.settings", args: {} }, { target: "modules.tools", args: { query: "memory-local" } }]);
  for (const modify of [
    () => f.setTools(contracts("other")),
    () => f.setTools(contracts("memory-local-extra")),
    () => f.setTools(contracts().map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, required: ["caller"] } }))),
    () => f.setTools(contracts().map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: { snapshot: { type: "object" } } } }))),
    ...[{ enum: ["unsupported"] }, { const: "unsupported" }, { maxLength: 1 }].map(constraint => () => f.setTools(contracts().map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: { snapshot: { type: "string", ...constraint } } } })))),
    () => f.setTools(contracts().map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, allOf: [{ required: ["caller"] }] } }))),
    () => f.setTools(contracts().map(tool => ({ ...tool, moduleId: "" }))),
  ]) {
    modify();
    expect((await selectedMemory(f.call, "web")).available).toBe(false);
    expect(await conversationMemory(f.call, "web", session(), "context", now)).toBe("");
  }
  expect(f.calls.some(item => item.target.endsWith(".conversation-context"))).toBe(false);
});

test("selection changes and provider absence stay visible without changing configured booleans", async () => {
  const f = fixture();
  f.config.autoRecall = false;
  f.setTools([]);
  expect(await memoryView(f.call, "web")).toEqual({ provider: "memory-local", available: false, autoRecall: false, autoRetain: true });
  expect(await memoryView(f.call, "web", "local")).toEqual({ items: [] });
  await expect(memoryForget(f.call, "web", "id")).rejects.toThrow("not available");
  expect(await memoryPreferences(f.call, "web")).toEqual([]);
  f.config.provider = null; f.calls.length = 0;
  expect(await memoryView(f.call, "web")).toEqual({ provider: null, available: false, autoRecall: false, autoRetain: true });
  expect(f.calls).toEqual([{ target: "web.settings", args: {} }]);
});

test("independent recall and retain opt-outs survive real preference store restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "entry-memory-"));
  try {
    const f = fixture();
    await createPreferences(dir).update({ provider: "memory-local", autoRecall: false, autoRetain: true });
    const call = (target: string, args?: Args) => target === "web.settings" ? createPreferences(dir).read() : f.call(target, args);
    const s = session();
    expect(await conversationMemory(call, "web", s, "context", now)).toBe("");
    await conversationMemory(call, "web", s, "retain", now);
    expect(s.memory?.retainedThrough).toBe(s.messages[1]!.createdAt);
    expect(f.calls.some(item => item.target.endsWith(".conversation-context"))).toBe(false);
    await createPreferences(dir).update({ autoRecall: true, autoRetain: false });
    expect(await conversationMemory(call, "web", s, "context", now)).toContain("local context");
    const retained = f.calls.filter(item => item.target.endsWith(".conversation-retain")).length;
    await conversationMemory(call, "web", s, "end", now);
    expect(f.calls.filter(item => item.target.endsWith(".conversation-retain"))).toHaveLength(retained);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("snapshot stays redacted and bounded; successful receipts alone advance watermarks", async () => {
  const f = fixture(), s = session();
  s.messages[0]!.text = "A".repeat(21_000) + "\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz123456789";
  await conversationMemory(f.call, "web", s, "retain", now);
  const sent = JSON.parse(String(f.calls.at(-1)!.args.snapshot));
  expect(sent.messages.reduce((sum: number, item: { text: string }) => sum + item.text.length, 0)).toBeLessThanOrEqual(20_000);
  expect(JSON.stringify(sent)).not.toContain("abcdefghijklmnopqrstuvwxyz123456789");
  expect(JSON.stringify(sent)).toContain("[Redacted]");
  const watermark = s.memory!.retainedThrough;
  const later = "2026-11-08T00:00:02.000Z";
  s.messages.push({ direction: "in", text: "next", createdAt: later });
  for (const receipt of [{ retained: false }, { retained: true, through: "2099-01-01T00:00:00Z", chars: 2 }, { retained: true, through: later, chars: 20_001 }]) {
    await conversationMemory(async (target, args) => target.endsWith(".conversation-retain") ? receipt : f.call(target, args), "web", s, "retain", now);
    expect(s.memory!.retainedThrough).toBe(watermark);
  }
  expect(await conversationMemory(async () => { throw new Error("optional unavailable"); }, "web", s, "context", now)).toBe("");
  expect(s.memory!.retainedThrough).toBe(watermark);
  await conversationMemory(f.call, "web", s, "end", now);
  expect(s.memory!.retainedThrough).toBe(later);
  expect(JSON.parse(String(f.calls.at(-1)!.args.snapshot))).toMatchObject({ ending: true, retainedThrough: watermark, messages: [{ text: "next" }] });
});

test("manual memory operations require their own discovered exact contracts", async () => {
  const f = fixture();
  expect(await memoryView(f.call, "web", "local")).toEqual({ items: ["memory"] });
  expect(await memoryForget(f.call, "web", "id")).toEqual({ forgotten: true });
  expect(await memoryPreferences(f.call, "web")).toEqual([{ id: "p", text: "中文" }]);
  f.setTools(f.tools.filter(tool => !tool.target.endsWith(".forget")));
  await expect(memoryForget(f.call, "web", "id")).rejects.toThrow();
});
