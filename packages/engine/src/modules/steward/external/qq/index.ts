import { chrona, on } from "chrona";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createChronaQqDelivery, createQqBotHandler, createQqBotState, parseApprovalDecision, DEDICATED_PLATFORM, type DeliveryMessage, type DeliveryOutcome, type QqBinding, type QqReplyItem } from "./bot";
import { ackQqInteraction, createQqGateway, createQqTokenSource, downloadQqAttachment, sendQqC2c, uploadQqImage, validateQqFormat, type QqLog } from "./official";
import { createRelay } from "./relay";
import { createQqConversations } from "./conversations";
import { uiSettings } from "./ui-settings";
import { SETTINGS_PAGE } from "./page";

// Private app copy of entry-app/preferences.ts; inline so the entry has no missing release dependency.

export type MemoryPreferences = { provider: string | null; autoRecall: boolean; autoRetain: boolean };
const defaults: MemoryPreferences = { provider: null, autoRecall: true, autoRetain: true };
const maxBytes = 4096;
const fields = ["provider", "autoRecall", "autoRetain"] as const;
function invalid(message: string) { return Object.assign(new Error(message), { code: "invalid" }); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw invalid("Expected a settings object");
  return value as Record<string, unknown>;
}

/** Validate a strict partial update; omitted fields are preserved. */
export function memoryPreferencesPatch(value: unknown): Partial<MemoryPreferences> {
  const input = object(value), patch: Partial<MemoryPreferences> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !fields.some(field => field === key)) throw invalid("Unknown memory preference");
    const item = input[key];
    if (key === "provider") {
      if (item !== null && (typeof item !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(item))) throw invalid("Invalid memory provider");
      patch.provider = item;
    } else {
      if (typeof item !== "boolean") throw invalid(`Invalid ${key}`);
      patch[key as "autoRecall" | "autoRetain"] = item;
    }
  }
  return patch;
}

/** Full records require all fields; partial mode returns only supplied fields. */
export function parseMemoryPreferences(value: unknown, partial?: false): MemoryPreferences;
export function parseMemoryPreferences(value: unknown, partial: true): Partial<MemoryPreferences>;
export function parseMemoryPreferences(value: unknown, partial: boolean): Partial<MemoryPreferences>;
export function parseMemoryPreferences(value: unknown, partial = false): Partial<MemoryPreferences> {
  const parsed = memoryPreferencesPatch(value);
  if (!partial && fields.some(field => !Object.hasOwn(parsed, field))) throw invalid("Incomplete memory preferences");
  return parsed;
}

