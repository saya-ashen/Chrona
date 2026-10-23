import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import type { ProviderRunInput } from "@chrona/contracts/steward";
import { createQqBotHandler, createQqBotState, createRelay, downloadQqAttachment, qqReplyText, testDb, type QqC2cMessage } from "@chrona/engine/test-support";

import { ownerApi } from "./owner-api";

// The qq module's Chrona side, end to end through the real owner API routes (the QQ transport is faked).
async function fixture(reply: (input: ProviderRunInput, service: ReturnType<typeof createStewardService>) => Promise<void> = async () => {}) {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-qq-relay-"));
  const now = () => new Date("2026-10-15T04:00:00Z");
  await db.workspace.create({ data: { id: "w", name: "test" } });
  const prompts: ProviderRunInput[] = [];
  const ports: StewardPorts = { db, dataDir, now, publicUrl: "https://chrona.example", deliveries: [], chat: null,
    provider: { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start(input) {
      prompts.push(input);
      return { inject: async () => {}, abort: async () => {}, done: (async () => { await reply(input, service); return { outcome: "finished" as const, sessionId: null, error: null }; })() };
    } } };
  const service = createStewardService(ports);
  ports.owner = ownerApi(ports, service, () => {});
  const relay = createRelay({ owner: request => ports.owner!("w", request), publicUrl: ports.publicUrl,
    download: a => downloadQqAttachment(a, async (_url, init) => { expect(init?.redirect).toBe("error"); return new Response("abc", { headers: { "content-type": a.mime } }); }), pollMs: 5 });
  return { db, dataDir, now, prompts, service, relay };
}

test("QQ attachments and quoted replies stay in qq:dm and link to app content", async () => {
  let replyFiles: string[] = [];
  const f = await fixture(async (input, service) => { await service.tools.call(input.token, "chrona_reply", { text: "Stored reply", files: replyFiles }); });
  const module = await f.db.module.create({ data: { workspaceId: "w", name: "files", status: "active", activeHash: "hash" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "hash", status: "active", intent: "fixture", source: "user", report: {}, manifest: { name: "files", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], content: true } } });
  const state = createQqBotState(join(f.dataDir, "qq"), "12345"), challenge = await state.createChallenge({ workspaceId: "w", now: f.now() });
  await state.redeem("owner", challenge.code, f.now());
  const sends: { content: string; image: boolean }[] = [];
  const handler = createQqBotHandler({ state, now: f.now, chat: { handleMessage: f.relay.chat }, resolveApproval: f.relay.resolveApproval, enqueueFinal: async () => {},
    reply: async (_openid, _id, content, _seq, message) => {
      sends.push({ content, image: Boolean(message?.messageId && await f.relay.replyImage(message.messageId)) });
      if (message?.messageId) await f.relay.setExternalId(message.messageId, `qq:out:sent-${sends.length}`);
    } });
  const message = (id: string, extra: Partial<QqC2cMessage> = {}): QqC2cMessage => ({ id, openid: "owner", content: "", quoted: "", timestamp: f.now().toISOString(), ...extra });
  try {
    await handler.onMessage(message("first", { attachments: [{ url: "https://multimedia.nt.qq.com/a", name: "picture.png", mime: "image/png" }] }));
    expect(f.prompts[0]!.images).toEqual([{ mime: "image/png", base64: "YWJj" }]);
    const first = await f.db.message.findFirstOrThrow({ where: { direction: "in" } });
    expect(first).toMatchObject({ channel: "chrona_qqbot", externalId: "first" });
    const attachment = (first.attachments as { ref: string }[])[0]!;
    expect(attachment.ref).toStartWith("files/uploads/");
    expect(await readFile(join(f.dataDir, "platform", "content", module.id, attachment.ref.slice(6)), "utf8")).toBe("abc");
    expect(await f.db.session.findUnique({ where: { id: first.sessionId } })).toMatchObject({ key: "qq:dm", source: "qq" });
    const outbound = await f.db.message.findFirstOrThrow({ where: { direction: "out" } });
    expect(outbound.externalId).toBe("qq:out:sent-1");
    await f.db.module.update({ where: { id: module.id }, data: { status: "paused" } });
    await f.service.forWorkspace("w").content.upload(module.id, "output", "chart.png", new Uint8Array([1, 2, 3]));
    await f.db.module.update({ where: { id: module.id }, data: { status: "active" } });
    replyFiles = ["files/output/chart.png"];
    await handler.onMessage(message("second", { content: "about that", quotedId: "sent-1" }));
    const second = await f.db.message.findFirstOrThrow({ where: { externalId: "second" } });
    expect(second.sessionId).toBe(first.sessionId); expect(second.quotedMessageId).toBe(outbound.id);
    expect(sends[1]!.content).toContain(`/api/steward/apps/${module.id}/raw?workspaceId=w&path=output%2Fchart.png`);
    // The engine labels reply files application/octet-stream: keep a download link rather than upload undeclared bytes.
    expect(sends[1]!.image).toBe(false);
  } finally { await handler.drain(); await f.db.$disconnect(); }
});

