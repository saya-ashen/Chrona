import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStewardService } from "@chrona/engine";
import type { ProviderRunInput } from "@chrona/contracts/steward";
import { testDb } from "@chrona/engine/test-support";
import { createQqBotState } from "../../../packages/integrations/src/steward/qq-official-bot";
import { downloadQqAttachment, type QqC2cMessage } from "../../../packages/integrations/src/steward/qq-official";
import { createStewardQqBot, lateReplies, qqReplyText } from "./steward-qq-bot";

test("QQ attachments and quoted replies stay in qq:dm and link to app content", async () => {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-qq-content-"));
  const now = () => new Date("2026-10-15T04:00:00Z"), stateDir = join(dataDir, "qq");
  await db.workspace.create({ data: { id: "w", name: "test" } });
  const module = await db.module.create({ data: { workspaceId: "w", name: "files", status: "active", activeHash: "hash" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "hash", status: "active", intent: "fixture", source: "user", report: {}, manifest: { name: "files", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], content: true } } });
  const state = createQqBotState(stateDir, "12345"), challenge = await state.createChallenge({ workspaceId: "w", now: now() });
  await state.redeem("owner", challenge.code, now());
  let incoming!: (m: QqC2cMessage) => void;
  const prompts: ProviderRunInput[] = [], sends: { content: string; mediaFileInfo?: string }[] = [];
  let replyFiles: string[] = [];
  const service = createStewardService({ db, dataDir, now, publicUrl: "https://chrona.example", deliveries: [], chat: null,
    provider: { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start(input) {
      prompts.push(input);
      return { inject: async () => {}, abort: async () => {}, done: (async () => {
        await service.tools.call(input.token, "chrona_reply", { text: "Stored reply", files: replyFiles });
        return { outcome: "finished" as const, sessionId: null, error: null };
      })() };
    } },
  });
  const bot = createStewardQqBot({ db, now, publicUrl: "https://chrona.example", env: { CHRONA_QQ_APP_ID: "12345", CHRONA_QQ_STATE_DIR: stateDir, CHRONA_QQ_SECRET_FILE: "/not-read" }, transport: {
    send: async input => { sends.push(input); return { outcome: "accepted", messageId: `sent-${sends.length}` }; },
    upload: async () => "uploaded-image",
    download: a => downloadQqAttachment(a, async (_url, init) => { expect(init?.redirect).toBe("error"); return new Response("abc", { headers: { "content-type": a.mime } }); }),
    gateway: options => { incoming = options.onMessage; return { start() {}, async stop() {}, status: () => ({ state: "ready", appId: "12345", readyAt: null, lastEventAt: null, reconnects: 0, lastCloseCode: null, resumable: false }) }; },
  } })!;
  await bot.start(service, () => {});
  const message = (id: string, extra: Partial<QqC2cMessage> = {}): QqC2cMessage => ({ id, openid: "owner", content: "", quoted: "", timestamp: now().toISOString(), ...extra });
  try {
    incoming(message("first", { attachments: [{ url: "https://multimedia.nt.qq.com/a", name: "picture.png", mime: "image/png" }] }));
    await bot.stop();
    expect(prompts[0]!.images).toEqual([{ mime: "image/png", base64: "YWJj" }]);
    const first = await db.message.findFirstOrThrow({ where: { direction: "in" } });
    const attachment = (first.attachments as { ref: string }[])[0]!;
    expect(attachment.ref).toStartWith("files/uploads/");
    expect(await readFile(join(dataDir, "platform", "content", module.id, attachment.ref.slice(6)), "utf8")).toBe("abc");
    expect(await db.session.findUnique({ where: { id: first.sessionId } })).toMatchObject({ key: "qq:dm", source: "qq" });
    const outbound = await db.message.findFirstOrThrow({ where: { direction: "out" } });
    expect(outbound.externalId).toBe("qq:out:sent-1");
    await db.module.update({ where: { id: module.id }, data: { status: "paused" } });
    await service.forWorkspace("w").content.upload(module.id, "output", "chart.png", new Uint8Array([1, 2, 3]));
    await db.module.update({ where: { id: module.id }, data: { status: "active" } });
    replyFiles = ["files/output/chart.png"];
    incoming(message("second", { content: "about that", quotedId: "sent-1" }));
    await bot.stop();
    const second = await db.message.findFirstOrThrow({ where: { externalId: "second" } });
    expect(second.sessionId).toBe(first.sessionId); expect(second.quotedMessageId).toBe(outbound.id);
    expect(prompts[1]!.cwd).toBe(join(dataDir, "sessions", first.sessionId));
    expect(sends[1]!.content).toContain(`/api/steward/apps/${module.id}/raw?workspaceId=w&path=output%2Fchart.png`);
    // The engine currently labels reply files application/octet-stream: keep a download link,
    // rather than upload bytes not declared as an image.
    expect(sends[1]!.mediaFileInfo).toBeUndefined();
  } finally { await bot.stop(); await db.$disconnect(); }
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
  const db = testDb(), at = new Date("2026-10-15T04:00:00Z");
  await db.workspace.create({ data: { id: "w", name: "test" } });
  const session = await db.session.create({ data: { workspaceId: "w", key: "qq:dm", source: "qq" } });
  const run = await db.run.create({ data: { workspaceId: "w", sessionId: session.id, lane: "foreground", trigger: "message", status: "running", provider: "pi", tokenHash: "h", prompt: "p", cwd: "/x", deadlineAt: at, createdAt: at } });
  const reply = async (text: string, externalId: string | null = null) => {
    const m = await db.message.create({ data: { workspaceId: "w", channel: "chrona_qqbot", direction: "out", sessionId: session.id, text, externalId, at } });
    await db.audit.create({ data: { workspaceId: "w", actorKey: "chrona", kind: "run_reply", subjectId: run.id, details: { messageId: m.id } } });
    return m.id;
  };
  const first = await reply("first"); await reply("already sent", "qq:out:x");
  const stream = lateReplies(db, "w", run.id, { seen: new Set([first]), publicUrl: null, pollMs: 1 })[Symbol.asyncIterator]();
  const pending = stream.next(); await reply("second");
  expect((await pending).value).toMatchObject({ reply: "second", sessionId: session.id });
  await db.run.update({ where: { id: run.id }, data: { status: "finished" } });
  expect((await stream.next()).done).toBe(true); await db.$disconnect();
});