export function createPreferences(dataDir: string) {
  const path = join(dataDir, "memory-preferences.json");
  let pending: Promise<unknown> = Promise.resolve();
  async function load(): Promise<MemoryPreferences> {
    let file;
    try { file = await open(path, "r"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaults };
      throw error;
    }
    try {
      const bytes = Buffer.alloc(maxBytes + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > maxBytes) throw invalid("Memory preferences exceed 4096 bytes");
      let value: unknown;
      try { value = JSON.parse(bytes.subarray(0, length).toString("utf8")); }
      catch { throw invalid("Invalid memory preferences JSON"); }
      return parseMemoryPreferences(value);
    } finally { await file.close(); }
  }
  function read(): Promise<MemoryPreferences> { return pending.then(load); }
  async function update(value: unknown): Promise<MemoryPreferences> {
    const patch = memoryPreferencesPatch(value);
    const result = pending.then(async () => {
      const settings = { ...await load(), ...patch };
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const temporary = join(dataDir, `.memory-preferences-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify(settings)}\n`, { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      }
      return settings;
    });
    pending = result.catch(() => {});
    return result;
  }
  async function tool(args: Record<string, unknown>): Promise<MemoryPreferences> {
    const input = object(args);
    if (Reflect.ownKeys(input).some(key => key !== "settings")) throw invalid("Unknown preference tool argument");
    if (!Object.hasOwn(input, "settings")) return read();
    if (typeof input.settings !== "string" || Buffer.byteLength(input.settings) > maxBytes) throw invalid("Expected settings JSON within 4096 bytes");
    let patch: unknown;
    try { patch = JSON.parse(input.settings); }
    catch { throw invalid("Invalid settings JSON"); }
    return update(patch);
  }
  return { read, update, tool };
}
const preferences = createPreferences(chrona.paths.data);
const appCall = (target: string, args: Record<string, unknown> = {}) => target === "qq.settings" ? preferences.tool(args) : chrona.call(target, args);

const log: QqLog = (event, fields = {}) => console.error(JSON.stringify({ component: "qq-bot", event, ...fields }));
type Args = Record<string, string | boolean | undefined>;
// Registered before any await: calls can arrive while the module is still starting.
let deliver = async (_message: DeliveryMessage): Promise<DeliveryOutcome> => ({ outcome: "rejected", retryable: true, error: "QQ bot is starting" });
// A reply that arrives during startup waits for it (a throw would count as a module failure).
let started!: () => void;
const startup = new Promise<void>(resolve => { started = resolve; });
let reply = async (item: QqReplyItem): Promise<string> => { await startup; return reply(item); };
async function ownSettings(args: Record<string, unknown>, caller: unknown, ui: boolean) {
  return { result: caller ? await (ui ? uiSettings(preferences, args) : preferences.tool(args)) : { ignored: "no caller" } };
}
on("tool", async event => {
  if (["settings", "ui-settings"].includes(event.id)) return ownSettings(event.args, event.caller, event.id === "ui-settings");
  const args = event.args as Args;
  if (event.id === "deliver") {
    const invalid = validateQqFormat(args.format);
    if (invalid) return { result: invalid };
    return { result: await deliver({ idempotencyKey: String(args.key), format: args.format as DeliveryMessage["format"], title: String(args.title), body: String(args.body), link: typeof args.link === "string" ? args.link : null, recipient: typeof args.recipient === "string" ? args.recipient : null,
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
// Explicit uses reactivates registrations when notify or Web starts or changes version.
let channelReady = false;
on("activated", async () => {
  await reportReady(channelReady);
  try {
    const registered = await chrona.call("web.page-set", SETTINGS_PAGE);
    if (registered && typeof registered === "object" && "error" in registered) throw new Error("Settings page registration rejected");
  }
  catch { log("qq.settings_page_registration_failed"); }
  return {};
});
// The timestamp orders readiness reports that arrive late.
async function reportReady(ready: boolean) {
  channelReady = ready;
  const at = new Date().toISOString();
  try {
    const reply = await chrona.call("notify.channel", { channel: "chrona_qqbot", tool: "deliver", ready, at });
    if (reply && typeof reply === "object" && "error" in reply) throw new Error("Channel registration rejected");
    return true;
  } catch { log("qq.channel_report_failed"); return false; }
}
let conversationBinding = async (): Promise<QqBinding | null> => null;
const conversations = createQqConversations({ dataDir: chrona.paths.data, contentDir: chrona.paths.content, call: appCall, binding: () => conversationBinding(), deliver: item => reply(item) });
let pollConversations = async () => { await conversations.app.poll(); }, polling = false;
setInterval(() => { if (!polling) { polling = true; void pollConversations().catch(() => log("qq.conversation_poll_failed")).finally(() => { polling = false; }); } }, 1000);
const credentials = async () => (await chrona.secret({ name: "qq_bot" })).value as { appId?: string; clientSecret?: string };
const appId = await credentials().then(value => /^\d{5,20}$/.test(value.appId ?? "") && value.clientSecret ? value.appId! : null, () => null);

if (!appId) {
  // Not configured: stay up and report unavailable; notifications wait, replies remain readable on the page.
  log("qq.unconfigured");
  await reportReady(false);
  deliver = async () => ({ outcome: "rejected", retryable: false, error: "QQ bot is not configured" });
  reply = async () => "unconfigured";
  started();
} else {
  const tokens = createQqTokenSource({ appId, readSecret: async () => (await credentials()).clientSecret!, log });
  const state = createQqBotState(chrona.paths.data, appId);
  conversationBinding = () => state.binding();
  pollConversations = async () => { await conversations.poll(); };
  const relay = createRelay({ conversations, call: (target, args) => chrona.call(target, args), notify: args => chrona.call("notify.send", args, { mode: "async", key: `final:${String(args.key)}` }),
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