test("/new ends the qq:dm session; the next message starts a new one", async () => {
  const f = await fixture();
  const first = await f.relay.chat({ workspaceId: "w", key: "qq:dm", channel: "chrona_qqbot", text: "hi", externalId: "m1" });
  expect(await f.relay.chat({ workspaceId: "w", key: "qq:dm", channel: "chrona_qqbot", text: " /new ", externalId: "m2" })).toEqual({ reply: "【Chrona】已开始新会话。" });
  const next = await f.relay.chat({ workspaceId: "w", key: "qq:dm", channel: "chrona_qqbot", text: "again", externalId: "m3" });
  expect(next.sessionId).not.toBe(first.sessionId);
  expect(await f.db.session.count({ where: { key: "qq:dm", status: "ended" } })).toBe(1);
  await f.db.$disconnect();
});

test("file links resolve module names to app ids; unresolved references stay honest", () => {
  const apps = [{ id: "app-id", name: "files" }];
  const message = { text: "Ready", attachments: [{ name: "a b.pdf", ref: "files/out/a b.pdf", mime: "application/pdf", size: 3 }] };
  expect(qqReplyText(message, "https://chrona.example/", "w", apps)).toContain("https://chrona.example/api/steward/apps/app-id/raw?workspaceId=w&path=out%2Fa+b.pdf");
  const page = { ...message, attachments: [{ ...message.attachments[0]!, name: "README.md", ref: "files/README.md" }] };
  expect(qqReplyText(page, "https://chrona.example", "w", apps)).toContain("总览：https://chrona.example/apps/app-id?path=README.md");
  expect(qqReplyText(message, null, "w", apps)).toContain("请在 Chrona 网页查看附件");
  expect(qqReplyText(message, "https://chrona.example", "w")).toContain("请在 Chrona 网页查看附件");
});

test("late replies: only this run's unsent replies, until the run ends", async () => {
  const f = await fixture(), at = new Date("2026-10-15T04:00:00Z");
  const session = await f.db.session.create({ data: { workspaceId: "w", key: "qq:dm", source: "qq" } });
  const run = await f.db.run.create({ data: { workspaceId: "w", sessionId: session.id, lane: "foreground", trigger: "message", status: "running", provider: "pi", tokenHash: "h", prompt: "p", cwd: "/x", deadlineAt: at, createdAt: at } });
  const reply = async (text: string, externalId: string | null = null) => {
    const m = await f.db.message.create({ data: { workspaceId: "w", channel: "chrona_qqbot", direction: "out", sessionId: session.id, text, externalId, at } });
    await f.db.audit.create({ data: { workspaceId: "w", actorKey: "chrona", kind: "run_reply", subjectId: run.id, details: { messageId: m.id } } });
    return m.id;
  };
  await reply("already sent", "qq:out:x");
  const stream = f.relay.later(run.id, "w")[Symbol.asyncIterator]();
  const pending = stream.next(); await reply("second");
  expect((await pending).value).toMatchObject({ reply: "second", sessionId: session.id });
  await f.db.run.update({ where: { id: run.id }, data: { status: "finished" } });
  expect((await stream.next()).done).toBe(true); await f.db.$disconnect();
});
