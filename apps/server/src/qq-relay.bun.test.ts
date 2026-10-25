import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import type { ProviderRunInput } from "@chrona/contracts/steward";
import { createQqBotHandler, createQqBotState, createRelay, downloadQqAttachment, qqEntry, qqReplyText, testDb, type QqC2cMessage } from "@chrona/engine/test-support";

// The qq module's Chrona side, end to end through the real `chat` system module (the QQ transport is faked).
async function fixture(reply: (input: ProviderRunInput, service: ReturnType<typeof createStewardService>) => Promise<void> = async () => {}) {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-qq-relay-"));
  const now = () => new Date("2026-10-15T04:00:00Z");
  await db.workspace.create({ data: { id: "w", name: "test" } });
  const prompts: ProviderRunInput[] = [];
  const ports: StewardPorts = { db, dataDir, now, publicUrl: "https://chrona.example", provider: { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start(input) {
    prompts.push(input);
    return { inject: async () => {}, abort: async () => {}, done: (async () => { await reply(input, service); return { outcome: "finished" as const, sessionId: null, error: null }; })() };
  } } };
  const service = createStewardService(ports);
  const qq = await qqEntry(ports, "w");
  const relay = createRelay({ call: qq.call, notify: async () => ({}), publicUrl: ports.publicUrl,
    download: a => downloadQqAttachment(a, async (_url, init) => { expect(init?.redirect).toBe("error"); return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { headers: { "content-type": a.mime } }); }) });
  /** Runs the queued work until no run is pending, as the runtime's ticks would. */
  async function settle() {
    for (let i = 0; i < 100; i++) {
      await service.tick(); await service.tick.settled();
      if (!await db.run.count({ where: { status: { in: ["queued", "running"] } } })) return;
      await Bun.sleep(10);
    }
    throw new Error("Runs did not settle");
  }
  return { db, dataDir, now, prompts, service, relay, qq, settle };
}

test("QQ attachments and quoted replies stay in qq:dm; replies are pushed to qq.reply by chat and link to the conversation", async () => {
  let replyFiles: string[] = [];
  const f = await fixture(async (input, service) => {
    // A run writes a file in its working directory and attaches it by path.
    for (const path of replyFiles) { await mkdir(input.cwd, { recursive: true }); await writeFile(join(input.cwd, path), new Uint8Array([1, 2, 3])); }
    await service.tools.call(input.token, "chrona_reply", { text: "Stored reply", files: replyFiles });
  });
  const state = createQqBotState(join(f.dataDir, "qq"), "12345"), challenge = await state.createChallenge({ workspaceId: "w", now: f.now() });
  await state.redeem("owner", challenge.code, f.now());
  const sends: { content: string; image: boolean }[] = [];
  const handler = createQqBotHandler({ state, now: f.now, chat: { send: f.relay.send }, resolveApproval: f.relay.resolveApproval, enqueueFinal: async () => {},
    reply: async (_openid, _id, content, _seq, item) => {
      sends.push({ content, image: Boolean(item && await f.relay.replyImage(item)) });
      if (item) await f.relay.setExternalId(item.messageId, `qq:out:sent-${sends.length}`);
    } });
  // What the qq module does with each pushed reply (in production the call arrives as a qq.reply event).
  const deliverPushed = async (inReplyTo: string) => { for (const item of (await f.qq.pushed()).filter(item => item.inReplyTo === inReplyTo)) await handler.deliverReply({ ...item, text: f.relay.replyText(item) }); };
  const message = (id: string, extra: Partial<QqC2cMessage> = {}): QqC2cMessage => ({ id, openid: "owner", content: "", quoted: "", timestamp: f.now().toISOString(), ...extra });
  try {
    await handler.onMessage(message("first", { attachments: [{ url: "https://multimedia.nt.qq.com/a", name: "picture.png", mime: "image/png" }] }));
    await f.settle();
    expect(f.prompts[0]!.images).toEqual([{ mime: "image/png", base64: "iVBORw0KGgo=" }]);
    const first = await f.db.message.findFirstOrThrow({ where: { direction: "in" } });
    expect(first).toMatchObject({ channel: "chrona_qqbot", externalId: "first" });
    const attachment = (first.attachments as { ref: string }[])[0]!;
    expect(attachment.ref).toStartWith("chat/");
    expect(await readFile(join(f.dataDir, "platform", "data", attachment.ref))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(await f.db.session.findUnique({ where: { id: first.sessionId } })).toMatchObject({ key: "qq:dm", source: "qq", entryModuleId: f.qq.module.id });
    expect(await f.qq.pushed()).toMatchObject([{ caller: "system:chat", inReplyTo: "first", text: "Stored reply", sessionId: first.sessionId }]);
    await deliverPushed("first");
    const outbound = await f.db.message.findFirstOrThrow({ where: { direction: "out" } });
    expect(outbound.externalId).toBe("qq:out:sent-1");
    replyFiles = ["chart.png"];
    await handler.onMessage(message("second", { content: "about that", quotedId: "sent-1" }));
    await f.settle(); await deliverPushed("second");
    const second = await f.db.message.findFirstOrThrow({ where: { externalId: "second" } });
    expect(second.sessionId).toBe(first.sessionId); expect(second.quotedMessageId).toBe(outbound.id);
    expect(sends[1]!.content).toContain(`chart.png：`); expect(sends[1]!.content).toContain(`/sessions/${first.sessionId}`);
    const reply = await f.db.message.findFirstOrThrow({ where: { externalId: "qq:out:sent-2" } });
    expect((reply.attachments as { ref: string }[])[0]!.ref).toMatch(/^chat\/[0-9a-f-]{36}-chart\.png$/);
    // The engine labels reply files application/octet-stream: keep a download link rather than upload undeclared bytes.
    expect(sends[1]!.image).toBe(false);
  } finally { await handler.drain(); await f.db.$disconnect(); }
});

test("/new ends the qq:dm session; the next message starts a new one", async () => {
  const f = await fixture();
  await f.relay.send({ workspaceId: "w", key: "qq:dm", channel: "chrona_qqbot", text: "hi", externalId: "m1" });
  const first = await f.db.session.findFirstOrThrow({ where: { key: "qq:dm", status: "active" } });
  expect(await f.relay.send({ workspaceId: "w", key: "qq:dm", channel: "chrona_qqbot", text: " /new ", externalId: "m2" })).toEqual({ reply: "【Chrona】已开始新会话。" });
  await f.relay.send({ workspaceId: "w", key: "qq:dm", channel: "chrona_qqbot", text: "again", externalId: "m3" });
  const next = await f.db.session.findFirstOrThrow({ where: { key: "qq:dm", status: "active" } });
  expect(next.id).not.toBe(first.id);
  expect(await f.db.session.count({ where: { key: "qq:dm", status: "ended" } })).toBe(1);
  await f.db.$disconnect();
});

test("file links open the conversation on the web; without a public URL the reply says so", () => {
  const message = { text: "Ready", attachments: [{ name: "a b.pdf", ref: "chat/x-a_b.pdf", mime: "application/pdf", size: 3 }] };
  expect(qqReplyText(message, "https://chrona.example/", "s 1")).toContain("a b.pdf：https://chrona.example/sessions/s%201");
  expect(qqReplyText(message, null, "s1")).toContain("请在 Chrona 网页查看附件");
  expect(qqReplyText({ ...message, attachments: [{ ...message.attachments[0]!, ref: null }] }, "https://chrona.example", "s1")).toContain("请在 Chrona 网页查看附件");
});
