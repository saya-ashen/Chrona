import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@chrona/db";
import { createStewardChat, moveChatDestination } from "@chrona/engine";
import { createChronaQqDelivery, createQqBotHandler, createQqBotState, createQqGateway, createQqTokenSource, qqBotConfig, readProtectedSecret, sendQqC2c, DEDICATED_CHANNEL, DEDICATED_PLATFORM, type QqBinding, type QqLog } from "@chrona/integrations/steward";
import type { DeliveryAdapter } from "@chrona/contracts/steward";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const legacyRecipient = /^qqbot:[A-Za-z0-9_-]{1,128}$/;

/**
 * Chrona's own QQ bot, wired in-process: gateway → owner check → the steward chat service of
 * the bound workspace; outbox → `chrona_qqbot`. Disabled unless CHRONA_QQ_APP_ID, a secret file
 * and a state directory are configured. `allowedRecipients` is the runtime's shared allowlist;
 * the owner's `chrona_qq:<openid>` joins it only through a binding.
 */
export function createStewardQqBot({ db, allowedRecipients, deliveryAdapters, publicUrl, now = () => new Date(), env = process.env }: {
  db: PrismaClient; allowedRecipients: string[]; deliveryAdapters: Record<string, DeliveryAdapter & { idempotent?: boolean }>; publicUrl: string | null; now?: () => Date; env?: Record<string, string | undefined>;
}) {
  const config = qqBotConfig(env);
  if (!config?.secretFile) return null;
  const { appId, stateDir, secretFile } = config;
  const migrateFrom = legacyRecipient.test(env.CHRONA_QQ_MIGRATE_FROM ?? "") ? env.CHRONA_QQ_MIGRATE_FROM! : null;
  const log: QqLog = (event, fields = {}) => console.info(JSON.stringify({ component: "qq-bot", appId, event, ...fields }));
  const tokens = createQqTokenSource({ appId, readSecret: () => readProtectedSecret(secretFile), log });
  const state = createQqBotState(stateDir, appId);
  const actorKey = `qq-bot:${appId}`;
  deliveryAdapters[DEDICATED_CHANNEL] = createChronaQqDelivery({ tokens, publicUrl, allowedRecipients: () => new Set(allowedRecipients) });

  function allow(binding: QqBinding, replaced: string | null) {
    const recipient = `${DEDICATED_PLATFORM}:${binding.openid}`;
    if (replaced) allowedRecipients.splice(0, allowedRecipients.length, ...allowedRecipients.filter(r => r !== `${DEDICATED_PLATFORM}:${replaced}`));
    if (!allowedRecipients.includes(recipient)) allowedRecipients.push(recipient);
    return recipient;
  }
  /** Explicit operator cut-over (CHRONA_QQ_MIGRATE_FROM): the legacy Hermes identity's delegations follow the owner here. */
  async function migrate(binding: QqBinding, recipient: string, replaced: string | null) {
    const moves = [replaced ? `${DEDICATED_PLATFORM}:${replaced}` : null, migrateFrom].filter((from): from is string => Boolean(from));
    for (const from of moves) {
      const moved = await moveChatDestination({ db, workspaceId: binding.workspaceId, from, to: recipient, actorKey, now });
      log("qq.destination_moved", { legacy: from === migrateFrom, delegations: moved.delegations, queuedNotifications: moved.queuedNotifications });
    }
  }
  const handler = createQqBotHandler({
    state, log, now,
    chat: binding => {
      const service = createStewardChat({ db, workspaceId: binding.workspaceId, actorKey, allowedRecipients: new Set(allowedRecipients), now });
      return {
        request: input => service.request({ requestId: randomUUID(), ...input }),
        respond: input => service.respond({ requestId: randomUUID(), ...input }),
        pending: input => service.pending(input),
      };
    },
    reply: async (openid, messageId, text) => {
      const result = await sendQqC2c({ tokens, openid, content: text, replyTo: messageId });
      if (result.outcome !== "accepted") log("qq.reply_not_accepted", { outcome: result.outcome });
    },
    onBound: async (binding, replaced) => {
      const recipient = allow(binding, replaced);
      await db.stewardAudit.create({ data: { workspaceId: binding.workspaceId, actorKey, kind: "chat.bound", subjectId: binding.workspaceId, details: { platform: DEDICATED_PLATFORM, appId, recipientHash: hash(recipient), replacedHash: replaced ? hash(`${DEDICATED_PLATFORM}:${replaced}`) : null }, createdAt: now() } });
      await migrate(binding, recipient, replaced);
      await writeStatus();
    },
  });
  const gateway = createQqGateway({ appId, tokens, log, onMessage: message => { void handler.onMessage(message).then(writeStatus); } });

  async function writeStatus() {
    try {
      const binding = await state.binding();
      await state.writeStatus({ updatedAt: now().toISOString(), gateway: gateway.status(), token: tokens.status(), bound: Boolean(binding), boundAt: binding?.boundAt ?? null, ownerHash: binding ? hash(`${DEDICATED_PLATFORM}:${binding.openid}`).slice(0, 12) : null, challengePending: await state.challengePending(now()), legacyMigration: Boolean(migrateFrom) });
    } catch { log("qq.status_write_failed"); }
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    async start() {
      const binding = await state.binding();
      if (binding) { const recipient = allow(binding, binding.replacedOpenid ?? null); await migrate(binding, recipient, binding.replacedOpenid ?? null).catch(() => log("qq.migration_failed")); }
      gateway.start();
      timer = setInterval(() => void writeStatus(), 30_000);
      await writeStatus();
    },
    async stop() { clearInterval(timer); await gateway.stop(); await writeStatus(); },
    status: gateway.status,
  };
}
