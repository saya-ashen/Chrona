import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleContext } from "./module-context";
import { propose } from "./module-proposal";
import { buildPending } from "./module-build";
import { moduleSupervisor } from "./module-supervisor";
import { autoRetain, memory, memoryInput } from "./memory";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const sandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
const tools: { name: string; description: string; visibility: string[]; parameters: { type: string; properties: Record<string, { type: string }> } }[] = ["retain", "recall", "forget"].map(name => ({ name, description: name, visibility: ["kernel"], parameters: { type: "object", properties: {
  content: { type: "string" }, source: { type: "string" }, at: { type: "string" }, query: { type: "string" }, limit: { type: "number" }, id: { type: "string" } } } }));
// A stand-in provider: the memory interface over a JSON-lines file; recall matches any query word.
tools.push(...["conversation-context", "conversation-retain"].map(name => ({ name, description: name, visibility: ["kernel"], parameters: { type: "object", properties: { snapshot: { type: "string" } } } })));
const fakeProvider = {
  "conversation.ts": await readFile(new URL("./external/memory-local/conversation.ts", import.meta.url), "utf8"),
  "module.json": JSON.stringify({ name: "memory-fake", entry: "index.ts", keepAlive: true, triggers: [], effects: [], contributes: { memory: { interface: 1, context: "conversation-context", afterRun: "conversation-retain" } }, tools, tests: ["test.ts"] }),
  "index.ts": `// @ts-expect-error SDK at run time
import { chrona, on } from "chrona";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationMemory } from "./conversation";
const file = join(chrona.paths.data, "memories.jsonl");
const all = () => existsSync(file) ? readFileSync(file, "utf8").split("\\n").filter(Boolean).map(line => JSON.parse(line)) : [];
async function invoke(id, args) {
  const event = { id };
  if (event.id === "retain") { const id = "m" + (all().length + 1); appendFileSync(file, JSON.stringify({ id, ...args }) + "\\n"); return { result: { id } }; }
  if (event.id === "recall") return { result: { items: all().filter(item => String(args.query).split(/\\s+/).some(word => word && item.content.includes(word))).map(item => ({ id: item.id, content: item.content, at: item.at })) } };
  const rest = all().filter(item => item.id !== args.id);
  writeFileSync(file, rest.map(item => JSON.stringify(item) + "\\n").join(""));
  return { result: { forgotten: true } };
}
const policy = conversationMemory({ recall: async args => (await invoke("recall", args)).result, retain: args => invoke("retain", args) });
on("tool", async event => {
  if (!event.caller) return { result: {} };
  if (event.id === "conversation-context") return { result: await policy.context(JSON.parse(event.args.snapshot)) };
  if (event.id === "conversation-retain") return { result: await policy.retain(JSON.parse(event.args.snapshot)) };
  return invoke(event.id, event.args);
});
`,
  "test.ts": "// Fake module: the end-to-end test is its check.\n",
};

