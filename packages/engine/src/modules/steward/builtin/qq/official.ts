/**
 * Chrona's own QQ official bot transport: access token, REST sends and the WebSocket
 * gateway (private C2C messages only). Protocol per the QQ bot v2 docs and the working
 * Hermes qqbot adapter: token POST {appId, clientSecret}; `Authorization: QQBot <token>`;
 * gateway op 10 Hello → op 2 Identify | op 6 Resume, op 0 READY/RESUMED/dispatch,
 * op 1/11 heartbeat, op 7 reconnect, op 9 invalid session.
 *
 * The AppSecret is fetched from Chrona (`secret`) only when a token is needed and is never
 * logged, returned or stored beyond that call. Logs carry fixed event names, numbers and
 * the public AppID only — never tokens, message text or openids.
 */
export const QQ_API_BASE = "https://api.sgroup.qq.com";
export const QQ_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
/** GROUP_AND_C2C_EVENT. Group @-messages share this intent and are ignored. */
// C2C messages | button interactions; a bot refused interactions (4014) reconnects with messages only.
const C2C_INTENT = 1 << 25, INTERACTION_INTENT = 1 << 26;
const BACKOFF_SECONDS = [2, 5, 10, 30, 60];
const FATAL_CLOSE = new Set([4001, 4002, 4010, 4011, 4012, 4013, 4014, 4914, 4915]);
const SESSION_INVALID = (code: number) => code === 4006 || code === 4007 || (code >= 4900 && code < 4914);
const RATE_LIMITED_CODES = new Set([40034100, 22009, 20028]);

export type QqLog = (event: string, fields?: Record<string, string | number | boolean | null>) => void;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class QqTransportError extends Error {}


export function createQqTokenSource({ appId, readSecret, fetch = globalThis.fetch, now = Date.now, log = () => {} }: { appId: string; readSecret: () => Promise<string>; fetch?: Fetch; now?: () => number; log?: QqLog }) {
  let token: string | null = null, expiresAt = 0, inflight: Promise<string> | null = null;
  async function refresh() {
    const response = await fetch(QQ_TOKEN_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appId, clientSecret: await readSecret() }), signal: AbortSignal.timeout(15_000), redirect: "error" });
    const data = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
    // The response body is never logged: an error payload might echo request fields.
    if (!response.ok || typeof data?.access_token !== "string" || !data.access_token) { log("qq.token_failed", { status: response.status }); throw new QqTransportError("QQ token request failed"); }
    const seconds = Number(data.expires_in);
    token = data.access_token; expiresAt = now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 7200) * 1000;
    log("qq.token_refreshed", { expiresInSeconds: Math.round((expiresAt - now()) / 1000) });
    return token;
  }
  return {
    /** A token valid for at least another minute; concurrent callers share one refresh. */
    async get() {
      if (token && now() < expiresAt - 60_000) return token;
      inflight ??= refresh().finally(() => { inflight = null; });
      return inflight;
    },
    invalidate() { token = null; expiresAt = 0; },
    status() { return { hasToken: token !== null, expiresAt: token ? new Date(expiresAt).toISOString() : null }; },
  };
}
export type QqTokenSource = ReturnType<typeof createQqTokenSource>;

export type QqSendOutcome =
  | { outcome: "accepted"; messageId: string }
  | { outcome: "rejected"; retryable: boolean; error: string }
  | { outcome: "uncertain"; error: string };

function classifySend(status: number, code: number | null): QqSendOutcome {
  if (status >= 500) return { outcome: "uncertain", error: `QQ server error ${status}` };
  if (status === 429 || (code !== null && RATE_LIMITED_CODES.has(code))) return { outcome: "rejected", retryable: true, error: `QQ rate limited${code ? ` (${code})` : ""}` };
  return { outcome: "rejected", retryable: status === 401, error: `QQ rejected the message (${status}${code ? `/${code}` : ""})` };
}

