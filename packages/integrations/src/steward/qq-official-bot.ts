import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REF_ALPHABET, type DeliveryAdapter, type DeliveryOutcome } from "@chrona/contracts/steward";
import { sendQqC2c, type QqC2cMessage, type QqLog, type QqTokenSource } from "./qq-official";

export const DEDICATED_PLATFORM = "chrona_qq";
export const DEDICATED_CHANNEL = "chrona_qqbot";
const OPENID = /^[A-Za-z0-9_-]{1,128}$/;
export function qqBotConfig(env: Record<string, string | undefined> = process.env) {
  const appId = env.CHRONA_QQ_APP_ID?.trim() ?? "";
  if (!/^\d{5,20}$/.test(appId)) return null;
  const stateDir = env.CHRONA_QQ_STATE_DIR?.trim() || (env.CHRONA_DATA_DIR?.trim() ? join(env.CHRONA_DATA_DIR.trim(), "qq-bot", appId) : "");
  return stateDir ? { appId, stateDir, secretFile: env.CHRONA_QQ_SECRET_FILE?.trim() || null } : null;
}
export type QqBinding = { version: 1; appId: string; openid: string; workspaceId: string; boundAt: string };
type Challenge = { appId: string; workspaceId: string; codeSha256: string; expiresAt: string; attemptsLeft: number; replace: boolean };
async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function writeJson(path: string, value: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, path);
}
const codeHash = (appId: string, code: string) => createHash("sha256").update(`chrona-qq-bind:${appId}:${code.toUpperCase()}`).digest("hex");
export function createQqBotState(dir: string, appId: string) {
  const file = (name: string) => join(dir, name);
  const ready = mkdir(dir, { recursive: true, mode: 0o700 });
  async function locked<T>(fn: () => Promise<T>): Promise<T> {
    await ready;
    const lock = file(".lock");
    for (let i = 0; ; i++) {
      try { await mkdir(lock); break; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const age = await stat(lock).then(info => Date.now() - info.mtimeMs, () => 0);
        if (age > 10_000) { await rmdir(lock).catch(() => {}); continue; }
        if (i > 200) throw new Error("QQ bot state is locked", { cause: error });
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    try { return await fn(); } finally { await rmdir(lock).catch(() => {}); }
  }
  async function binding() { await ready; const b = await readJson<QqBinding>(file("binding.json")); return b && b.appId === appId && OPENID.test(b.openid) && b.workspaceId ? b : null; }
  return {
    dir, binding,
    createChallenge({ workspaceId, ttlMinutes = 10, replace = false, now = new Date() }: { workspaceId: string; ttlMinutes?: number; replace?: boolean; now?: Date }) { return locked(async () => {
      const bound = await binding();
      if (!replace && bound) throw new Error("Already bound; pass replace to rebind");
      if (bound && bound.workspaceId !== workspaceId) throw new Error("A replacement binding must stay in the bound workspace");
      const code = Array.from({ length: 8 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join("");
      const expiresAt = new Date(now.getTime() + Math.min(Math.max(ttlMinutes, 1), 60) * 60_000).toISOString();
      await writeJson(file("challenge.json"), { appId, workspaceId, codeSha256: codeHash(appId, code), expiresAt, attemptsLeft: 5, replace } satisfies Challenge);
      return { code, expiresAt };
    }); },
    redeem(openid: string, code: string, at: Date): Promise<{ ok: true; binding: QqBinding } | { ok: false; reason: "no_challenge" | "expired" | "wrong_code" | "already_bound" }> { return locked(async () => {
      const challenge = await readJson<Challenge>(file("challenge.json"));
      if (!challenge || challenge.appId !== appId) return { ok: false, reason: "no_challenge" };
      if (Date.parse(challenge.expiresAt) <= at.getTime() || challenge.attemptsLeft <= 0) { await rm(file("challenge.json"), { force: true }); return { ok: false, reason: "expired" }; }
      const expected = Buffer.from(challenge.codeSha256, "hex"), given = Buffer.from(codeHash(appId, code), "hex");
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        if (--challenge.attemptsLeft <= 0) await rm(file("challenge.json"), { force: true }); else await writeJson(file("challenge.json"), challenge);
        return { ok: false, reason: "wrong_code" };
      }
      const previous = await binding();
      await rm(file("challenge.json"), { force: true });
      if (previous && (!challenge.replace || previous.workspaceId !== challenge.workspaceId)) return { ok: false, reason: "already_bound" };
      const next: QqBinding = { version: 1, appId, openid, workspaceId: challenge.workspaceId, boundAt: at.toISOString() };
      await writeJson(file("binding.json"), next);
      return { ok: true, binding: next };
    }); },
    async challengePending(at: Date) { await ready; const c = await readJson<Challenge>(file("challenge.json")); return Boolean(c && c.appId === appId && c.attemptsLeft > 0 && Date.parse(c.expiresAt) > at.getTime()); },
    async loadSeen() { await ready; return (await readJson<{ id: string; at: number }[]>(file("seen.json"))) ?? []; },
    async saveSeen(rows: { id: string; at: number }[]) { await writeJson(file("seen.json"), rows); },
    async writeStatus(status: unknown) { await ready; await writeJson(file("status.json"), status); },
  };
}
export type QqBotState = ReturnType<typeof createQqBotState>;
export type QqChatPort = { handleMessage(input: { workspaceId: string; channel: "chrona_qqbot"; text: string; externalId: string }): Promise<{ reply: string; affairId?: string | null }> };
const HELP_WORDS = new Set(["help", "帮助", "?", "？", "用法", "菜单"]);
const UNBOUND = "【Chrona】这是 Chrona 的私人管家机器人，尚未绑定主人。主人请在 Chrona 管理端取得一次性绑定码后发送：绑定 <绑定码>。未绑定前不处理任何其他内容。";
const NOT_OWNER = "【Chrona】这是私人机器人，你没有使用权限。本条未做任何处理。";
const BIND_FAIL = { no_challenge: "当前没有待使用的绑定码，请重新生成。", expired: "绑定码已过期或尝试次数已用完，请重新生成。", wrong_code: "绑定码不正确（多次错误后会失效）。", already_bound: "这个机器人已经绑定了主人，未做更改。" };

/** Reservations count even failed/uncertain sends; sequence numbers must never be reused. */
export function createQqPassiveReplies(reply: (openid: string, id: string, text: string, sequence: number) => Promise<unknown>, now = Date.now) {
  const windows = new Map<string, { until: number; count: number }>();
  return async (message: QqC2cMessage, text: string): Promise<boolean> => {
    const at = now(), key = `${message.openid}:${message.id}`;
    const timestamp = Date.parse(message.timestamp);
    const window = windows.get(key) ?? { until: (Number.isFinite(timestamp) ? timestamp : at) + 3600_000, count: 0 };
    windows.set(key, window);
    for (const [id, value] of windows) if (value.until < at && id !== key) windows.delete(id);
    if (at >= window.until || window.count >= 4) return false;
    await reply(message.openid, message.id, text, ++window.count);
    return true;
  };
}
export function createQqBotHandler({ state, chat, reply, enqueueFinal, onBound = async () => {}, log = () => {}, now = () => new Date(), timers = globalThis }: {
  state: QqBotState; chat: QqChatPort;
  reply: (openid: string, messageId: string, text: string, sequence: number) => Promise<unknown>;
  enqueueFinal: (binding: QqBinding, messageId: string, text: string, affairId?: string | null) => Promise<void>;
  onBound?: (binding: QqBinding) => Promise<void>; log?: QqLog; now?: () => Date;
  timers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
}) {
  let seen: Map<string, number> | null = null, queue = Promise.resolve();
  const strangerReplies = new Map<string, number>();
  const passive = createQqPassiveReplies(reply, () => now().getTime());
  async function handle(message: QqC2cMessage) {
    if (!OPENID.test(message.openid)) return;
    seen ??= new Map((await state.loadSeen()).map(row => [row.id, row.at]));
    if (seen.has(message.id)) return;
    const at = now().getTime();
    seen.set(message.id, at);
    for (const [id, time] of seen) if (seen.size > 2000 || at - time > 7 * 86400_000) seen.delete(id);
    await state.saveSeen([...seen].map(([id, at]) => ({ id, at })));
    // An interrupted send may already have reached QQ. Only local quota/window
    // exhaustion falls back to the outbox; unknown outcomes are not resent.
    const send = (text: string) => passive(message, text).catch(() => { log("qq.reply_failed"); return true; });
    const text = message.content.trim();
    const bind = /^(?:绑定|bind)\s+([A-Za-z0-9]{4,16})$/i.exec(text);
    if (bind?.[1]) {
      const result = await state.redeem(message.openid, bind[1], now());
      if (!result.ok) { await send(`【Chrona】绑定未完成：${BIND_FAIL[result.reason]}`); return; }
      await onBound(result.binding);
      await send("【Chrona】绑定成功。可直接发需求。"); return;
    }
    const binding = await state.binding();
    if (binding?.openid !== message.openid) {
      const last = strangerReplies.get(message.openid);
      if (last !== undefined && at - last < 3600_000 && !HELP_WORDS.has(text.toLowerCase())) return;
      strangerReplies.set(message.openid, at);
      await send(binding ? NOT_OWNER : UNBOUND); return;
    }
    if (!text) return;
    let ack: Promise<boolean> | undefined;
    const timer = timers.setTimeout(() => { ack = send("收到，处理中…"); }, 8000);
    let result: { reply: string; affairId?: string | null };
    try { result = await chat.handleMessage({ workspaceId: binding.workspaceId, channel: DEDICATED_CHANNEL, text: message.content, externalId: message.id }); }
    catch { log("qq.chat_failed"); result = { reply: "【Chrona】处理未完成，请稍后重试或在网页查看。" }; }
    finally { timers.clearTimeout(timer); }
    await ack;
    if (!await send(result.reply)) await enqueueFinal(binding, message.id, result.reply, result.affairId);
  }
  return { onMessage(message: QqC2cMessage) { queue = queue.then(() => handle(message)).catch(() => log("qq.handler_failed")); return queue; }, drain: () => queue };
}

/** Active sends are only called by the notification outbox. */
export function createChronaQqDelivery({ tokens, allowedRecipients, publicUrl, fetch, perMinute = 10, now = Date.now }: {
  tokens: QqTokenSource; allowedRecipients: () => ReadonlySet<string>; publicUrl?: string | null; fetch?: (input: string, init?: RequestInit) => Promise<Response>; perMinute?: number; now?: () => number;
}): DeliveryAdapter & { idempotent: false } {
  const sent = new Map<string, number[]>();
  return { channel: DEDICATED_CHANNEL, idempotent: false, async send(message): Promise<DeliveryOutcome> {
    const allowed = allowedRecipients();
    const recipient = message.recipient ?? (allowed.size === 1 ? [...allowed][0]! : "");
    const openid = recipient.startsWith(`${DEDICATED_PLATFORM}:`) ? recipient.slice(DEDICATED_PLATFORM.length + 1) : "";
    if (!OPENID.test(openid) || !allowedRecipients().has(recipient)) return { outcome: "rejected", retryable: false, error: "Recipient is not authorized" };
    const at = now(), window = (sent.get(recipient) ?? []).filter(t => at - t < 60_000);
    if (window.length >= perMinute) return { outcome: "rejected", retryable: true, error: "Local QQ rate limit" };
    sent.set(recipient, [...window, at]);
    const link = message.link?.startsWith("/") && publicUrl ? `${publicUrl.replace(/\/$/, "")}${message.link}` : message.link;
    const result = await sendQqC2c({ tokens, fetch, openid, content: [message.title, message.body, link].filter(Boolean).join("\n\n") });
    return result.outcome === "accepted" ? { outcome: "accepted", receiptRef: `${DEDICATED_PLATFORM}:${result.messageId}` } : result;
  } };
}
