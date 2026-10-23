// @ts-expect-error Chrona supplies the SDK package at run time.
import { chrona, on } from "chrona";
import { createHash } from "node:crypto";
import { createChronaQqDelivery, createQqBotHandler, createQqBotState, parseApprovalDecision, DEDICATED_PLATFORM, type DeliveryMessage, type DeliveryOutcome, type QqBinding } from "./bot";
import { ackQqInteraction, createQqGateway, createQqTokenSource, downloadQqAttachment, sendQqC2c, uploadQqImage, type QqLog } from "./official";
import { createRelay } from "./relay";

const log: QqLog = (event, fields = {}) => console.error(JSON.stringify({ component: "qq-bot", event, ...fields }));
// Registered before any await: deliver events can arrive while the module is still starting.
let deliver = async (_message: DeliveryMessage): Promise<DeliveryOutcome> => ({ outcome: "rejected", retryable: true, error: "QQ bot is starting" });
on("deliver", async (event: { message: DeliveryMessage }) => ({ result: await deliver(event.message) }));
const credentials = async () => (await chrona.secret({ name: "qq_bot" })).value as { appId?: string; clientSecret?: string };
const appId = await credentials().then(value => /^\d{5,20}$/.test(value.appId ?? "") && value.clientSecret ? value.appId! : null, () => null);

if (!appId) {
  // Not configured: stay up so Chrona keeps routing notifications to the web.
  log("qq.unconfigured");
  await chrona.channel({ ready: false });
  deliver = async () => ({ outcome: "rejected", retryable: false, error: "QQ bot is not configured" });
} else {
  const tokens = createQqTokenSource({ appId, readSecret: async () => (await credentials()).clientSecret!, log });
  const state = createQqBotState(chrona.paths.data, appId);
  const relay = createRelay({ owner: chrona.owner, publicUrl: process.env.CHRONA_PUBLIC_URL ?? null, download: downloadQqAttachment });
  let recipients = new Set<string>(), ready: boolean | null = null;
  const delivery = createChronaQqDelivery({ tokens, publicUrl: process.env.CHRONA_PUBLIC_URL ?? null, allowedRecipients: () => recipients });
  async function refreshBinding() {
    const binding = await state.binding();
    recipients = new Set(binding ? [`${DEDICATED_PLATFORM}:${binding.openid}`] : []);
    if (ready !== Boolean(binding)) { ready = Boolean(binding); await chrona.channel({ ready }); }
    return binding;
  }
  async function writeStatus() {
    try {
      const binding = await refreshBinding();
      await state.writeStatus({ updatedAt: new Date().toISOString(), gateway: gateway.status(), token: tokens.status(), bound: Boolean(binding), boundAt: binding?.boundAt ?? null, ownerHash: binding ? createHash("sha256").update(`${DEDICATED_PLATFORM}:${binding.openid}`).digest("hex").slice(0, 12) : null, challengePending: await state.challengePending(new Date()) });
    } catch { log("qq.status_write_failed"); }
  }
  const handler = createQqBotHandler({ state, log, resolveApproval: relay.resolveApproval, chat: { handleMessage: relay.chat },
    reply: async (openid, messageId, text, msgSeq, message) => {
      const image = message?.messageId ? await relay.replyImage(message.messageId).catch(() => null) : null;
      // Unsupported media stays available through the authenticated web link.
      const mediaFileInfo = image ? await uploadQqImage({ tokens, openid, bytes: image }) ?? undefined : undefined;
      const result = await sendQqC2c({ tokens, openid, content: text, replyTo: messageId, msgSeq, ...(mediaFileInfo ? { mediaFileInfo } : {}) });
      if (result.outcome !== "accepted") throw new Error("Passive reply not accepted");
      if (message?.messageId) await relay.setExternalId(message.messageId, `qq:out:${result.messageId}`).catch(() => log("qq.receipt_store_failed"));
    },
    // A replacement owner must not receive an old final reply: pin it to its sender.
    enqueueFinal: (binding: QqBinding, key, text, sessionId) => relay.enqueueFinal(key, text, `${DEDICATED_PLATFORM}:${binding.openid}`, sessionId).then(() => {}),
    onBound: async () => { await writeStatus(); },
  });
  const gateway = createQqGateway({ appId, tokens, log,
    onMessage: message => { void handler.onMessage(message).then(writeStatus); },
    onInteraction: interaction => { void (async () => {
      // A button click is the owner's decision only when the bound owner clicked it.
      await ackQqInteraction({ tokens, id: interaction.id }).catch(() => log("qq.interaction_ack_failed"));
      const binding = await refreshBinding(), decision = parseApprovalDecision({ button: interaction.data });
      log("qq.approval_click", { result: decision && binding?.openid === interaction.openid ? await relay.resolveApproval(binding, decision).catch(() => "failed") : "ignored" });
    })(); },
  });
  deliver = async message => {
    // Conversation replies go out passively from the chat flow above; only outbox notifications are sent actively.
    if (message.idempotencyKey.startsWith("reply:")) return { outcome: "accepted", receiptRef: null };
    const binding = await refreshBinding();
    const result = await delivery.send(message);
    if (binding && result.outcome === "accepted" && result.receiptRef) {
      // Never retry a send that QQ accepted.
      await relay.recordDelivered([message.title, message.body].filter(Boolean).join("\n\n"), `qq:out:${result.receiptRef.slice(`${DEDICATED_PLATFORM}:`.length)}`).catch(() => log("qq.receipt_store_failed"));
    }
    return result;
  };
  await refreshBinding();
  gateway.start();
  setInterval(() => void writeStatus(), 30_000);
  await writeStatus();
}