/** Upload bytes, not a private authenticated web URL, for a subsequent passive rich-media send. */
export async function uploadQqImage({ tokens, openid, bytes, fetch = globalThis.fetch }: { tokens: QqTokenSource; openid: string; bytes: Uint8Array; fetch?: Fetch }): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(openid) || bytes.byteLength > 5 * 1024 * 1024) return null;
  try {
    const response = await fetch(`${QQ_API_BASE}/v2/users/${openid}/files`, { method: "POST", headers: { authorization: `QQBot ${await tokens.get()}`, "content-type": "application/json" }, body: JSON.stringify({ file_type: 1, file_data: Buffer.from(bytes).toString("base64"), srv_send_msg: false }), redirect: "error", signal: AbortSignal.timeout(20_000) });
    const data = await response.json() as { file_info?: unknown };
    return response.ok && typeof data.file_info === "string" && data.file_info ? data.file_info : null;
  } catch { return null; }
}

/** One C2C send. Never retried here once a request may have reached QQ. */
export async function sendQqC2c({ tokens, fetch = globalThis.fetch, openid, content, replyTo, msgSeq = 1, mediaFileInfo, keyboard }: { tokens: QqTokenSource; fetch?: Fetch; openid: string; content: string; replyTo?: string | null; msgSeq?: number; mediaFileInfo?: string; keyboard?: QqKeyboard }): Promise<QqSendOutcome> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(openid)) return { outcome: "rejected", retryable: false, error: "Invalid recipient" };
  // Buttons ride on a markdown message (msg_type 2).
  const message = keyboard ? { markdown: { content: content.slice(0, 2000) }, msg_type: 2, keyboard } : { content: content.slice(0, 2000), msg_type: mediaFileInfo ? 7 : 0, ...(mediaFileInfo ? { media: { file_info: mediaFileInfo } } : {}) };
  const body = JSON.stringify({ ...message, msg_seq: msgSeq, ...(replyTo ? { msg_id: replyTo } : {}) });
  const post = async (): Promise<QqSendOutcome | { status: 401 }> => {
    let token: string;
    try { token = await tokens.get(); } catch { return { outcome: "rejected", retryable: true, error: "QQ token unavailable" }; }
    let response: Response;
    try { response = await fetch(`${QQ_API_BASE}/v2/users/${openid}/messages`, { method: "POST", headers: { authorization: `QQBot ${token}`, "content-type": "application/json" }, body, signal: AbortSignal.timeout(20_000), redirect: "error" }); }
    catch { return { outcome: "uncertain", error: "QQ send interrupted; outcome unknown" }; }
    const data = await response.json().catch(() => null) as { id?: unknown; code?: unknown } | null;
    if (response.ok) return typeof data?.id === "string" && data.id ? { outcome: "accepted", messageId: data.id } : { outcome: "uncertain", error: "QQ accepted without a message id" };
    return response.status === 401 ? { status: 401 } : classifySend(response.status, typeof data?.code === "number" ? data.code : null);
  };
  const first = await post();
  if (!("status" in first)) return first;
  // An expired token is rejected before delivery; refresh once.
  tokens.invalidate();
  const second = await post();
  return "status" in second ? classifySend(401, null) : second;
}

