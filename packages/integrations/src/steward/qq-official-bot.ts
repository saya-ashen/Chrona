import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPLY_REF_ALPHABET, type DeliveryAdapter, type DeliveryOutcome } from "@chrona/contracts/steward";
import { renderChatNotification } from "./hermes-qq-delivery";
import { sendQqC2c, type QqC2cMessage, type QqLog, type QqTokenSource } from "./qq-official";

/**
 * Chrona's own QQ bot, above the transport: owner binding, message routing, passive replies
 * and the `chrona_qqbot` delivery adapter. Every private message to this bot is a Chrona turn
 * (no `/chrona` prefix needed; it is accepted and stripped). Nothing reaches Chrona before the
 * sender's app-scoped openid matches the owner binding; until then only help/binding work.
 */
export const DEDICATED_PLATFORM = "chrona_qq";
export const DEDICATED_CHANNEL = "chrona_qqbot";
const OPENID = /^[A-Za-z0-9_-]{1,128}$/;
const BIND_CODE_LENGTH = 8;
const BIND_ATTEMPTS = 5;

// ------------------------------------------------------------------ state ----
/** Shared by the server and the `chrona qq` CLI so both address the same state. */
export function qqBotConfig(env: Record<string, string | undefined> = process.env) {
  const appId = env.CHRONA_QQ_APP_ID?.trim() ?? "";
  if (!/^\d{5,20}$/.test(appId)) return null;
  const stateDir = env.CHRONA_QQ_STATE_DIR?.trim() || (env.CHRONA_DATA_DIR?.trim() ? join(env.CHRONA_DATA_DIR.trim(), "qq-bot", appId) : "");
  return stateDir ? { appId, stateDir, secretFile: env.CHRONA_QQ_SECRET_FILE?.trim() || null } : null;
}
/** `replacedOpenid` stays recorded so an interrupted owner change finishes its (idempotent) move on restart. */
export type QqBinding = { version: 1; appId: string; openid: string; workspaceId: string; boundAt: string; replacedOpenid?: string | null };
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

