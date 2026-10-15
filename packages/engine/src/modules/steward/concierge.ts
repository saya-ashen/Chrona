import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { CONCIERGE_TOOLS, conciergeToolInputSchemas as schemas, chatReplySchema, chatInputSchema, RUN_LIMITS, REF_PATTERN, webPreflightSchema, webObservedSchema, type ChatReply, type DeliveryChannel } from "@chrona/contracts/steward";
import type { StewardPorts } from "./service";
import { createAffairs, requireAffair } from "./affairs";
import { createAsks } from "./asks";
import { createPreferences } from "./preferences";
import { createChatLog } from "./chat-log";
import { StewardError } from "./errors";
import { notificationSettings } from "./settings";
import { publicWebInput, isPublicWebUrl } from "./web-url";
import { toAsk, toPreference } from "./store";
import { audit } from "./audit";
import type { AgentToolReply } from "./agent-tools";

type MessageInput = { workspaceId: string; channel: DeliveryChannel; text: string; externalId?: string };
type Session = { workspaceId: string; deadline: Date; closed: boolean; calls: number; webCalls: number; observed: Set<string>; effects: ChatReply["effects"]; touched: Set<string>; reply?: string; tail: Promise<unknown> };
const descriptions: Record<keyof typeof schemas, string> = {
  concierge_context: "Call first: read recent chat, open affairs and asks, and preferences.",
  concierge_create_affair: "Create a new affair for the user's need; retain their intended request.",
  concierge_add_to_affair: "Add a supplement or feedback to an existing affair.",
  concierge_resolve_ask: "Record the user's answer or explicit approval decision on an open ask.",
  concierge_set_affair_status: "Pause, continue or end an affair as requested by the user.",
  concierge_remember: "Remember a stable preference explicitly stated by the user.",
  concierge_forget: "Forget a preference when the user requests it.",
  concierge_reply: "Mandatory terminal tool: save the short reply the user will see.",
};
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const refusal = (error: unknown): AgentToolReply => ({ ok: false, error: { code: error instanceof StewardError ? error.code : "invalid", message: error instanceof StewardError ? error.message : "Invalid concierge request" } });

