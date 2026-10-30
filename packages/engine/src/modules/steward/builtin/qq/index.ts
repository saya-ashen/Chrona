import { chrona, on } from "chrona";
import { createHash } from "node:crypto";
import { createChronaQqDelivery, createQqBotHandler, createQqBotState, parseApprovalDecision, DEDICATED_PLATFORM, type DeliveryMessage, type DeliveryOutcome, type QqBinding, type QqReplyItem } from "./bot";
import { ackQqInteraction, createQqGateway, createQqTokenSource, downloadQqAttachment, sendQqC2c, uploadQqImage, type QqLog } from "./official";
import { createRelay } from "./relay";

const log: QqLog = (event, fields = {}) => console.error(JSON.stringify({ component: "qq-bot", event, ...fields }));
type Args = Record<string, string | boolean | undefined>;
// Registered before any await: calls can arrive while the module is still starting.
let deliver = async (_message: DeliveryMessage): Promise<DeliveryOutcome> => ({ outcome: "rejected", retryable: true, error: "QQ bot is starting" });
// A reply that arrives during startup waits for it (a throw would count as a module failure).
let started!: () => void;
const startup = new Promise<void>(resolve => { started = resolve; });
let reply = async (item: QqReplyItem): Promise<string> => { await startup; return reply(item); };
on("tool", async event => {
  const args = event.args as Args;
  if (event.id === "deliver") {
    return { result: await deliver({ idempotencyKey: String(args.key), title: String(args.title), body: String(args.body), link: typeof args.link === "string" ? args.link : null, recipient: typeof args.recipient === "string" ? args.recipient : null,
      ...(typeof args.approval === "string" ? { approval: { id: args.approval, scoped: args.scoped === true } } : {}) }) };
  }
  if (event.id === "reply") {
    let attachments: QqReplyItem["attachments"] = [];
    try { attachments = JSON.parse(String(args.attachments ?? "[]")); } catch { log("qq.reply_attachments_invalid"); }
    return { result: { delivered: await reply({ messageId: String(args.message), sessionId: typeof args.session === "string" ? args.session : null, text: String(args.text), workspace: String(args.workspace),
      inReplyTo: typeof args["in-reply-to"] === "string" ? args["in-reply-to"] : null, attachments }) } };
  }
  throw new Error(`Unknown tool ${event.id}`);
});
// Readiness goes to the notify module, which picks the channel; the time orders reports that arrive late.
async function reportReady(ready: boolean) {
  const at = new Date().toISOString();
  try { await chrona.call("notify.channel", { channel: "chrona_qqbot", ready, at }, { mode: "async", key: `ready:${at}:${ready}` }); return true; }
  catch { log("qq.channel_report_failed"); return false; }
}
const credentials = async () => (await chrona.secret({ name: "qq_bot" })).value as { appId?: string; clientSecret?: string };
const appId = await credentials().then(value => /^\d{5,20}$/.test(value.appId ?? "") && value.clientSecret ? value.appId! : null, () => null);

if (!appId) {
  // Not configured: stay up so Chrona keeps routing notifications to the web; replies stay readable on the page.
  log("qq.unconfigured");
  await reportReady(false);
  deliver = async () => ({ outcome: "rejected", retryable: false, error: "QQ bot is not configured" });
  reply = async () => "unconfigured";
  started();
} else {
  const tokens = createQqTokenSource({ appId, readSecret: async () => (await credentials()).clientSecret!, log });
  const state = createQqBotState(chrona.paths.data, appId);
  const relay = createRelay({ call: (target, args) => chrona.call(target, args), notify: args => chrona.call("notify.send", args, { mode: "async", key: `final:${String(args.key)}` }),
    publicUrl: process.env.CHRONA_PUBLIC_URL ?? null, download: downloadQqAttachment });
  let recipients = new Set<string>(), ready: boolean | null = null;
  const delivery = createChronaQqDelivery({ tokens, publicUrl: process.env.CHRONA_PUBLIC_URL ?? null, allowedRecipients: () => recipients });
  async function refreshBinding() {
    const binding = await state.binding();
    recipients = new Set(binding ? [`${DEDICATED_PLATFORM}:${binding.openid}`] : []);
    // A failed report is repeated on the next status refresh.
    if (ready !== Boolean(binding) && await reportReady(Boolean(binding))) ready = Boolean(binding);
    return binding;
  }
  async function writeStatus() {
    try {
      const binding = await refreshBinding();
      await state.writeStatus({ updatedAt: new Date().toISOString(), gateway: gateway.status(), token: tokens.status(), bound: Boolean(binding), boundAt: binding?.boundAt ?? null, ownerHash: binding ? createHash("sha256").update(`${DEDICATED_PLATFORM}:${binding.openid}`).digest("hex").slice(0, 12) : null, challengePending: await state.challengePending(new Date()) });
    } catch { log("qq.status_write_failed"); }
  }
  const handler = createQqBotHandler({ state, log, resolveApproval: relay.resolveApproval, chat: { send: relay.send },
    reply: async (openid, messageId, text, msgSeq, item) => {
      const image = item ? await relay.replyImage(item).catch(() => null) : null;
      // Unsupported media stays available through the authenticated web link.
      const mediaFileInfo = image ? await uploadQqImage({ tokens, openid, bytes: image }) ?? undefined : undefined;
      const result = await sendQqC2c({ tokens, openid, content: text, replyTo: messageId, msgSeq, ...(mediaFileInfo ? { mediaFileInfo } : {}) });
      if (result.outcome !== "accepted") throw new Error("Passive reply not accepted");
      if (item) await relay.setExternalId(item.messageId, `qq:out:${result.messageId}`).catch(() => log("qq.receipt_store_failed"));
    },
    // A replacement owner must not receive an old final reply: pin it to its sender.
    enqueueFinal: (binding: QqBinding, key, text, sessionId) => relay.enqueueFinal(key, text, `${DEDICATED_PLATFORM}:${binding.openid}`, sessionId).then(() => {}),
    onBound: async () => { await writeStatus(); },
  });
  reply = item => handler.deliverReply({ ...item, text: relay.replyText(item) });
  started();
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
    const binding = await refreshBinding();
    const result = await delivery.send(message);
    if (binding && result.outcome === "accepted" && result.receiptRef) {
      // Never retry a send that QQ accepted. A final reply is already in the conversation: only its receipt is new.
      const externalId = `qq:out:${result.receiptRef.slice(`${DEDICATED_PLATFORM}:`.length)}`, final = /:response:qq-final:[^:]+:([^:]+)$/.exec(message.idempotencyKey)?.[1];
      await (final ? relay.setExternalId(final, externalId) : relay.recordDelivered([message.title, message.body].filter(Boolean).join("\n\n"), externalId)).catch(() => log("qq.receipt_store_failed"));
    }
    return result;
  };
  await refreshBinding();
  gateway.start();
  setInterval(() => void writeStatus(), 30_000);
  await writeStatus();
}