if (!sandbox.health.available) console.info("SKIP memory end to end: module sandbox unavailable");
(sandbox.health.available ? test : test.skip)("memory forwards to the chosen provider; conversations recall once at the start and retain every four user messages", async () => {
  const dataDir = await mkdtemp("/tmp/chrona-memory-e2e-"), resources = join(dataDir, "external");
  for (const name of ["memory-fake", "memory-local"]) await mkdir(join(resources, name), { recursive: true });
  for (const [name, content] of Object.entries(fakeProvider)) await writeFile(join(resources, "memory-fake", name), content);
  // Optional memory-local remains uninstalled; selecting a provider never triggers an implicit install.
  await writeFile(join(resources, "memory-local", "module.json"), "{}");
  const db = testDb(), runtime = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined, dataDir });
  let at = Date.parse("2026-10-27T12:00:00Z");
  const ports: StewardPorts = { db, dataDir, now: () => new Date(at += 1000), publicUrl: null, moduleExternalResources: resources, sandbox: { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule } };
  try {
    const w = (await db.workspace.create({ data: { name: "memory" } })).id;
    const context = moduleContext(ports, w);
    await propose(context, { root: resources, dir: "memory-fake", intent: { changes: ["Install test memory provider"] } }, "user");
    await buildPending(context);
    expect(await db.module.findFirst({ where: { name: "memory-local" } })).toBeNull();
    expect(await db.module.findFirstOrThrow({ where: { name: "memory-fake" } })).toMatchObject({ status: "active" });
    await moduleSupervisor(ports).reconcile();
    const entry = await db.module.create({ data: { workspaceId: w, name: "new-entry", status: "active", activeHash: "h" } });
    await db.moduleVersion.create({ data: { moduleId: entry.id, hash: "h", status: "approved", source: "builtin", intent: {}, report: {}, manifest: { name: "new-entry", entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: ["chat.send"], tests: ["test.ts"] } } });
    const owner = { kind: "module" as const, module: "new-entry", moduleId: entry.id, hash: "h" };
    const call = (name: string, args: Record<string, unknown>) => memory.handle({ ports, workspaceId: w, caller: owner }, name, args);
    const session = await db.session.create({ data: { workspaceId: w, key: "new-entry:m", source: "web", entryModuleId: entry.id } });
    const say = (direction: "in" | "out", text: string) => db.message.create({ data: { workspaceId: w, sessionId: session.id, channel: "in_app", direction, text, at: new Date(at += 1000) } });

    // Off: no tools, no recall, nothing retained.
    expect((await memoryInput(ports, w, session, [])).hidden).toContain("m_memory_recall");
    await expect(call("recall", { query: "okx" })).rejects.toThrow("Memory is not enabled");
    await db.workspace.update({ where: { id: w }, data: { settings: { memory: { provider: "memory-fake" } } } });

    expect(await call("retain", { content: "okx 实验不要自动操作 token=abc123" })).toEqual({ id: "m1" });
    const found = await call("recall", { query: "okx" }) as { items: { id: string; content: string }[] };
    // Credentials are redacted before they reach the provider (checked first: toMatchObject rewrites what it matched).
    expect(found.items[0]!.content).not.toContain("abc123");
    expect(found.items).toMatchObject([{ id: "m1", content: expect.stringContaining("okx 实验") }]);

    // The first run of a conversation recalls with its latest words; later runs do not.
    await say("in", "okx 的实验还在跑吗");
    const input = await memoryInput(ports, w, session, await db.message.findMany({ where: { sessionId: session.id } }));
    expect(input.hidden).toEqual([]);
    expect(input.text).toContain("Recalled memories");
    expect(input.text).toContain("okx 实验不要自动操作");
    expect((await memoryInput(ports, w, session, [{ direction: "in", text: "okx", at: new Date() }])).text).not.toContain("Recalled memories (data;");
    // Build conversations are never recalled for.
    expect((await memoryInput(ports, w, { id: "b", source: "build" }, [{ direction: "in", text: "okx", at: new Date() }])).text).toBe("");

    // Retained every four user messages, from where the last retain stopped.
    await say("out", "还在跑");
    for (const text of ["第二条", "第三条"]) await say("in", text);
    expect(await autoRetain(ports, w, session.id)).toBe(false);
    await say("in", "第四条 计划工作台");
    expect(await autoRetain(ports, w, session.id)).toBe(true);
    expect(await autoRetain(ports, w, session.id)).toBe(false);
    const retained = await call("recall", { query: "计划工作台" }) as { items: { content: string }[] };
    expect(retained.items).toHaveLength(1);
    expect(retained.items[0]!.content).toContain("用户: okx 的实验还在跑吗\n\nChrona: 还在跑");

    expect(await call("forget", { id: "m1" })).toEqual({ forgotten: true });
    expect(await call("status", {})).toMatchObject({ provider: "memory-fake", available: true, autoRecall: true, autoRetain: true, last24h: { retained: 2, forgotten: 1 } });
    // Redact before truncation: a long credential must not lose its identifying prefix at the snapshot boundary.
    await memoryInput(ports, w, session, [{ direction: "in", text: "padding ".repeat(6000), at: new Date() }, { direction: "in", text: `token=${"SYNTHETIC-CREDENTIAL".repeat(2000)}`, at: new Date() }]);
    const boundedCall = await db.moduleInvocation.findFirstOrThrow({ where: { tool: "conversation-context" }, orderBy: { createdAt: "desc" } });
    const boundedMessages = JSON.parse((boundedCall.args as { snapshot: string }).snapshot).messages as { text: string }[];
    expect(boundedMessages.reduce((total, message) => total + message.text.length, 0)).toBeLessThanOrEqual(20_000);
    expect(JSON.stringify(boundedMessages)).not.toContain("SYNTHETIC-CREDENTIAL");
    // Disabling automatic operations never discloses conversation text to the selected application.
    await db.workspace.update({ where: { id: w }, data: { settings: { memory: { provider: "memory-fake", autoRecall: false, autoRetain: false } } } });
    await memoryInput(ports, w, session, [{ direction: "in", text: "DO NOT DISCLOSE", at: new Date() }]);
    const contextCall = await db.moduleInvocation.findFirstOrThrow({ where: { tool: "conversation-context" }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse((contextCall.args as { snapshot: string }).snapshot).messages).toEqual([]);
    const retainCount = await db.moduleInvocation.count({ where: { tool: "conversation-retain" } });
    expect(await autoRetain(ports, w, session.id, true)).toBe(false);
    expect(await db.moduleInvocation.count({ where: { tool: "conversation-retain" } })).toBe(retainCount);
    // Legacy providers retain their manual API and receive no automatic conversation snapshot.
    const providerModule = await db.module.findFirstOrThrow({ where: { workspaceId: w, name: "memory-fake" } });
    const version = await db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: providerModule.id, hash: providerModule.activeHash! } } });
    await db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...JSON.parse(fakeProvider["module.json"]), contributes: { memory: { interface: 1 } } } } });
    const invocationCount = await db.moduleInvocation.count();
    expect(await memoryInput(ports, w, session, [{ direction: "in", text: "private new message", at: new Date() }])).toEqual({ hidden: [], text: "" });
    expect(await autoRetain(ports, w, session.id, true)).toBe(false);
    expect(await db.moduleInvocation.count()).toBe(invocationCount);
    expect(await call("recall", { query: "计划工作台" })).toMatchObject({ items: [expect.objectContaining({ content: expect.stringContaining("计划工作台") })] });
    // A provider that is gone never stops a conversation.
    await db.module.updateMany({ where: { name: "memory-fake" }, data: { status: "paused" } });
    expect((await memoryInput(ports, w, session, [])).hidden).toContain("m_memory_recall");
    expect(await autoRetain(ports, w, session.id)).toBe(false);
  } finally {
    await moduleSupervisor(ports).stop();
    await db.$disconnect();
    await rm(dataDir, { recursive: true, force: true });
  }
}, 60_000);