/** Capabilities exist only for the synchronous front-door session. Never persist raw tokens. */
export function createConcierge(ports: StewardPorts) {
  const sessions = new Map<string, Session>();
  const pending = new Map<string, Promise<ChatReply>>();
  const ctx = (workspaceId: string) => ({ db: ports.db, now: ports.now, workspaceId });
  function session(token: string) {
    const s = sessions.get(hash(token));
    if (!s || s.closed || s.deadline <= ports.now() || s.reply !== undefined) throw new StewardError("forbidden", "Concierge capability is no longer valid");
    return s;
  }
  async function context(s: Session) {
    const where = { workspaceId: s.workspaceId };
    const [messages, affairs, asks, preferences, workspace] = await Promise.all([
      createChatLog(ctx(s.workspaceId)).recent(20),
      ports.db.affair.findMany({ where: { ...where, status: { not: "done" } }, orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }], take: 20, select: { id: true, title: true, status: true, agentState: true, summary: true, nextStep: true, lastActivityAt: true, _count: { select: { asks: { where: { status: "open" } } } } } }),
      ports.db.ask.findMany({ where: { ...where, status: "open" }, include: { affair: true } }),
      ports.db.preference.findMany({ where, orderBy: { createdAt: "desc" }, take: 30 }),
      ports.db.workspace.findUnique({ where: { id: s.workspaceId } }),
    ]);
    await ports.db.preference.updateMany({ where: { ...where, id: { in: preferences.map(p => p.id) } }, data: { lastUsedAt: ports.now() } });
    return { messages, affairs: affairs.map(({ _count, lastActivityAt, ...a }) => ({ ...a, lastActivityAt: lastActivityAt.toISOString(), openAsks: _count.asks })), asks: asks.map(toAsk), preferences: preferences.map(toPreference), now: ports.now().toISOString(), timezone: notificationSettings(workspace?.settings).timezone };
  }
  async function apply(s: Session, name: string, raw: unknown): Promise<unknown> {
    const c = ctx(s.workspaceId), affairs = createAffairs(c), asks = createAsks(c), preferences = createPreferences(c);
    function effect(kind: string, affairId: string | null, label: string) {
      if (affairId) s.touched.add(affairId);
      s.effects.push({ kind, affairId, label: label.slice(0, 300) });
    }
    switch (name) {
      case "concierge_context": schemas.concierge_context.parse(raw); return context(s);
      case "concierge_create_affair": {
        const a = await affairs.create(schemas.concierge_create_affair.parse(raw), "user");
        effect("create_affair", a.id, `新事务：${a.title}`); return a;
      }
      case "concierge_add_to_affair": {
        const { affairId, ...input } = schemas.concierge_add_to_affair.parse(raw);
        const a = await requireAffair(ports.db, s.workspaceId, affairId);
        const result = await affairs.addEntry(affairId, input, "user");
        effect("add_to_affair", affairId, `已补充到「${a.title}」`); return result;
      }
      case "concierge_resolve_ask": {
        const { askId, ...input } = schemas.concierge_resolve_ask.parse(raw);
        const a = await asks.resolve(askId, input, "user");
        const label = input.decision === "approve" ? "已同意" : input.decision === "deny" ? "已拒绝" : "已回复";
        effect("resolve_ask", a.affairId, `${label}：${a.title}`); return a;
      }
      case "concierge_set_affair_status": {
        const { affairId, status } = schemas.concierge_set_affair_status.parse(raw);
        const a = await affairs.update(affairId, { status });
        effect("set_affair_status", affairId, `${status === "paused" ? "已暂停" : status === "done" ? "已结束" : "已继续"}「${a.title}」`); return a;
      }
      case "concierge_remember": {
        const p = await preferences.add(schemas.concierge_remember.parse(raw), "said");
        effect("remember", null, `记住了：${p.text}`); return p;
      }
      case "concierge_forget": {
        const { preferenceId } = schemas.concierge_forget.parse(raw);
        await preferences.delete(preferenceId); effect("forget", null, "已忘记这条偏好"); return null;
      }
      case "concierge_reply": s.reply = schemas.concierge_reply.parse(raw).text; return { replied: true };
      default: throw new StewardError("invalid", "Unknown concierge tool");
    }
  }
  async function fallback(s: Session, text: string) {
    const refs = [...new Set((text.toUpperCase().match(/[A-Z0-9]+/g) ?? []).filter(r => REF_PATTERN.test(r)))];
    if (refs.length === 1) {
      const where = { workspaceId: s.workspaceId, ref: refs[0] };
      const [ask, affair] = await Promise.all([ports.db.ask.findFirst({ where: { ...where, status: "open" } }), ports.db.affair.findFirst({ where: { ...where, status: { not: "done" } } })]);
      // Ref fallback is deliberately conservative: conflicting verbs never authorize an action.
      const command = text.toUpperCase().replace(refs[0]!, "").replace(/[\s，。！？,:;.!?：；]/g, "");
      const obvious = /^(?:请)?(同意|可以|好|不要|拒绝|暂停|继续|结束)(?:一下|吧)?$/.exec(command);
      const verbs = obvious ? [obvious[1]!] : [];
      const groups = new Set(verbs.map(v => /同意|可以|好/.test(v) ? "yes" : /不要|拒绝/.test(v) ? "no" : v));
      if (groups.size === 1 && Number(Boolean(ask)) + Number(Boolean(affair)) === 1) {
        const verb = [...groups][0];
        if (ask && (verb === "yes" || verb === "no") && (ask.kind === "approval" || ask.kind === "question" && verb === "yes")) {
          await apply(s, "concierge_resolve_ask", { askId: ask.id, decision: ask.kind === "question" ? "answer" : verb === "yes" ? "approve" : "deny", text });
          s.reply = s.effects.at(-1)!.label; return;
        }
        if (affair && ["暂停", "继续", "结束"].includes(verb!)) {
          await apply(s, "concierge_set_affair_status", { affairId: affair.id, status: verb === "暂停" ? "paused" : verb === "结束" ? "done" : "active" });
          s.reply = s.effects.at(-1)!.label; return;
        }
      }
    }
    await apply(s, "concierge_create_affair", { title: text.slice(0, 200), request: text });
    s.reply = "收到，我记下了，会在后台处理。";
  }
  async function handle(input: MessageInput): Promise<ChatReply> {
    chatInputSchema.parse({ text: input.text });
    const log = createChatLog(ctx(input.workspaceId));
    const inbound = await log.append({ direction: "in", channel: input.channel, text: input.text, externalId: input.externalId });
    const previous = await ports.db.audit.findFirst({ where: { workspaceId: input.workspaceId, kind: "concierge_reply", subjectId: inbound.id } });
    if (previous) return chatReplySchema.parse(previous.details);
    const token = randomBytes(32).toString("hex"), key = hash(token);
    const s: Session = { workspaceId: input.workspaceId, deadline: new Date(ports.now().getTime() + RUN_LIMITS.conciergeTimeoutMs), closed: false, calls: 0, webCalls: 0, observed: new Set(), effects: [], touched: new Set(), tail: Promise.resolve() };
    sessions.set(key, s);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (ports.agent) await Promise.race([
        Promise.resolve().then(() => ports.agent!.runConcierge({ runId: randomUUID(), token, deadline: s.deadline })).catch(() => undefined),
        new Promise<void>(resolve => { timer = setTimeout(resolve, RUN_LIMITS.conciergeTimeoutMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      s.closed = true;
      await s.tail;
      sessions.delete(key);
    }
    if (s.reply === undefined) {
      // Preserve already-applied effects, but reserve a slot for the lossless fallback.
      try { await fallback(s, inbound.text); }
      catch (error) {
        // A ref can become stale while the agent runs; keep the original request instead.
        if (!(error instanceof StewardError)) throw error;
        await apply(s, "concierge_create_affair", { title: inbound.text.slice(0, 200), request: inbound.text });
        s.reply = "收到，我记下了，会在后台处理。";
      }
    }
    const affairId = s.touched.size === 1 ? [...s.touched][0]! : null;
    const reply = chatReplySchema.parse({ reply: s.reply, affairId, effects: s.effects });
    await ports.db.$transaction(async tx => {
      await tx.chatMessage.update({ where: { id: inbound.id }, data: { affairId } });
      await tx.chatMessage.create({ data: { workspaceId: input.workspaceId, channel: input.channel, direction: "out", text: reply.reply, affairId, at: ports.now() } });
      await audit(tx, { workspaceId: input.workspaceId, kind: "concierge_reply", actor: "chrona", subjectId: inbound.id, details: reply });
    });
    return reply;
  }
  return {
    owns: (token: string) => sessions.has(hash(token)),
    catalog(token: string) {
      session(token);
      return CONCIERGE_TOOLS.map(name => ({ name, description: descriptions[name], inputSchema: z.toJSONSchema(schemas[name], { io: "input" }), terminal: name === "concierge_reply" }));
    },
    conciergeContext: (token: string) => context(session(token)),
    async conciergeCallTool(token: string, name: string, raw: unknown): Promise<AgentToolReply> {
      try {
        const s = session(token);
        const call = s.tail.then(async () => {
          session(token);
          if (s.calls >= 10) throw new StewardError("conflict", "Concierge tool budget exhausted");
          s.calls++;
          // Ten effects plus a fallback would exceed the reply contract. Reserve the last call for reply/context.
          if (s.effects.length >= 9 && name !== "concierge_reply" && name !== "concierge_context") throw new StewardError("conflict", "Reply required");
          return { ok: true as const, data: await apply(s, name, raw) };
        }).catch(refusal);
        s.tail = call; return await call;
      } catch (error) { return refusal(error); }
    },
    async webPreflight(token: string, raw: unknown) {
      try {
        const s = session(token), input = webPreflightSchema.parse(raw);
        if (!publicWebInput(input.tool, input.input)) return { allow: false, reason: "Public http(s) URLs only" };
        if (s.webCalls >= RUN_LIMITS.conciergeMaxWebCalls) return { allow: false, reason: "budget_exhausted" };
        s.webCalls++; return { allow: true, input: input.input };
      } catch { return { allow: false, reason: "forbidden" }; }
    },
    async webObserved(token: string, raw: unknown): Promise<AgentToolReply> {
      try {
        const s = session(token), input = webObservedSchema.parse(raw);
        if (!input.failed) input.urls.filter(isPublicWebUrl).forEach(url => s.observed.add(url));
        return { ok: true, data: { observed: s.observed.size } };
      } catch (error) { return refusal(error); }
    },
    handleMessage(input: MessageInput) {
      const key = input.externalId ? JSON.stringify([input.workspaceId, input.channel, input.externalId]) : randomUUID();
      const existing = pending.get(key); if (existing) return existing;
      const promise = handle(input).finally(() => pending.delete(key));
      pending.set(key, promise); return promise;
    },
    messages: (workspaceId: string, limit?: number) => createChatLog(ctx(workspaceId)).recent(limit),
  };
}
