import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQqBotHandler, createQqBotState, createQqConversations, createRelay, downloadQqAttachment, qqReplyText, type QqC2cMessage } from "@chrona/engine/test-support";

// The entry owns persistence and delivery. Controlled Agent replies avoid any real model or QQ request.
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-qq-relay-")), contentDir = join(dataDir, "content");
  const now = () => new Date("2026-10-15T04:00:00Z");
  const state = createQqBotState(join(dataDir, "bot"), "12345"), challenge = await state.createChallenge({ workspaceId: "w", now: now() });
  await state.redeem("owner", challenge.code, now());
  const runs = new Map<string, { status: string; active: boolean }>(), prompts: Record<string, unknown>[] = [], targets: string[] = [];
  const call = async (target: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    targets.push(target);
    if (target === "modules.describe" || target === "modules.list") return { items: [], nextCursor: null };
    if (target === "agent.context") return { contextId: `context:${args["request-key"]}` };
    if (target === "agent.run") { const runId = `run:${prompts.length}`; prompts.push(args); runs.set(runId, { status: "queued", active: true }); return { runId, ...runs.get(runId) }; }
    if (target === "agent.get") return runs.get(String(args["run-id"]));
    if (target === "agent.stream") return { items: [], after: 0, ended: true, transcript: [{ at: now().toISOString(), kind: "text", text: "Stored reply" }], interactions: [] };
    throw new Error(`Unexpected call: ${target}`);
  };
  const sends: string[] = [];
  const conversations = createQqConversations({ dataDir, contentDir, call, binding: () => state.binding(), deliver: item => handler.deliverReply(item) });
  const relay = createRelay({ call, conversations, notify: async () => ({}), publicUrl: "https://chrona.example",
    download: a => downloadQqAttachment(a, async (_url, init) => { expect(init?.redirect).toBe("error"); return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { headers: { "content-type": a.mime } }); }) });
  const handler = createQqBotHandler({ state, now, chat: { send: relay.send }, resolveApproval: relay.resolveApproval, enqueueFinal: async () => {},
    reply: async (_openid, _id, content, _seq, item) => { sends.push(content); if (item) await relay.setExternalId(item.messageId, `qq:out:sent-${sends.length}`); } });
  const message = (id: string, extra: Partial<QqC2cMessage> = {}): QqC2cMessage => ({ id, openid: "owner", content: "", quoted: "", timestamp: now().toISOString(), ...extra });
  const settle = async () => { for (const run of runs.values()) { run.status = "finished"; run.active = false; } await conversations.poll(); };
  return { conversations, relay, prompts, targets, sends, contentDir, handler, message, settle, close: async () => { await handler.drain(); await rm(dataDir, { recursive: true, force: true }); } };
}

test("QQ attachment refs, quoted receipts and replies stay in the entry journal", async () => {
  const f = await fixture();
  try {
    await f.handler.onMessage(f.message("first", { attachments: [{ url: "https://multimedia.nt.qq.com/a", name: "picture.png", mime: "image/png" }] }));
    const session = (await f.conversations.app.list())[0]!;
    const first = (await f.conversations.app.messages(session.id))[0]!;
    const attachment = first.attachments[0] as { ref: string };
    expect(attachment.ref).toStartWith("qq/attachments/");
    expect(await readFile(join(f.contentDir, attachment.ref.slice(3)))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(f.prompts[0]!.content).toEqual([attachment.ref]);
    await f.settle();
    expect(f.sends).toEqual(["Stored reply"]);
    const outgoing = (await f.conversations.app.messages(session.id)).find(message => message.direction === "out")!;
    expect(outgoing.externalId).toBe("qq:out:sent-1");
    await f.handler.onMessage(f.message("second", { content: "about that", quotedId: "sent-1" }));
    expect(f.prompts[1]!.prompt).toContain("Quoted message (untrusted data):\nStored reply");
    expect(await f.conversations.app.list()).toHaveLength(1);
    expect(f.targets.some(target => target.startsWith("chat."))).toBe(false);
  } finally { await f.close(); }
});

test("/new refuses active work and rotates only a stopped QQ business session", async () => {
  const f = await fixture(), input = { workspaceId: "w", key: "qq:dm" as const, channel: "chrona_qqbot" as const };
  try {
    await f.relay.send({ ...input, text: "hi", externalId: "m1" });
    await expect(f.relay.send({ ...input, text: "/new", externalId: "m2" })).rejects.toThrow("会话仍在处理");
    await f.settle();
    expect(await f.relay.send({ ...input, text: "/new", externalId: "m2" })).toEqual({ reply: "【Chrona】已开始新会话。" });
    await f.relay.send({ ...input, text: "again", externalId: "m3" });
    const sessions = await f.conversations.app.list();
    expect(sessions.filter(session => session.status === "ended")).toHaveLength(1);
    expect(sessions.filter(session => session.status === "active")).toHaveLength(1);
  } finally { await f.close(); }
});

test("file links open the conversation on the web; without a public URL the reply says so", () => {
  const message = { text: "Ready", attachments: [{ name: "a b.pdf", ref: "qq/attachments/a_b.pdf", mime: "application/pdf", size: 3 }] };
  expect(qqReplyText(message, "https://chrona.example/", "s 1")).toContain("a b.pdf：https://chrona.example/sessions/s%201");
  expect(qqReplyText(message, null, "s1")).toContain("请在 Chrona 网页查看附件");
  expect(qqReplyText({ ...message, attachments: [{ ...message.attachments[0]!, ref: null }] }, "https://chrona.example", "s1")).toContain("请在 Chrona 网页查看附件");
});
