import { expect, test } from "bun:test";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture } from "./agent-application.fixtures";
import { callSync, kernelOrigin } from "./module-calls";
import { createQqConversations } from "./external/qq/conversations";
import { createRelay } from "./external/qq/relay";
import { contextRunImages } from "./agent-context-read";
import type { QqReplyItem } from "./external/qq/bot";

test("QQ owns attachment references, scoped contexts, quotes and delivery uncertainty across restarts", async () => {
  const f = await agentFixture();
  try {
    await f.ports.db.run.delete({ where: { id: "agent-run" } });
    for (const [name, kind] of [["qq", "external"], ["notify", "builtin"]] as const) {
      const source = join(import.meta.dir, kind, name), hash = `qq-agent-${name}`;
      const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(source, "module.json"), "utf8")));
      await cp(source, join(f.ports.dataDir, "platform/store", hash), { recursive: true });
      const module = await f.ports.db.module.upsert({ where: { workspaceId_name: { workspaceId: f.workspaceId, name } }, create: { workspaceId: f.workspaceId, name, activeHash: hash }, update: { activeHash: hash } });
      await f.ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, source: kind === "builtin" ? "builtin" : "proposal", status: "approved", manifest, intent: {}, report: {} } });
    }
    f.ports.onQueued = () => new Promise(() => {});
    const qq = await f.ports.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: f.workspaceId, name: "qq" } } });
    const caller = { kind: "module" as const, module: "qq", moduleId: qq.id, hash: qq.activeHash! };
    const call = async (target: string, args: Record<string, unknown> = {}) => (await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller }, target, args)).output;
    let owner = "original-owner", uncertain = false;
    const sent: QqReplyItem[] = [];
    const options = { dataDir: join(f.root, "qq-private"), contentDir: join(f.ports.dataDir, "platform/content", qq.id), call,
      binding: async () => ({ version: 1 as const, appId: "12345", workspaceId: f.workspaceId, openid: owner, boundAt: new Date().toISOString() }),
      deliver: async (item: QqReplyItem) => { sent.push(item); if (uncertain) throw new Error("network outcome unknown"); } };
    let conversations = createQqConversations(options);
    const relay = () => createRelay({ conversations, call, publicUrl: null, notify: async () => ({}), download: async file => ({ name: file.name, mime: file.mime, bytes: new Uint8Array([137, 80, 78, 71]) }) });
    const message = { workspaceId: f.workspaceId, key: "qq:dm" as const, channel: "chrona_qqbot" as const, text: "查看图片", externalId: "message-1", attachments: [{ name: "image.png", mime: "image/png", url: "https://unused.invalid/image" }] };
    await relay().send(message);
    const session = (await conversations.app.list())[0]!, first = (await conversations.app.messages(session.id))[0]!;
    expect(first.attachments).toHaveLength(1);
    expect((first.attachments[0] as { ref: string }).ref).toStartWith("qq/attachments/");
    const run = await f.ports.db.run.findFirstOrThrow({ where: { session: { moduleId: qq.id } } });
    expect(await contextRunImages(f.ports, run)).toEqual([{ mime: "image/png", base64: "iVBORw==" }]);
    expect((await f.ports.db.session.findUniqueOrThrow({ where: { id: run.sessionId! } })).moduleId).toBe(qq.id);
    conversations = createQqConversations(options);
    await relay().send(message);
    expect(await f.ports.db.run.count()).toBe(1);
    await expect(conversations.newSession()).rejects.toMatchObject({ code: "conflict" });
    await conversations.app.interrupt(run.id); await conversations.poll();
    expect(sent).toHaveLength(1); expect(sent[0]!.owner).toBe("original-owner"); expect(sent[0]!.inReplyTo).toBe("message-1");
    await conversations.externalId(sent[0]!.messageId, "qq:out:receipt-1");
    await relay().send({ ...message, text: "引用刚才的回复", externalId: "message-2", quotedExternalId: "receipt-1", attachments: [] });
    const next = (await conversations.app.runs()).at(-1)!;
    expect((await f.ports.db.run.findUniqueOrThrow({ where: { id: next.id! } })).prompt).toContain("Quoted message (untrusted data)");
    await conversations.app.interrupt(next.id!);
    uncertain = true;
    await expect(conversations.poll()).rejects.toThrow("network outcome unknown");
    expect(sent).toHaveLength(2);
    conversations = createQqConversations(options); await conversations.poll(); expect(sent).toHaveLength(2);
    await relay().send({ ...message, text: "旧收件人的工作", externalId: "message-3", attachments: [] });
    const last = (await conversations.app.runs()).at(-1)!;
    await conversations.app.interrupt(last.id!); owner = "replacement-owner";
    await conversations.poll(); expect(sent).toHaveLength(2);
    expect(await f.ports.db.moduleInvocation.count({ where: { target: "chat" } })).toBe(0);
    const receipt = JSON.parse(await readFile(join(options.dataDir, "conversation-delivery/state.json"), "utf8"));
    expect(Object.values(receipt.deliveries)).toEqual(["accepted", "pending", "withheld"]);
    // Ending a stopped business session does not launch another model or replay delivery.
    owner = "original-owner"; await conversations.newSession();
    expect((await conversations.app.session(session.id)).status).toBe("ended");
  } finally { await f.close(); }
}, 30000);
