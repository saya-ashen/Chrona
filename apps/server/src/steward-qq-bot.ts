import { createHash } from "node:crypto";
import type { StewardService } from "@chrona/engine";
import type { PrismaClient } from "@chrona/db";
import { attachmentSchema } from "@chrona/contracts/steward";
import { createChronaQqDelivery, createQqBotHandler, createQqBotState, qqBotConfig, DEDICATED_PLATFORM } from "../../../packages/integrations/src/steward/qq-official-bot";
import { uploadQqImage, downloadQqAttachment, createQqGateway, createQqTokenSource, readProtectedSecret, sendQqC2c, type QqLog, type QqC2cMessage } from "../../../packages/integrations/src/steward/qq-official";
import type { StewardChatTransport } from "./steward-runtime";

/** Authenticated web downloads: never expose a local path or invent a public file URL. */
export function qqReplyText(message: Pick<import("@chrona/contracts/steward").Message, "text" | "attachments" | "affairId">, publicUrl: string | null) {
  return [message.text, ...message.attachments.map(file => file.path && message.affairId && publicUrl
    ? `${file.name}: ${publicUrl.replace(/\/$/, "")}/api/steward/affairs/${encodeURIComponent(message.affairId)}/raw?path=${encodeURIComponent(file.path)}`
    : `${file.name}（请在 Chrona 网页查看附件）`)].join("\n\n");
}

function isReplyImage(file: import("@chrona/contracts/steward").Attachment | undefined) {
  return file?.path && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mime) && file.size <= 5 * 1024 * 1024;
}

