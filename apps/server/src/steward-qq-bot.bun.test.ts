import { expect, test } from "bun:test";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStewardService } from "@chrona/engine";
import type { ProviderRunInput } from "@chrona/contracts/steward";
import { testDb } from "@chrona/engine/test-support";
import { createQqBotState } from "../../../packages/integrations/src/steward/qq-official-bot";
import { downloadQqAttachment, type QqC2cMessage } from "../../../packages/integrations/src/steward/qq-official";
import { createStewardQqBot, qqReplyText } from "./steward-qq-bot";

test("QQ attachment-only message: inbox, images, receipt quote focus, affair storage and file links", async () => {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-v6-"));
  const now = () => new Date("2026-10-15T04:00:00Z"), stateDir = join(dataDir, "qq");
  await db.workspace.create({ data: { id: "w", name: "test" } });
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
  const affairId = (await service.forWorkspace("w").affairs.create({ title: "Quoted affair" })).id;
  const bot = createStewardQqBot({ db, now, publicUrl: "https://chrona.example", env: { CHRONA_QQ_APP_ID: "12345", CHRONA_QQ_STATE_DIR: stateDir, CHRONA_QQ_SECRET_FILE: "/not-read" }, transport: {
    send: async input => { sends.push(input); return { outcome: "accepted", messageId: `sent-${sends.length}` }; },
    upload: async () => "uploaded-image",
    download: a => downloadQqAttachment(a, async (_url, init) => { expect(init?.redirect).toBe("error"); expect(init?.signal).toBeDefined(); return new Response("abc", { headers: { "content-type": a.mime } }); }),
    gateway: options => { incoming = options.onMessage; return { start() {}, async stop() {}, status: () => ({ state: "ready", appId: "12345", readyAt: null, lastEventAt: null, reconnects: 0, lastCloseCode: null, resumable: false }) }; },
  } })!;
  await bot.start(service, () => {});
  const message = (id: string, extra: Partial<QqC2cMessage> = {}): QqC2cMessage => ({ id, openid: "owner", content: "", quoted: "", timestamp: now().toISOString(), ...extra });
  const attachment = { url: "https://multimedia.nt.qq.com/a", name: "picture.png", mime: "image/png" };
  try {
    incoming(message("first", { attachments: [attachment] }));
    // Gateway callbacks are intentionally fire-and-forget; drain through stop.
    await bot.stop();
    expect(prompts[0]!.images).toEqual([{ mime: "image/png", base64: "YWJj" }]);
    const first = await db.message.findFirstOrThrow({ where: { direction: "in" } });
    const firstAttachment = (first.attachments as { path: string }[])[0]!;
    expect(firstAttachment.path).toStartWith("inbox/chat/2026-10-15/");
    expect(await readFile(join(dataDir, "affairs", firstAttachment.path), "utf8")).toBe("abc");
    const outbound = await db.message.findFirstOrThrow({ where: { direction: "out" } });
    expect(outbound.externalId).toBe("qq:out:sent-1");
    await db.message.update({ where: { id: outbound.id }, data: { affairId } });
    const files = await service.forWorkspace("w").affairs.files(affairId);
    await files.upload("output", "chart.png", new Uint8Array([1, 2, 3]));
    replyFiles = ["output/chart.png"];
    incoming(message("second", { content: "about that", quotedId: "sent-1", attachments: [{ ...attachment, name: "voice.ogg", mime: "audio/ogg" }] }));
    await bot.stop();
    expect(prompts[1]!.cwd).toBe(await files.directory());
    expect(prompts[1]!.prompt).toContain("Quoted Chrona message (data)");
    expect(prompts[1]!.prompt).toContain("Voice note (not transcribed by Chrona)");
    const second = await db.message.findFirstOrThrow({ where: { externalId: "second" } });
    expect(second.quotedMessageId).toBe(outbound.id);
    expect((second.attachments as { path: string }[])[0]!.path).toStartWith("attachments/2026-10-15/");
    expect(sends[1]!.content).toContain(`/api/steward/affairs/${affairId}/raw?workspaceId=w&path=output%2Fchart.png`);
    expect(sends[1]!.mediaFileInfo).toBe("uploaded-image");
    expect((await service.chat.messages("w")).find(m => m.direction === "out" && m.attachments.length)?.attachments[0]!.name).toBe("chart.png");
    const prepared = await service.chat.intakeAttachments({ workspaceId: "w", channel: "chrona_qqbot" }, [
      ...Array.from({ length: 5 }, () => ({ name: "../a.png", mime: "image/png", bytes: new Uint8Array([1]) })),
      { name: "large.png", mime: "image/png", bytes: new Uint8Array(5 * 1024 * 1024 + 1) },
    ]);
    expect(prepared.attachments.filter(a => a.base64).length).toBe(4);
    expect(prepared.attachments.every(a => a.path?.startsWith("inbox/chat/") && !a.path.includes(".."))).toBe(true);
    await symlink(tmpdir(), join(dataDir, "affairs", "inbox", "chat", "2026-10-16"));
    const other = createStewardService({ db, dataDir, now: () => new Date("2026-10-16T04:00:00Z"), publicUrl: null, deliveries: [], chat: null });
    await expect(other.chat.intakeAttachments({ workspaceId: "w", channel: "chrona_qqbot" }, [{ name: "a", mime: "text/plain", bytes: new Uint8Array([1]) }])).rejects.toMatchObject({ code: "forbidden" });
  } finally { await bot.stop(); await db.$disconnect(); }
});

test("outbound file link uses public origin and encoded raw path; no public origin stays honest", () => {
  const message = { text: "Ready", affairId: "a", attachments: [{ name: "a b.pdf", path: "out/a b.pdf", mime: "application/pdf", size: 3 }] };
  expect(qqReplyText(message, "https://chrona.example/", "ws_default")).toContain("https://chrona.example/api/steward/affairs/a/raw?workspaceId=ws_default&path=out%2Fa+b.pdf");
  expect(qqReplyText({ ...message, attachments: [{ ...message.attachments[0]!, name: "trending.md", path: "trending.md", mime: "text/markdown" }] }, "https://chrona.example", "ws_default")).toContain("https://chrona.example/affairs/a?path=trending.md");
  expect(qqReplyText(message, null, "ws_default")).toContain("请在 Chrona 网页查看附件");
});