export type QqKeyboard = { content: { rows: { buttons: { id: string; group_id: string; render_data: { label: string; visited_label: string; style: number }; action: { type: 1; data: string; permission: { type: 2 }; click_limit: 1 } }[] }[] } };
/** One row of single-use callback buttons; a click arrives as INTERACTION_CREATE with the button's data. */
export function qqButtons(group: string, buttons: { id: string; label: string; visited: string; data: string; style?: number }[]): QqKeyboard {
  return { content: { rows: [{ buttons: buttons.map(b => ({ id: b.id, group_id: group, render_data: { label: b.label, visited_label: b.visited, style: b.style ?? 1 }, action: { type: 1, data: b.data, permission: { type: 2 }, click_limit: 1 } })) }] } };
}
export type QqInteraction = { id: string; openid: string; data: string };
export function parseInteractionEvent(d: unknown): QqInteraction | null {
  const event = record(d), id = text(event.id), openid = text(event.user_openid), data = text(record(record(event.data).resolved).button_data);
  return id && openid && data ? { id, openid, data } : null;
}
/** QQ shows an error on the button unless the click is acknowledged promptly. */
export async function ackQqInteraction({ tokens, id, fetch = globalThis.fetch }: { tokens: QqTokenSource; id: string; fetch?: Fetch }) {
  const response = await fetch(`${QQ_API_BASE}/interactions/${encodeURIComponent(id)}`, { method: "PUT", headers: { authorization: `QQBot ${await tokens.get()}`, "content-type": "application/json" }, body: JSON.stringify({ code: 0 }), signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw new QqTransportError(`Interaction ACK failed (${response.status})`);
}

type WebSocketLike = { readyState: number; send(data: string): void; close(code?: number): void; addEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void): void };
export type QqAttachment = { url: string; name: string; mime: string; size?: number };
export type QqC2cMessage = { id: string; openid: string; content: string; quoted: string; timestamp: string; quotedId?: string; attachments?: QqAttachment[] };

const attachmentSizeCap = 20 * 1024 * 1024;
function attachmentUrl(attachment: QqAttachment): URL {
  const url = new URL(attachment.url);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !["multimedia.nt.qq.com", "gchat.qpic.cn", "c2cpicdw.qpic.cn", "file.bot.qq.com"].includes(url.hostname)) throw new QqTransportError("Invalid QQ attachment URL");
  if (attachment.size !== undefined && (!Number.isFinite(attachment.size) || attachment.size < 0 || attachment.size > attachmentSizeCap)) throw new QqTransportError("Attachment exceeds size limit");
  return url;
}
function validAttachmentMime(mime: string, expected: string): boolean {
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)
    && (!expected || expected === mime || mime === "application/octet-stream")
    && (!expected.startsWith("image/") || mime.startsWith("image/"));
}
/** Event URLs are untrusted. Only QQ media CDN endpoints, without redirects or credentials. */
export async function downloadQqAttachment(attachment: QqAttachment, fetch: Fetch = globalThis.fetch) {
  const url = attachmentUrl(attachment);
  const cap = attachmentSizeCap;
  const response = await fetch(url.href, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const expected = attachment.mime.split(";")[0]!.trim().toLowerCase();
  if (!response.ok || !response.body || !validAttachmentMime(mime, expected)) {
    await response.body?.cancel(); throw new QqTransportError("Invalid attachment content type");
  }
  if (Number(response.headers.get("content-length")) > cap) { await response.body.cancel(); throw new QqTransportError("Attachment exceeds size limit"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      size += chunk.value.byteLength;
      if (size > cap) throw new QqTransportError("Attachment exceeds size limit");
      chunks.push(chunk.value);
      chunk = await reader.read();
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return { name: attachment.name, mime, bytes: Buffer.concat(chunks, size) };
}
export type QqGatewayStatus = { state: "stopped" | "connecting" | "ready" | "backoff" | "fatal"; appId: string; readyAt: string | null; lastEventAt: string | null; reconnects: number; lastCloseCode: number | null; resumable: boolean };
type Payload = { op?: number; t?: string; s?: unknown; d?: unknown };
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** A private message event, or null. Quoted replies (message_type 103) carry the quoted text. */
export function parseC2cEvent(d: unknown): QqC2cMessage | null {
  const event = record(d), id = text(event.id), openid = text(record(event.author).user_openid);
  if (!id || !openid) return null;
  const elements = Number(event.message_type) === 103 && Array.isArray(event.msg_elements) ? event.msg_elements : [];
  const attachments = Array.isArray(event.attachments) ? event.attachments.map(value => {
    const a = record(value);
    return { url: text(a.url), name: text(a.filename) || "attachment", mime: text(a.content_type), ...(typeof a.size === "number" ? { size: a.size } : {}) };
  }) : [];
  const quotedId = text(record(event.message_reference).message_id) || text(event.referenced_message_id);
  return { id, openid, content: text(event.content), quoted: elements.map(e => text(record(e).content)).join("\n"), timestamp: text(event.timestamp), ...(quotedId ? { quotedId } : {}), ...(attachments.length ? { attachments } : {}) };
}

/**
 * Gateway session with resume, heartbeat/zombie detection, token refresh on 4004 and
 * capped backoff. Delivery of the same event twice (resume/replay) is possible; the
 * consumer deduplicates by message id.
 */
export function createQqGateway({ appId, tokens, onMessage, onInteraction, fetch = globalThis.fetch, WebSocketImpl = globalThis.WebSocket as unknown as new (url: string) => WebSocketLike, log = () => {}, sleep, now = () => new Date(), helloTimeoutMs = 20_000 }: {
  appId: string; tokens: QqTokenSource; onMessage: (message: QqC2cMessage) => void; onInteraction?: (interaction: QqInteraction) => void; fetch?: Fetch; WebSocketImpl?: new (url: string) => WebSocketLike; log?: QqLog; sleep?: (ms: number) => Promise<unknown>; now?: () => Date; helloTimeoutMs?: number;
}) {
  let intents = C2C_INTENT | (onInteraction ? INTERACTION_INTENT : 0);
  let running = false, sessionId: string | null = null, seq: number | null = null, loop: Promise<void> | null = null, wake: (() => void) | null = null, endSession: ((code: number) => void) | null = null;
  const status: QqGatewayStatus = { state: "stopped", appId, readyAt: null, lastEventAt: null, reconnects: 0, lastCloseCode: null, resumable: false };

  async function gatewayUrl() {
    const response = await fetch(`${QQ_API_BASE}/gateway`, { headers: { authorization: `QQBot ${await tokens.get()}` }, signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (response.status === 401) tokens.invalidate();
    const data = await response.json().catch(() => null) as { url?: unknown } | null;
    if (!response.ok || typeof data?.url !== "string" || !/^wss:\/\//.test(data.url)) throw new QqTransportError(`Gateway URL unavailable (${response.status})`);
    return data.url;
  }

  function deliver(t: string | undefined, d: unknown) {
    // Group and other events are ignored (group chat is not enabled).
    const interaction = t === "INTERACTION_CREATE" ? parseInteractionEvent(d) : null;
    if (interaction) { try { onInteraction?.(interaction); } catch { log("qq.interaction_failed"); } return; }
    const message = t === "C2C_MESSAGE_CREATE" ? parseC2cEvent(d) : null;
    if (message) { try { onMessage(message); } catch { log("qq.handler_failed"); } }
  }
  /** One connection; resolves with the close code (0 = transport error). */
  function session(url: string) {
    return new Promise<number>((resolve) => {
      const ws = new WebSocketImpl(url);
      let heartbeat: ReturnType<typeof setInterval> | undefined, acked = true, settled = false;
      const finish = (code: number) => { if (settled) return; settled = true; clearInterval(heartbeat); clearTimeout(hello); endSession = null; try { ws.close(); } catch { /* already closed */ } resolve(code); };
      // No Hello (or no READY/RESUMED after it) in time: treat as a failed connection.
      const hello = setTimeout(() => { log("qq.handshake_timeout"); finish(0); }, helloTimeoutMs);
      endSession = finish;
      const send = (payload: unknown) => { try { ws.send(JSON.stringify(payload)); } catch { finish(0); } };
      const onHello = (d: unknown) => {
        const interval = Number(record(d).heartbeat_interval) || 30_000;
        heartbeat = setInterval(() => {
          // No ACK since the previous beat: the connection is a zombie, reconnect (resume).
          if (!acked) { log("qq.heartbeat_missed"); finish(0); return; }
          acked = false; send({ op: 1, d: seq });
        }, Math.max(5_000, interval * 0.8));
        void tokens.get().then(token => send(sessionId && seq !== null
          ? { op: 6, d: { token: `QQBot ${token}`, session_id: sessionId, seq } }
          : { op: 2, d: { token: `QQBot ${token}`, intents, shard: [0, 1], properties: { $os: "linux", $browser: "chrona", $device: "chrona" } } }), () => finish(0));
      };
      const onDispatch = (t: string | undefined, d: unknown) => {
        status.lastEventAt = now().toISOString();
        if (t === "READY" || t === "RESUMED") { clearTimeout(hello); if (t === "READY") sessionId = text(record(d).session_id) || null; markReady(t === "READY" ? "qq.ready" : "qq.resumed"); return; }
        deliver(t, d);
      };
      const ops: Partial<Record<number, (payload: Payload) => void>> = {
        0: payload => onDispatch(payload.t, payload.d),
        1: () => send({ op: 1, d: seq }), // server asks for an immediate heartbeat
        7: () => { log("qq.reconnect_requested"); finish(0); },
        9: payload => { if (!payload.d) { sessionId = null; seq = null; } log("qq.invalid_session", { resumable: Boolean(payload.d) }); finish(0); },
        10: payload => onHello(payload.d),
        11: () => { acked = true; },
      };
      ws.addEventListener("message", event => {
        let payload: Payload;
        try { payload = JSON.parse(String(event.data)) as Payload; } catch { return; }
        if (typeof payload.s === "number" && (seq === null || payload.s > seq)) seq = payload.s;
        if (typeof payload.op === "number") ops[payload.op]?.(payload);
      });
      ws.addEventListener("close", event => finish(typeof event.code === "number" ? event.code : 0));
      ws.addEventListener("error", () => finish(0));
    });
  }
  function markReady(event: string) { status.state = "ready"; status.readyAt = now().toISOString(); status.resumable = sessionId !== null; log(event, { appId }); }

  const stopped = () => !running;
  /** After a closed session: remember what the close code means and wait out the backoff. */
  async function afterClose(code: number, failures: number) {
    status.lastCloseCode = code || null; status.reconnects++;
    if (code === 4004) tokens.invalidate();
    if (SESSION_INVALID(code)) { sessionId = null; seq = null; }
    status.resumable = sessionId !== null;
    const delay = code === 4008 ? 60 : BACKOFF_SECONDS[Math.min(failures, BACKOFF_SECONDS.length - 1)]!;
    status.state = "backoff"; log("qq.reconnecting", { code, delaySeconds: delay });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([sleep ? sleep(delay * 1000) : new Promise(resolve => { timer = setTimeout(resolve, delay * 1000); }), new Promise<void>(resolve => { wake = resolve; })]);
    clearTimeout(timer); wake = null;
  }
  async function run() {
    let failures = 0;
    while (running) {
      status.state = "connecting";
      let code = 0; const started = Date.now();
      try { const url = await gatewayUrl(); if (stopped()) break; code = await session(url); }
      catch { log("qq.connect_failed"); }
      if (stopped()) break;
      if (code === 4014 && intents & INTERACTION_INTENT) { intents = C2C_INTENT; sessionId = null; seq = null; log("qq.interactions_disallowed"); continue; }
      if (FATAL_CLOSE.has(code)) { status.state = "fatal"; status.lastCloseCode = code; log("qq.fatal_close", { code }); running = false; return; }
      failures = Date.now() - started > 60_000 ? 0 : failures + 1;
      await afterClose(code, failures);
    }
    status.state = "stopped";
  }

  return {
    start() { if (running) return; running = true; loop = run(); },
    async stop() { running = false; wake?.(); endSession?.(1000); await loop; },
    status: () => ({ ...status }),
  };
}