/** Injectable transport boundary; tests never read secrets or open a gateway. */
export function createStewardQqBot({ db, publicUrl, now = () => new Date(), env = process.env, transport }: {
  db: PrismaClient; publicUrl: string | null; now?: () => Date; env?: Record<string, string | undefined>;
  transport?: {
    send: typeof sendQqC2c;
    gateway: typeof createQqGateway;
    download?: typeof downloadQqAttachment;
    upload?: typeof uploadQqImage;
  };
}): StewardChatTransport | null {
  const config = qqBotConfig(env);
  if (!config?.secretFile) return null;
  const { appId, stateDir, secretFile } = config;
  const log: QqLog = (event, fields = {}) => console.info(JSON.stringify({ component: "qq-bot", appId, event, ...fields }));
  const tokens = createQqTokenSource({ appId, readSecret: () => readProtectedSecret(secretFile), log });
  const state = createQqBotState(stateDir, appId);
  let recipients = new Set<string>();
  const delivery = createChronaQqDelivery({ tokens, publicUrl, allowedRecipients: () => recipients, send: transport?.send });
  let handler: ReturnType<typeof createQqBotHandler> | undefined;
  const gateway = (transport?.gateway ?? createQqGateway)({ appId, tokens, log, onMessage: (message: QqC2cMessage) => { void handler?.onMessage(message).then(writeStatus); } });
  async function refreshBinding() {
    const binding = await state.binding();
    recipients = new Set(binding ? [`${DEDICATED_PLATFORM}:${binding.openid}`] : []);
    return binding;
  }
  async function writeStatus() {
    try {
      const binding = await refreshBinding();
      await state.writeStatus({ updatedAt: now().toISOString(), gateway: gateway.status(), token: tokens.status(), bound: Boolean(binding), boundAt: binding?.boundAt ?? null, ownerHash: binding ? createHash("sha256").update(`${DEDICATED_PLATFORM}:${binding.openid}`).digest("hex").slice(0, 12) : null, challengePending: await state.challengePending(now()) });
    } catch { log("qq.status_write_failed"); }
  }
  async function uploadReplyImage(service: StewardService, openid: string, messageId: string, workspaceId: string) {
    const row = await db.message.findFirst({ where: { id: messageId, workspaceId, channel: "chrona_qqbot", direction: "out" } });
    const image = Array.isArray(row?.attachments) ? row.attachments.map(a => attachmentSchema.safeParse(a).data).find(isReplyImage) : null;
    if (image?.path && row?.affairId) {
      try {
        const bytes = await (await service.forWorkspace(workspaceId).affairs.files(row.affairId)).raw(image.path);
        return await (transport?.upload ?? uploadQqImage)({ tokens, openid, bytes }) ?? undefined;
      } catch { /* Unsupported media remains available through the authenticated web link. */ }
    }
    return undefined;
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    delivery: { channel: delivery.channel, async send(input) {
      // Conversation replies are collected by handleMessage and sent passively below.
      // Only notification outbox messages may use proactive delivery.
      if (input.idempotencyKey.startsWith("reply:")) return { outcome: "accepted", receiptRef: null };
      const binding = await refreshBinding();
      const result = await delivery.send(input);
      if (binding && result.outcome === "accepted" && result.receiptRef) {
        try {
          const notification = await db.notification.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: binding.workspaceId, idempotencyKey: input.idempotencyKey } } });
          const externalId = `qq:out:${result.receiptRef.slice(`${DEDICATED_PLATFORM}:`.length)}`;
          await db.message.upsert({ where: { workspaceId_externalId: { workspaceId: binding.workspaceId, externalId } }, update: {}, create: { workspaceId: binding.workspaceId, externalId, conversationKey: "chat:chrona_qqbot", channel: "chrona_qqbot", direction: "out", text: [input.title, input.body].filter(Boolean).join("\n\n").slice(0, 8000), affairId: notification?.affairId, at: now() } });
        } catch { log("qq.receipt_store_failed"); } // Never retry a send that QQ accepted.
      }
      return result;
    } },
    bound: async () => Boolean(await refreshBinding()),
    async start(service: StewardService, wake: () => void) {
      if (handler) return;
      handler = createQqBotHandler({ state, now, log,
        chat: { async handleMessage(input) {
          try {
            const { attachments: remote = [], quotedExternalId, ...chatInput } = input;
            if (remote.length > 10) throw new Error("Too many attachments");
            const quoted = quotedExternalId ? await db.message.findFirst({ where: { workspaceId: input.workspaceId, channel: "chrona_qqbot", direction: "out", externalId: `qq:out:${quotedExternalId}` } }) : null;
            const quote = quoted ? { quotedMessageId: quoted.id } : {};
            const files = [];
            for (const attachment of remote) files.push(await (transport?.download ?? downloadQqAttachment)(attachment));
            const intake = files.length ? await service.chat.intakeAttachments({ ...chatInput, ...quote }, files) : {};
            const result = await service.chat.handleMessage({ ...chatInput, ...quote, ...intake });
            const replies = result.messages.map(message => ({ messageId: message.id, affairId: message.affairId, reply: qqReplyText(message, publicUrl) }));
            return { reply: replies.map(m => m.reply).join("\n\n") || "处理尚未完成，请稍后在网页查看。", affairId: result.messages.at(-1)?.affairId, workspaceId: input.workspaceId, replies };
          } finally { wake(); }
        } },
        reply: async (openid, messageId, text, msgSeq, message) => {
          const mediaFileInfo = message?.messageId && message.workspaceId
            ? await uploadReplyImage(service, openid, message.messageId, message.workspaceId) : undefined;
          const result = await (transport?.send ?? sendQqC2c)({ tokens, openid, content: text, replyTo: messageId, msgSeq, ...(mediaFileInfo ? { mediaFileInfo } : {}) });
          if (result.outcome !== "accepted") throw new Error("Passive reply not accepted");
          if (message?.messageId && message.workspaceId) await db.message.updateMany({ where: { id: message.messageId, workspaceId: message.workspaceId, direction: "out", channel: "chrona_qqbot" }, data: { externalId: `qq:out:${result.messageId}` } });
        },
        async enqueueFinal(binding, messageId, text, affairId) {
          // The normal budget may fold this into a digest; never bypass quiet hours/caps.
          await db.$transaction(async tx => {
            const row = await service.forWorkspace(binding.workspaceId).notifications.enqueueNotification(tx, { workspaceId: binding.workspaceId, level: "now", title: "Chrona", body: text, dedupeKey: `qq-final:${messageId}`, ...(affairId ? { affairId } : {}) });
            // Pin this reply to its sender. A replacement owner must not receive
            // an old final reply; the adapter rejects recipients no longer bound.
            await tx.notification.update({ where: { id: row.id }, data: { recipient: `${DEDICATED_PLATFORM}:${binding.openid}` } });
          });
        },
        onBound: async () => { await writeStatus(); },
      });
      await refreshBinding();
      gateway.start();
      timer = setInterval(() => void writeStatus(), 30_000);
      await writeStatus();
    },
    async stop() { clearInterval(timer); await gateway.stop(); await handler?.drain(); await writeStatus(); },
  };
}
