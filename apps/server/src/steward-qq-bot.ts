import { createHash } from "node:crypto";
import type { StewardService } from "@chrona/engine";
import type { PrismaClient } from "@chrona/db";
import { createChronaQqDelivery, createQqBotHandler, createQqBotState, createQqGateway, createQqTokenSource, qqBotConfig, readProtectedSecret, sendQqC2c, DEDICATED_PLATFORM, type QqLog, type QqC2cMessage } from "@chrona/integrations/steward";
import type { StewardChatTransport } from "./steward-runtime";

/** Injectable transport boundary; tests never read secrets or open a gateway. */
export function createStewardQqBot({ db, publicUrl, now = () => new Date(), env = process.env, transport }: {
  db: PrismaClient; publicUrl: string | null; now?: () => Date; env?: Record<string, string | undefined>;
  transport?: {
    send: typeof sendQqC2c;
    gateway: typeof createQqGateway;
  };
}): StewardChatTransport | null {
  const config = qqBotConfig(env);
  if (!config?.secretFile) return null;
  const { appId, stateDir, secretFile } = config;
  const log: QqLog = (event, fields = {}) => console.info(JSON.stringify({ component: "qq-bot", appId, event, ...fields }));
  const tokens = createQqTokenSource({ appId, readSecret: () => readProtectedSecret(secretFile), log });
  const state = createQqBotState(stateDir, appId);
  let recipients = new Set<string>();
  const delivery = createChronaQqDelivery({ tokens, publicUrl, allowedRecipients: () => recipients });
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
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    delivery: { channel: delivery.channel, async send(input) { await refreshBinding(); return delivery.send(input); } },
    bound: async () => Boolean(await refreshBinding()),
    async start(service: StewardService, wake: () => void) {
      if (handler) return;
      handler = createQqBotHandler({ state, now, log,
        chat: { async handleMessage(input) { try { return await service.chat.handleMessage(input); } finally { wake(); } } },
        reply: async (openid, messageId, text, msgSeq) => {
          const result = await (transport?.send ?? sendQqC2c)({ tokens, openid, content: text, replyTo: messageId, msgSeq });
          if (result.outcome !== "accepted") throw new Error("Passive reply not accepted");
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
