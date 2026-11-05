import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChat, chatImages } from "./chat";
import { createRuns, liveRuns } from "./runs";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, chat: ReturnType<typeof createChat>;
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "chat" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-chat-")), now: () => new Date("2026-10-15T04:00:00Z"), publicUrl: null, chatTimeoutMs: 1 };
  chat = createChat(ports, async () => {});
  const entry = await db.module.create({ data: { workspaceId, name: "qq", status: "active", activeHash: "h" } });
  await db.moduleVersion.create({ data: { moduleId: entry.id, hash: "h", status: "approved", source: "builtin", intent: {}, report: {}, manifest: { name: "qq", entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: ["chat.send"], tests: ["test.ts"] } } });
});
afterEach(async () => { liveRuns.clear(); await db.$disconnect(); });
const send = (text: string, extra: Partial<Parameters<typeof chat.handleMessage>[0]> = {}) => chat.handleMessage({ workspaceId, channel: "in_app", text, ...extra });
test("no address creates independent web sessions", async () => {
  const first = await send("One"), second = await send("Two");
  expect(first.sessionId).not.toBe(second.sessionId);
  const sessions = await db.session.findMany();
  expect(sessions).toHaveLength(2);
  for (const session of sessions) { expect(session.key).toMatch(/^web:/); expect(session.source).toBe("web"); expect(session.focus).toEqual(["files"]); }
});
test.each([
  ["qq:dm", "  哥本哈根申请  \n准备材料", "哥本哈根申请"],
  ["mcp:owner", "🦊".repeat(41), `${"🦊".repeat(40)}…`],
  ["web:owner", "a".repeat(40), "a".repeat(40)],
])("first message titles %s without overwriting later", async (key, text, title) => {
  const first = await chat.accept({ workspaceId, channel: "in_app", key, text });
  expect((await db.session.findUniqueOrThrow({ where: { id: first.sessionId } })).title).toBe(title);
  await chat.accept({ workspaceId, channel: "in_app", key, text: "另一条消息" });
  expect((await db.session.findUniqueOrThrow({ where: { id: first.sessionId } })).title).toBe(title);
});
test.each([
  ["web", "手动命名"], ["wake", null], ["module", "思考"],
])("messages preserve %s session title %p", async (source, title) => {
  const session = await db.session.create({ data: { workspaceId, key: `${source}:named`, source, title } });
  await chat.accept({ workspaceId, channel: "in_app", key: session.key, text: "新的消息" });
  expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).title).toBe(title);
});
test("same key resolves one active session across service instances and concurrent input", async () => {
  const other = createChat(ports, async () => {});
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? other : chat).submit({ workspaceId, channel: "in_app", key: "web:shared", text: `${i}` })));
  expect(await db.session.count({ where: { key: "web:shared", status: "active" } })).toBe(1);
  expect(new Set((await db.message.findMany()).map(message => message.sessionId)).size).toBe(1);
});
test("ended key starts a fresh context and explicit ids remain scoped", async () => {
  const first = await send("Old", { key: "qq:dm" });
  await db.session.update({ where: { id: first.sessionId }, data: { status: "ended", endedAt: ports.now() } });
  const second = await send("New", { key: "qq:dm" });
  expect(second.sessionId).not.toBe(first.sessionId);
  await expect(send("Ended", { sessionId: first.sessionId })).rejects.toMatchObject({ code: "not_found" });
  const foreign = await db.workspace.create({ data: { name: "Other" } });
  await expect(chat.submit({ workspaceId: foreign.id, channel: "in_app", sessionId: second.sessionId, text: "No" })).rejects.toMatchObject({ code: "not_found" });
});
test("running session receives injected input, another session queues independently", async () => {
  const first = await send("Start", { key: "web:shared" });
  const runs = createRuns(ports, workspaceId), active = (await runs.claimNext("foreground"))!;
  const injected: string[] = [];
  liveRuns.set(active.id, { done: new Promise(() => {}), inject: async text => { injected.push(text); }, abort: async () => {} });
  await chat.submit({ workspaceId, channel: "in_app", sessionId: first.sessionId, text: "Continue" });
  expect(injected).toEqual(["Continue"]);
  expect(await db.run.count()).toBe(1);
  await chat.submit({ workspaceId, channel: "in_app", text: "Separate" });
  expect(await db.run.count()).toBe(2);
});
test("external ids are idempotent and replies expose required session ids", async () => {
  const first = await send("Input", { key: "web:shared", externalId: "transport-1" });
  const duplicate = await send("Input", { key: "web:shared", externalId: "transport-1" });
  expect(duplicate).toEqual(first);
  expect(await db.message.count()).toBe(1);
  await db.message.create({ data: { workspaceId, sessionId: first.sessionId, direction: "out", channel: "in_app", text: "Reply" } });
  expect((await chat.messages(workspaceId, 50, first.sessionId)).every(message => message.sessionId === first.sessionId)).toBe(true);
});
test("inline images reject host paths, malformed bytes and excessive images", () => {
  const image = { name: "image.png", ref: null, mime: "image/png", size: 1, base64: "YQ==" };
  expect(chatImages([image])).toEqual([{ mime: "image/png", base64: "YQ==" }]);
  expect(() => chatImages([{ ...image, base64: "bad" }])).toThrow();
  expect(() => chatImages(Array(5).fill(image))).toThrow();
  expect(chatImages([{ ...image, base64: undefined }])).toEqual([]);
});
test("replies skip notifications the transport already delivered into the session", async () => {
  chat = createChat({ ...ports, chatTimeoutMs: 100 }, async () => {
    const inbound = await db.message.findFirstOrThrow({ where: { direction: "in" } });
    await db.message.create({ data: { workspaceId, sessionId: inbound.sessionId, direction: "out", channel: "in_app", text: "Reply", at: ports.now() } });
    await chat.recordMessage(workspaceId, { key: "qq:dm", channel: "in_app", text: "Delivered notification", externalId: "qq-sent-1" });
  });
  const result = await chat.handleMessage({ workspaceId, channel: "in_app", text: "Input", key: "qq:dm" });
  expect(result.messages.map(m => m.text)).toEqual(["Reply"]);
});
test.each([
  // idle minutes, context tokens of the last run, rotated
  [120, 40_000, true],
  [120, 10_000, false],
  [10, 40_000, false],
  [10, 120_000, true],
  [120, null, false],
] as const)("a QQ conversation idle %i min with %p context tokens rotates: %p", async (idleMinutes, tokens, rotated) => {
  const session = await db.session.create({ data: { workspaceId, key: "qq:dm", source: "qq", lastActivityAt: new Date(ports.now().getTime() - idleMinutes * 60_000) } });
  const run = await db.run.create({ data: { workspaceId, sessionId: session.id, lane: "foreground", trigger: "message", provider: "pi", prompt: "p", cwd: "/tmp", tokenHash: "h", status: "finished", endedAt: session.lastActivityAt } });
  if (tokens !== null) await db.audit.create({ data: { id: `provider:${run.id}:00000001`, workspaceId, kind: "provider_event", actorKey: "chrona", subjectId: run.id,
    details: { type: "usage", value: { scope: "run", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2, cost: 0, contextTokens: tokens, contextWindow: 272_000 } } } });
  const next = await send("Next", { key: "qq:dm" });
  expect(next.sessionId !== session.id).toBe(rotated);
  expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe(rotated ? "ended" : "active");
  expect(await db.audit.count({ where: { kind: "session_rotated", subjectId: session.id } })).toBe(rotated ? 1 : 0);
});
test.each([true, false])("rotation uses an unfamiliar entry's manifest (entry=%p)", async entry => {
  const module = await db.module.create({ data: { workspaceId, name: "transport", activeHash: "h" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "h", status: "approved", source: "builtin", intent: {}, report: {},
    manifest: { name: "transport", entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: entry ? ["chat.send"] : ["notify.send"], tests: ["test.ts"] } } });
  await db.workspace.update({ where: { id: workspaceId }, data: { settings: { sessions: { idleMinutes: 5, minContextTokens: 0, maxContextTokens: 100_000 } } } });
  const session = await db.session.create({ data: { workspaceId, key: "transport:dm", source: "web", entryModuleId: module.id,
    lastActivityAt: new Date(ports.now().getTime() - 30 * 60_000) } });
  expect((await send("Next", { key: "transport:dm" })).sessionId !== session.id).toBe(entry);
});
test("a conversation with work still queued is not rotated, and owner limits apply", async () => {
  await db.workspace.update({ where: { id: workspaceId }, data: { settings: { sessions: { idleMinutes: 5, minContextTokens: 0, maxContextTokens: 100_000 } } } });
  const session = await db.session.create({ data: { workspaceId, key: "qq:dm", source: "qq", lastActivityAt: new Date(ports.now().getTime() - 30 * 60_000) } });
  await createRuns(ports, workspaceId).enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "p" });
  expect((await send("Busy", { key: "qq:dm" })).sessionId).toBe(session.id);
  await db.run.updateMany({ where: { sessionId: session.id }, data: { status: "finished", endedAt: new Date(ports.now().getTime() - 30 * 60_000) } });
  await db.session.update({ where: { id: session.id }, data: { lastActivityAt: new Date(ports.now().getTime() - 30 * 60_000) } });
  expect((await send("Idle", { key: "qq:dm" })).sessionId).not.toBe(session.id);
});
