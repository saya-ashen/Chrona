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
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-chat-")), now: () => new Date("2026-10-15T04:00:00Z"), publicUrl: null, chat: null, deliveries: [], chatTimeoutMs: 1 };
  chat = createChat(ports, async () => {});
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