/** Per-app state directory (mode 700): binding, pending challenge, processed message ids, status. */
export function createQqBotState(dir: string, appId: string) {
  const file = (name: string) => join(dir, name);
  const ready = mkdir(dir, { recursive: true, mode: 0o700 });
  /** Cross-process mutex (the CLI mints codes while the server redeems them): mkdir is atomic. */
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
  function codeMatches(challenge: Challenge, code: string) {
    const expected = Buffer.from(challenge.codeSha256, "hex"), given = Buffer.from(codeHash(appId, code), "hex");
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
  async function burnAttempt(challenge: Challenge) {
    const attemptsLeft = challenge.attemptsLeft - 1;
    if (attemptsLeft <= 0) await rm(file("challenge.json"), { force: true }); else await writeJson(file("challenge.json"), { ...challenge, attemptsLeft });
  }
  async function binding() { await ready; const b = await readJson<QqBinding>(file("binding.json")); return b && b.appId === appId && OPENID.test(b.openid) && b.workspaceId ? b : null; }
  return {
    dir, binding,
    /** Operator-side: a fresh one-time code. Only its salted hash is stored; the code is shown once. */
    createChallenge({ workspaceId, ttlMinutes = 10, replace = false, now = new Date() }: { workspaceId: string; ttlMinutes?: number; replace?: boolean; now?: Date }) { return locked(async () => {
      const bound = await binding();
      if (!replace && bound) throw new Error("Already bound; pass replace to rebind");
      if (bound && bound.workspaceId !== workspaceId) throw new Error("A replacement binding must stay in the bound workspace");
      const code = Array.from({ length: BIND_CODE_LENGTH }, () => REPLY_REF_ALPHABET[randomInt(REPLY_REF_ALPHABET.length)]).join("");
      const expiresAt = new Date(now.getTime() + Math.min(Math.max(ttlMinutes, 1), 60) * 60_000).toISOString();
      await writeJson(file("challenge.json"), { appId, workspaceId, codeSha256: codeHash(appId, code), expiresAt, attemptsLeft: BIND_ATTEMPTS, replace } satisfies Challenge);
      return { code, expiresAt };
    }); },
    /** Bot-side: consume the challenge. Wrong codes burn attempts; success is single-use. */
    redeem(openid: string, code: string, at: Date): Promise<{ ok: true; binding: QqBinding; replaced: string | null } | { ok: false; reason: "no_challenge" | "expired" | "wrong_code" | "already_bound" }> { return locked(async () => {
      const challenge = await readJson<Challenge>(file("challenge.json"));
      if (!challenge || challenge.appId !== appId) return { ok: false, reason: "no_challenge" };
      if (Date.parse(challenge.expiresAt) <= at.getTime() || challenge.attemptsLeft <= 0) { await rm(file("challenge.json"), { force: true }); return { ok: false, reason: "expired" }; }
      if (!codeMatches(challenge, code)) { await burnAttempt(challenge); return { ok: false, reason: "wrong_code" }; }
      const previous = await binding();
      await rm(file("challenge.json"), { force: true });
      if (previous && (!challenge.replace || previous.workspaceId !== challenge.workspaceId)) return { ok: false, reason: "already_bound" };
      const replaced = previous && previous.openid !== openid ? previous.openid : null;
      const next: QqBinding = { version: 1, appId, openid, workspaceId: challenge.workspaceId, boundAt: at.toISOString(), replacedOpenid: replaced };
      await writeJson(file("binding.json"), next);
      return { ok: true as const, binding: next, replaced };
    }); },
    async challengePending(at: Date) { await ready; const c = await readJson<Challenge>(file("challenge.json")); return Boolean(c && c.appId === appId && c.attemptsLeft > 0 && Date.parse(c.expiresAt) > at.getTime()); },
    async loadSeen() { await ready; return (await readJson<{ id: string; at: number }[]>(file("seen.json"))) ?? []; },
    async saveSeen(rows: { id: string; at: number }[]) { await writeJson(file("seen.json"), rows); },
    async writeStatus(status: unknown) { await ready; await writeJson(file("status.json"), status); },
  };
}
export type QqBotState = ReturnType<typeof createQqBotState>;

// ---------------------------------------------------------------- routing ----
const REF = /^[2-9A-HJKMNP-Z]{4}$/i;
const HELP_WORDS = new Set(["help", "帮助", "?", "？", "用法", "菜单"]);
const LIST_PHRASES = new Set(["委托", "我的委托", "查看委托", "查看我的委托", "列表", "状态", "待办", "进度", "list", "ls", "status"]);
type ChatAction = "confirm" | "decline" | "snooze" | "done" | "dismiss" | "less_often" | "pause" | "resume" | "revoke" | "ack" | "feedback";
const ACTIONS = new Map<string, ChatAction>(Object.entries({
  确认: "confirm", 同意: "confirm", 批准: "confirm", confirm: "confirm", 拒绝: "decline", decline: "decline",
  暂后: "snooze", 稍后: "snooze", 晚点: "snooze", snooze: "snooze", 完成: "done", 已处理: "done", done: "done",
  忽略: "dismiss", dismiss: "dismiss", 少提醒: "less_often", 暂停: "pause", pause: "pause",
  恢复: "resume", 继续: "resume", resume: "resume", 撤销: "revoke", 取消: "revoke", 停止: "revoke", revoke: "revoke", stop: "revoke",
  收到: "ack", 已读: "ack", 知道了: "ack", ack: "ack", 反馈: "feedback", feedback: "feedback", 补充: "feedback", 回答: "feedback", 答复: "feedback",
} satisfies Record<string, ChatAction>));
const actionOf = (token: string | undefined) => ACTIONS.get((token ?? "").toLowerCase());
export type QqRoute =
  | { kind: "help" } | { kind: "list" } | { kind: "bind"; code: string }
  | { kind: "need_ref"; action: ChatAction }
  | { kind: "clarify"; reason: string; ref?: string }
  | { kind: "respond"; ref: string; action: ChatAction; note?: string; snoozeHours?: number }
  | { kind: "request"; text: string };

/** What follows a named ref: exactly one action, plus a note (feedback) or hours (snooze) — nothing else. */
function actionRoute(ref: string, rest: string[]): QqRoute {
  const action = actionOf(rest[0]);
  const problem = rest.some(t => REF.test(t) && !actionOf(t)) ? "multiple_refs" : !action ? "missing_action" : null;
  if (problem || !action) return { kind: "clarify", reason: problem ?? "missing_action", ref };
  const tail = rest.slice(1);
  if (action === "feedback") { const note = tail.join(" ").trim().slice(0, 1000); return note ? { kind: "respond", ref, action, note } : { kind: "clarify", reason: "missing_note", ref }; }
  return tailRoute(ref, action, tail);
}
function tailRoute(ref: string, action: ChatAction, tail: string[]): QqRoute {
  if (tail.some(t => { const other = actionOf(t); return other !== undefined && other !== action; })) return { kind: "clarify", reason: "multiple_actions", ref };
  // "取消 明天的会议" is not "revoke <ref>": unexplained words after an action mean we ask, never act.
  if (tail.length > (action === "snooze" ? 1 : 0)) return { kind: "clarify", reason: "extra_text", ref };
  if (action !== "snooze" || !tail.length) return { kind: "respond", ref, action };
  const hours = Number(/^(\d{1,3})\s*(?:小时|h|hr|hrs|hours?)$/i.exec(tail[0] ?? "")?.[1] ?? 0);
  return hours >= 1 && hours <= 168 ? { kind: "respond", ref, action, snoozeHours: hours } : { kind: "clarify", reason: "invalid_snooze", ref };
}

/** Deterministic: never picks a target the user did not name. Anything else is a request. */
function fixedRoute(text: string): QqRoute | null {
  const bind = /^(?:绑定|bind)\s+([A-Za-z0-9]{4,16})$/i.exec(text);
  if (bind?.[1]) return { kind: "bind", code: bind[1] };
  if (!text || HELP_WORDS.has(text.toLowerCase())) return { kind: "help" };
  return LIST_PHRASES.has(text.replace(/ /g, "").toLowerCase()) ? { kind: "list" } : null;
}
export function routeQqText(raw: string, quoted = ""): { route: QqRoute; text: string } {
  let text = raw.replace(/^\s*\/chrona(?=\s|$)/i, "").split(/\s+/).filter(Boolean).join(" ");
  const fixed = fixedRoute(text);
  if (fixed) return { route: fixed, text };
  let tokens = text.split(" ");
  const quotedTarget = actionOf(tokens[0]) && !REF.test(tokens[1] ?? "") ? quotedRef(quoted) : null;
  if (quotedTarget) { text = `${quotedTarget} ${text}`; tokens = text.split(" "); }
  const [head = "", second = ""] = tokens;
  if (REF.test(head)) return { route: actionRoute(head.toUpperCase(), tokens.slice(1)), text };
  const action = actionOf(head);
  if (!action) return { route: { kind: "request", text }, text };
  if (REF.test(second)) return { route: actionRoute(second.toUpperCase(), [head, ...tokens.slice(2)]), text };
  return { route: { kind: "need_ref", action }, text };
}
/** The single reply ref of a quoted Chrona notification, else null. */
export function quotedRef(quoted: string) {
  if (!quoted.trimStart().startsWith("【Chrona】")) return null;
  const refs = new Set([...quoted.matchAll(/(?:\/chrona\s+|回复「|回复：\s*)([2-9A-HJKMNP-Z]{4})(?![A-Za-z0-9])/gi)].map(m => String(m[1]).toUpperCase()));
  return refs.size === 1 ? [...refs][0] ?? null : null;
}

// ---------------------------------------------------------------- replies ----
const HELP = `【Chrona】这是 Chrona 管家的专用机器人。这里的每条私聊都交给 Chrona 处理（不经过 Hermes），不需要 /chrona 前缀。
直接说需求 —— 例如：帮我准备周五的答辩
进度 —— 查看我的工作、委托与待回复事项（只读）
<码> 补充 <内容> —— 补充信息或回答问题
<码> 确认｜拒绝 —— 回应授权或委托提议（提议不等于授权）
<码> 暂停｜恢复｜撤销 —— 管理工作或委托
<码> 收到｜暂后 [N小时]｜完成｜忽略｜少提醒｜反馈 <文字> —— 处理通知
引用一条 Chrona 通知再发「暂后」等动作，会自动使用该通知的回复码。
闲聊也会被当作一件交给管家的事；只想看状态请发「进度」。`;
const UNBOUND = "【Chrona】这是 Chrona 的私人管家机器人，尚未绑定主人。主人请在 Chrona 管理端取得一次性绑定码后发送：绑定 <绑定码>。未绑定前不处理任何其他内容。";
const NOT_OWNER = "【Chrona】这是私人机器人，你没有使用权限。本条未做任何处理。";
const BIND_FAIL: Record<string, string> = {
  no_challenge: "当前没有待使用的绑定码，请让主人在 Chrona 管理端重新生成。",
  expired: "绑定码已过期或尝试次数已用完，请重新生成。",
  wrong_code: "绑定码不正确（多次错误后会失效）。",
  already_bound: "这个机器人已经绑定了主人，未做更改。",
};
const STATUS: Record<string, string> = { proposed: "待确认", active: "生效中", paused: "已暂停", revoked: "已撤销", expired: "已过期", open: "待处理", snoozed: "已暂后", resolved: "已完成", dismissed: "已忽略", received: "已收到", running: "处理中", waiting_input: "待补充", waiting_authorization: "待授权", result_ready: "成果待验收", accepted: "已验收", failed: "失败", cancelled: "已取消" };
const KIND: Record<string, string> = { decision: "需决定", change: "变化", commitment: "承诺", suggestion: "建议", result: "成果", failure: "故障" };
const DONE: Record<string, string> = { confirm: "已确认", decline: "已拒绝", snooze: "已暂后", done: "已标记完成", dismiss: "已忽略", less_often: "已降低提醒频率", pause: "已暂停", resume: "已恢复", revoke: "已撤销", ack: "已记为收到（不代表事项完成）", feedback: "反馈已记录" };
const CLARIFY: Record<string, string> = {
  missing_action: "请在回复码后写明动作，例如：{ref} 收到。", missing_note: "反馈需要内容，例如：{ref} 反馈 只告诉我关键服务。",
  multiple_refs: "一条消息只能处理一个回复码。", extra_text: "动作后面有多余内容，没有执行。只处理事项请发：{ref} <动作>；新需求请不要以动作词开头，或引用前先确认。", multiple_actions: "一条消息只能有一个动作。", invalid_snooze: "暂后时长需在 1–168 小时，例如：{ref} 暂后 4小时。",
  unknown_ref: "没有找到这个回复码（可能已过期或不属于你）。发送「进度」查看有效回复码。", ref_not_in_message: "请在消息里写出回复码。",
  action_not_in_message: "动作与回复码不匹配，请重新发送：<码> <动作>。", note_required: "反馈需要内容。",
  source_not_connected: "Chrona 里还没有可用的该来源连接，请先在网页的连接页面接入。", multiple_sources: "Chrona 里有多个同类来源，请在网页中选择。",
  not_bound_to_this_chat: "这个回复码对应的事项不是发往本聊天的，请在网页处理。",
};
const oneLine = (value: unknown, cap: number) => String(value ?? "").split(/\s+/).join(" ").slice(0, cap);
type Pending = { items?: { ref?: string | null; kind?: string; title?: string }[]; delegations?: { ref?: string | null; status?: string; purpose?: string }[]; works?: { ref?: string | null; status?: string; request?: string }[] };

const describe = (table: Record<string, string>, key: string | undefined) => (key && table[key]) || key || "";
const label = (ref?: string | null) => ref || "无回复码，请在网页处理";
export function renderPending(data: Pending, header = true) {
  const rows = [
    ...(data.works ?? []).slice(0, 10).map(w => `工作 ${label(w.ref)}｜${describe(STATUS, w.status)}｜${oneLine(w.request, 80)}`),
    ...(data.delegations ?? []).slice(0, 10).map(d => `委托 ${label(d.ref)}｜${describe(STATUS, d.status)}｜${oneLine(d.purpose, 80)}`),
    ...(data.items ?? []).slice(0, 10).map(i => `事项 ${label(i.ref)}｜${describe(KIND, i.kind)}｜${oneLine(i.title, 80)}`),
  ];
  return [...(header ? ["【Chrona】你的工作、委托与待回复事项（只读）"] : []), ...(rows.length ? rows : ["当前没有发往本聊天的工作、委托或待回复事项。"]), "操作：<码> 补充 <内容>｜确认｜拒绝｜暂停｜恢复｜撤销｜收到｜暂后｜完成"].join("\n");
}
type WriteResult = { status?: string; ref?: string; state?: string; current?: string; reason?: string; subject?: { title?: string } };
const clarifyText = (reason: string | undefined, ref: string) => (describe(CLARIFY, reason) || "请检查回复码与动作。").replace("{ref}", ref);
function renderWrite(raw: unknown, route: Extract<QqRoute, { kind: "respond" | "request" }>) {
  const result = (raw ?? {}) as WriteResult;
  if (route.kind === "request") return result.status === "received"
    ? [`【Chrona】已收到，码 ${result.ref ?? ""}：${oneLine(route.text, 60)}`, "处理中；需要你补充或有成果时会在这里告诉你（发送≠完成）。", `随时可：${result.ref ?? "<码>"} 补充 <内容>｜暂停｜撤销`].join("\n")
    : "【Chrona】未做任何更改。" + clarifyText(result.reason, "<码>");
  const done = describe(DONE, route.action) || "已处理";
  const lines: Partial<Record<string, () => string>> = {
    applied: () => `【Chrona】${route.ref} ${done}：${oneLine(result.subject?.title, 120)}（当前：${describe(STATUS, result.state)}）`,
    unchanged: () => `【Chrona】${route.ref} 无需更改，当前已是「${describe(STATUS, result.current)}」。`,
    conflict: () => `【Chrona】${route.ref} 当前状态为「${describe(STATUS, result.current)}」，无法${done.slice(1)}，未做更改。`,
  };
  return lines[result.status ?? ""]?.() ?? "【Chrona】未做任何更改。" + clarifyText(result.reason, route.ref);
}

// -------------------------------------------------------------------- bot ----
export type QqChatIdentity = { platform: "chrona_qq"; chatType: "dm"; userId: string; chatId: string; messageId: string; userText: string; route: "dedicated_bot" };
/** In-process Chrona chat service for the bound workspace (authorization stays server-side). */
export type QqChatPort = {
  request(input: { chat: QqChatIdentity; text: string }): Promise<unknown>;
  respond(input: { chat: QqChatIdentity; ref: string; action: ChatAction; note?: string; snoozeHours?: number }): Promise<unknown>;
  pending(input: { chat: QqChatIdentity }): Promise<Pending>;
};

export function createQqBotHandler({ state, chat, reply, onBound, log = () => {}, now = () => new Date() }: {
  state: QqBotState; chat: (binding: QqBinding) => QqChatPort;
  /** Passive reply to one inbound message. */
  reply: (openid: string, messageId: string, text: string) => Promise<unknown>;
  onBound: (binding: QqBinding, replaced: string | null) => Promise<void>; log?: QqLog; now?: () => Date;
}) {
  let seen: Map<string, number> | null = null;
  const strangerReplies = new Map<string, number>();
  let queue = Promise.resolve();
  /** At-most-once within the retained window (2000 ids / 7 days): the id is persisted before Chrona sees the message, so a gateway replay or restart does not repeat a write. */
  async function firstSeen(id: string) {
    seen ??= new Map((await state.loadSeen()).map(row => [row.id, row.at]));
    if (seen.has(id)) return false;
    const at = now().getTime();
    seen.set(id, at);
    for (const [key, time] of seen) if (seen.size > 2000 || at - time > 7 * 86400_000) seen.delete(key); else break;
    await state.saveSeen([...seen].map(([key, time]) => ({ id: key, at: time })));
    return true;
  }
  async function bind(message: QqC2cMessage, code: string, send: (body: string) => Promise<unknown>) {
    const result = await state.redeem(message.openid, code, now());
    log("qq.bind_attempt", { ok: result.ok, reason: result.ok ? null : result.reason });
    if (!result.ok) return send(`【Chrona】绑定未完成：${BIND_FAIL[result.reason] ?? ""}`);
    await onBound(result.binding, result.replaced);
    return send("【Chrona】绑定成功。这个 QQ 身份现在是 Chrona 的主人，可直接发需求；发送「帮助」查看用法。");
  }
  /** Fixed text only, at most once per sender per hour (help always answers); no Chrona data is read. */
  function stranger(message: QqC2cMessage, route: QqRoute, bound: boolean, send: (body: string) => Promise<unknown>) {
    const at = now().getTime(), last = strangerReplies.get(message.openid) ?? 0;
    if (at - last < 3600_000 && route.kind !== "help") return;
    strangerReplies.set(message.openid, at);
    log("qq.unbound_sender", { bound });
    return send(bound ? NOT_OWNER : UNBOUND);
  }
  async function owner(message: QqC2cMessage, route: QqRoute, text: string, port: QqChatPort) {
    const chatIdentity: QqChatIdentity = { platform: "chrona_qq", chatType: "dm", userId: message.openid, chatId: message.openid, messageId: message.id, userText: text.slice(0, 2000), route: "dedicated_bot" };
    switch (route.kind) {
      case "help": return HELP;
      case "bind": return HELP;
      case "list": return renderPending(await port.pending({ chat: chatIdentity }));
      case "clarify": return "【Chrona】未做任何更改。" + clarifyText(route.reason, route.ref ?? "<码>");
      case "need_ref": return "【Chrona】未做任何更改：请写明回复码，我不会猜测对象。\n" + renderPending(await port.pending({ chat: chatIdentity }), false);
      case "respond": return renderWrite(await port.respond({ chat: chatIdentity, ref: route.ref, action: route.action, ...(route.note ? { note: route.note } : {}), ...(route.snoozeHours ? { snoozeHours: route.snoozeHours } : {}) }), route);
      case "request": return renderWrite(await port.request({ chat: chatIdentity, text: route.text.slice(0, 2000) }), route);
    }
  }
  async function handle(message: QqC2cMessage) {
    if (!OPENID.test(message.openid) || !await firstSeen(message.id)) return;
    const { route, text } = routeQqText(message.content, message.quoted);
    const send = (body: string) => reply(message.openid, message.id, body).catch(() => log("qq.reply_failed"));
    if (route.kind === "bind") return bind(message, route.code, send);
    const binding = await state.binding();
    if (binding?.openid !== message.openid) return stranger(message, route, Boolean(binding), send);
    try { return await send(await owner(message, route, text, chat(binding))); }
    catch (error) {
      const code = (error as { code?: unknown }).code;
      log("qq.chat_failed", { code: typeof code === "string" ? code : "error" });
      return send(code === "FORBIDDEN" ? "【Chrona】这个聊天没有 Chrona 权限，未做任何更改。" : "【Chrona】处理失败，未做任何更改。请稍后重试或在网页处理。");
    }
  }
  return {
    /** Serialized: one message at a time, in arrival order. */
    onMessage(message: QqC2cMessage) { queue = queue.then(async () => { await handle(message); }).catch(() => log("qq.handler_failed")); return queue; },
  };
}

// --------------------------------------------------------------- delivery ----
/**
 * `chrona_qqbot` outbox adapter: one active C2C send per claim, never retried by itself
 * (QQ sends have no idempotency key, so unknown outcomes stay `uncertain`). A local
 * per-recipient window keeps below QQ's 20/min receiver limit; excess is a retryable reject.
 */
export function createChronaQqDelivery({ tokens, allowedRecipients, publicUrl, fetch, perMinute = 10, now = Date.now }: {
  tokens: QqTokenSource; allowedRecipients: () => ReadonlySet<string>; publicUrl?: string | null; fetch?: (input: string, init?: RequestInit) => Promise<Response>; perMinute?: number; now?: () => number;
}): DeliveryAdapter & { idempotent: false } {
  const sent = new Map<string, number[]>();
  return { channel: DEDICATED_CHANNEL, idempotent: false, async send(message): Promise<DeliveryOutcome> {
    const recipient = message.recipient ?? "";
    const openid = recipient.startsWith(`${DEDICATED_PLATFORM}:`) ? recipient.slice(DEDICATED_PLATFORM.length + 1) : "";
    if (!OPENID.test(openid) || !allowedRecipients().has(recipient)) return { outcome: "rejected", retryable: false, error: "Recipient is not authorized" };
    const at = now(), window = (sent.get(recipient) ?? []).filter(t => at - t < 60_000);
    if (window.length >= perMinute) return { outcome: "rejected", retryable: true, error: "Local QQ rate limit" };
    sent.set(recipient, [...window, at]);
    const body = renderChatNotification(message, publicUrl, ref => `回复：${ref} 收到｜暂后｜完成｜暂停（直接回复即可，发送≠已读）`);
    const result = await sendQqC2c({ tokens, fetch, openid, content: body });
    if (result.outcome === "accepted") return { outcome: "accepted", receiptRef: `${DEDICATED_PLATFORM}:${result.messageId}` };
    return result;
  } };
}
