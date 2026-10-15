import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { transactionAwareClient } from "@chrona/db/transaction-context";
import { WORK_ALLOWED_ACTIONS, WORK_LIMITS, WORK_TERMINAL_TOOLS, workSchema, workToolInputSchemas, workWebPreflightSchema, workWebObservedSchema, notificationPolicySchema, stewardChatIdentitySchema, CHAT_CHANNEL_BY_PLATFORM, type StewardChatIdentity as ChatIdentity, type WorkTool, type Work } from "@chrona/contracts/steward";
import type { PrismaClient, Prisma, StewardWork, StewardWorkAttempt, Delegation } from "@chrona/db/generated/prisma/client";
import { ensureRef } from "./refs";
import { json, StewardError } from "./mappers";
import { workToolHandlers, WorkToolError } from "./work-tools";
import { WorkResultError } from "../results/access";
type Tx = Prisma.TransactionClient;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const entries = (v: Prisma.JsonValue) => Array.isArray(v) ? v : [];
const fail = (code: string, message = code) => ({ ok: false as const, error: { code, message } });
const terminal: Record<string, string> = { chrona_publish_result: "result_published", chrona_ask_user: "asked_user", chrona_request_authorization: "requested_authorization", chrona_close_quietly: "closed_quietly" };
const active = (d: Delegation, at: Date) => d.status === "active" && (!d.expiresAt || d.expiresAt > at);
/** Literal URL guard. Host web adapter must also enforce resolved-address/redirect safety. */
function publicUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const u = new URL(raw), h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h) return false;
    if (isIP(h) === 4) { const [a, b] = h.split(".").map(Number); return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168 || a === 100 && b! >= 64 && b! <= 127 || a! >= 224); }
    // Reject mapped/translation addresses as well as local ranges, avoiding IPv4 policy bypass.
    if (isIP(h) === 6) return !(/^(::|f[cd]|fe[89ab]|ff|64:ff9b:|2002:)/i.test(h) || h === "0:0:0:0:0:0:0:1");
    return h.includes(".");
  } catch { return false; }
}
export function createStewardWork({ db, now = () => new Date(), allowedRecipients, workspaceId: scope }: { db: PrismaClient; now?: () => Date; allowedRecipients: ReadonlySet<string>; workspaceId?: string }) {
  const transaction = <T>(fn: (tx: Tx) => Promise<T>) => transactionAwareClient(db).$transaction(fn);
  async function finish(tx: Tx, attempt: StewardWorkAttempt, status: string, note = "") {
    const work = await tx.stewardWork.findFirstOrThrow({ where: { id: attempt.workId, workspaceId: attempt.workspaceId }, include: { delegation: true } }), at = now();
    if (attempt.status !== "running") {
      if (!attempt.endedAt) await tx.stewardWorkAttempt.update({ where: { id: attempt.id }, data: { endedAt: at } });
      return;
    }
    await tx.stewardWorkAttempt.update({ where: { id: attempt.id }, data: { status, endedAt: at, error: ["no_outcome", "timed_out", "lease_expired", "budget_exhausted"].includes(status) ? `${status}${note ? `: ${note.replace(/\p{Cc}/gu, " ").slice(-300)}` : ""}`.slice(0, 500) : null } });
    const newer = work.revision > attempt.workRevision, revoked = ["revoked", "expired"].includes(work.delegation.status) || !!work.delegation.expiresAt && work.delegation.expiresAt <= at;
    if (revoked || status === "cancelled" || newer) {
      await tx.stewardWork.update({ where: { id: work.id }, data: { status: revoked ? "cancelled" : "received", leaseUntil: null, nextRunAt: revoked ? null : at, ...(newer ? { wakeReason: "user_input" } : {}) } }); return;
    }
    const counted = ["no_outcome", "timed_out", "budget_exhausted"].includes(status) /* lease_expired = Chrona itself stopped; not the agent's failure */, failures = work.failures + (counted ? 1 : 0), failed = failures >= WORK_LIMITS.maxFailures;
    await tx.stewardWork.update({ where: { id: work.id }, data: { status: failed ? "failed" : "received", failures, leaseUntil: null, wakeReason: "retry", nextRunAt: failed ? null : new Date(at.getTime() + (status === "agent_unavailable" ? 5 : [1, 5, 15][Math.max(0, failures - 1)] ?? 15) * 60_000), lastError: status } });
    if (failed) {
      const key = `work:${work.id}:failed`, policy = notificationPolicySchema.parse(work.delegation.notification);
      const item = await tx.attentionItem.upsert({ where: { workspaceId_dedupeKey: { workspaceId: work.workspaceId, dedupeKey: key } }, update: {}, create: { workspaceId: work.workspaceId, affairId: work.affairId, delegationId: work.delegationId, kind: "failure", dedupeKey: key, title: "工作暂时无法完成", whatHappened: "连续尝试未能完成工作。", whyItMatters: "需要你决定下一步。", nextStep: "请补充说明或暂停此工作。", createdAt: at } });
      await ensureRef(tx, "attentionItem", item.id);
      await tx.stewardNotification.upsert({ where: { idempotencyKey: key }, update: {}, create: { workspaceId: work.workspaceId, delegationId: work.delegationId, attentionItemId: item.id, idempotencyKey: key, channel: policy.channel, recipient: policy.recipient, status: "queued", title: item.title, body: item.whatHappened, link: `/affairs/${work.affairId}`, generatedAt: at, nextAttemptAt: at } });
    }
  }
  async function lookup(tx: Tx, token: string) {
    // First write obtains SQLite's writer lock before token/state/budget checks.
    const tokenHash = hash(token);
    await tx.stewardWorkAttempt.updateMany({ where: { tokenHash, ...(scope ? { workspaceId: scope } : {}) }, data: { tokenHash } });
    return tx.stewardWorkAttempt.findFirst({ where: { tokenHash, ...(scope ? { workspaceId: scope } : {}) }, include: { work: { include: { delegation: true } } } });
  }
  type Attempt = NonNullable<Awaited<ReturnType<typeof lookup>>>;
  function refusal(a: Attempt | null) {
    if (!a || a.workspaceId !== a.work.workspaceId || a.work.delegation.workspaceId !== a.workspaceId) return fail("UNAUTHORIZED");
    if (Object.values(terminal).includes(a.status)) return fail("STOPPED");
    if (a.status !== "running" || now() >= a.deadlineAt) return fail("UNAUTHORIZED");
    if (!active(a.work.delegation, now()) || a.work.status === "cancelled") return fail("STOPPED");
    return null;
  }
  async function log(tx: Tx, a: Attempt, tool: string, ok: boolean, note: string) {
    await tx.stewardWorkAttempt.update({ where: { id: a.id }, data: { toolCalls: json([...entries(a.toolCalls), { tool: tool.slice(0, 200) || "unknown", at: now().toISOString(), ok, note: note.slice(0, 300) }].slice(-60)) } });
  }
  async function view(row: StewardWork): Promise<Work> {
    const delegation = await db.delegation.findFirst({ where: { id: row.delegationId, workspaceId: row.workspaceId } });
    const attempts = await db.stewardWorkAttempt.findMany({ where: { workId: row.id, workspaceId: row.workspaceId }, orderBy: { number: "desc" }, take: 10 });
    const version = row.resultVersionId ? await db.taskResultVersion.findFirst({ where: { id: row.resultVersionId, result: { workspaceId: row.workspaceId } } }) : null;
    return workSchema.parse({ id: row.id, affairId: row.affairId, delegationId: row.delegationId, replyRef: delegation?.replyRef ?? null, request: row.request, status: row.status, revision: row.revision, question: row.question, authorization: row.authorization, inputs: row.inputs, progress: row.progress, handling: row.handling, resultHref: row.resultTaskId ? `/tasks/${row.resultTaskId}/results` : null, resultVersion: version?.version ?? null, attempts: attempts.map(a => ({ id: a.id, number: a.number, status: a.status, wakeReason: a.wakeReason, toolCalls: a.toolCalls, error: a.error, startedAt: a.startedAt.toISOString(), endedAt: a.endedAt?.toISOString() ?? null })), failures: row.failures, nextRunAt: row.nextRunAt?.toISOString() ?? null, lastError: row.lastError, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
  }
  return {
    view,
    async create({ workspaceId, text, chat }: { workspaceId: string; text: string; chat?: { identity: ChatIdentity; recipient: string } }) {
      if (scope && scope !== workspaceId) throw new StewardError("FORBIDDEN", "Workspace access required");
      text = text.trim(); if (!text || text.length > 4000) throw new StewardError("INVALID_TRANSITION", "Request must contain 1–4000 characters");
      if (chat) { const c = stewardChatIdentitySchema.parse(chat.identity); if (c.userId !== c.chatId || chat.recipient !== `${c.platform}:${c.chatId}` || !allowedRecipients.has(chat.recipient)) throw new StewardError("FORBIDDEN", "Chat identity is not authorized"); }
      return transaction(async tx => {
        const at = now(), affair = await tx.affair.create({ data: { workspaceId, title: text.split(/\r?\n/)[0]!.slice(0, 60), createdAt: at } });
        const delegation = await tx.delegation.create({ data: { workspaceId, affairId: affair.id, purpose: `处理请求：${text}`.slice(0, 4000), originalWording: text, status: "active", grantedAt: at, revision: 1, allowedActions: [...WORK_ALLOWED_ACTIONS], askFirstActions: [], notification: { mode: "immediate", cooldownMinutes: 0, quietHours: null, channel: chat ? CHAT_CHANNEL_BY_PLATFORM[chat.identity.platform] : "in_app", recipient: chat?.recipient ?? null }, limits: { maxEventsPerCheck: 1, maxNotificationsPerDay: 12 }, expiresAt: new Date(at.getTime() + 30 * 86400_000), createdAt: at } });
        const ref = await ensureRef(tx, "delegation", delegation.id), work = await tx.stewardWork.create({ data: { workspaceId, affairId: affair.id, delegationId: delegation.id, request: text, nextRunAt: at, createdAt: at } });
        await tx.stewardAudit.create({ data: { workspaceId, actorKey: "steward-work", subjectId: work.id, kind: "work.created", details: { textSha256: hash(text) }, createdAt: at } });
        return { status: "received" as const, ref, workId: work.id, affairId: affair.id, delegationId: delegation.id };
      });
    },
    /** Owner input is data, never an authorization grant. */
    async respondOwner(workspaceId: string, id: string, input: { kind: "answer" | "feedback"; text: string } | { kind: "accept" }, actorKey: string) {
      if (scope && scope !== workspaceId) throw new StewardError("FORBIDDEN", "Workspace access required");
      if (input.kind !== "accept" && (!input.text.trim() || input.text.trim().length > 1000)) throw new StewardError("INVALID_TRANSITION", "Input must contain 1–1000 characters");
      const row = await transaction(async tx => {
        await tx.stewardWork.updateMany({ where: { id, workspaceId }, data: { id } });
        const work = await tx.stewardWork.findFirst({ where: { id, workspaceId }, include: { delegation: true } });
        if (!work) throw new StewardError("NOT_FOUND", "Work not found");
        const at = now();
        if (work.delegation.workspaceId !== workspaceId || !active(work.delegation, at) || work.status === "cancelled" || (input.kind === "accept" && work.status !== "result_ready")) throw new StewardError("INVALID_TRANSITION", "Work cannot receive this input");
        if (["accepted", "result_ready", "waiting_input", "waiting_authorization"].includes(work.status) && input.kind !== "accept") await tx.stewardAudit.create({ data: { workspaceId, subjectId: id, actorKey, kind: "work.resting", details: { status: work.status }, createdAt: at } });
        const updated = await tx.stewardWork.update({ where: { id, workspaceId }, data: input.kind === "accept" ? { status: "accepted", nextRunAt: null, revision: { increment: 1 } } : { inputs: json([...entries(work.inputs), { at: at.toISOString(), kind: input.kind, text: input.text.trim() }].slice(-WORK_LIMITS.maxInputs)), revision: { increment: 1 }, status: "received", nextRunAt: at, wakeReason: "user_input" } });
        await tx.attentionItem.updateMany({ where: { workspaceId, delegationId: work.delegationId, status: { in: ["open", "snoozed"] }, dedupeKey: { startsWith: `work:${id}:${input.kind === "accept" ? "result" : "ask"}:` } }, data: { status: "resolved", decidedAt: at, ...(input.kind === "accept" ? { decision: "done" } : {}) } });
        await tx.stewardAudit.create({ data: { workspaceId, subjectId: id, actorKey, kind: "work.owner_input", details: { kind: input.kind, before: work.status, after: updated.status }, createdAt: at } });
        return updated;
      });
      return view(row);
    },
    async claimDue({ limit = 1 }: { limit?: number } = {}) {
      const result: { attemptId: string; workId: string; workspaceId: string; token: string; deadlineAt: Date; wakeReason: string }[] = [];
      const rows = await db.stewardWork.findMany({ where: { ...(scope ? { workspaceId: scope } : {}), status: "received", nextRunAt: { lte: now() }, delegation: { status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }] } }, orderBy: [{ nextRunAt: "asc" }, { id: "asc" }] });
      for (const row of rows) {
        if (result.length >= Math.max(0, Math.min(100, limit))) break;
        const claimed = await transaction(async tx => {
          const at = now(), deadlineAt = new Date(at.getTime() + WORK_LIMITS.attemptTimeoutMs);
          const changed = await tx.stewardWork.updateMany({ where: { id: row.id, revision: row.revision, status: "received", attempts: { none: { status: "running" } }, delegation: { status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] } }, data: { status: "running", leaseUntil: new Date(deadlineAt.getTime() + 60_000) } });
          if (!changed.count) return null;
          if (await tx.stewardWorkAttempt.count({ where: { workId: row.id, startedAt: { gte: new Date(at.getTime() - 86400_000) } } }) >= WORK_LIMITS.maxRunsPerDay) { await tx.stewardWork.update({ where: { id: row.id }, data: { status: "received", leaseUntil: null } }); return null; }
          const previous = await tx.stewardWorkAttempt.findFirst({ where: { workId: row.id }, orderBy: { number: "desc" } }), token = randomBytes(32).toString("base64url");
          const attempt = await tx.stewardWorkAttempt.create({ data: { workspaceId: row.workspaceId, workId: row.id, number: (previous?.number ?? 0) + 1, tokenHash: hash(token), deadlineAt, startedAt: at, wakeReason: row.wakeReason, workRevision: row.revision } });
          return { attemptId: attempt.id, workId: row.id, workspaceId: row.workspaceId, token, deadlineAt, wakeReason: row.wakeReason };
        }); if (claimed) result.push(claimed);
      } return result;
    },
    async shouldStop(attemptId: string) { const a = await db.stewardWorkAttempt.findFirst({ where: { id: attemptId, ...(scope ? { workspaceId: scope } : {}) }, include: { work: { include: { delegation: true } } } }); return !!refusal(a); },
    async finishAttempt(attemptId: string, { outcome, note = "" }: { outcome: "exited" | "timeout" | "unavailable" | "killed"; note?: string }) {
      return transaction(async tx => {
        await tx.stewardWorkAttempt.updateMany({ where: { id: attemptId, ...(scope ? { workspaceId: scope } : {}) }, data: { id: attemptId } });
        const a = await tx.stewardWorkAttempt.findFirst({ where: { id: attemptId, ...(scope ? { workspaceId: scope } : {}) }, include: { work: { include: { delegation: true } } } });
        if (a) await finish(tx, a, !active(a.work.delegation, now()) ? "cancelled" : outcome === "unavailable" ? "agent_unavailable" : outcome === "timeout" ? "timed_out" : "no_outcome", note);
      });
    },
    async recover() {
      return transaction(async tx => {
        await tx.stewardWorkAttempt.updateMany({ where: { status: "running", ...(scope ? { workspaceId: scope } : {}), deadlineAt: { lt: new Date(now().getTime() - 60_000) } }, data: { status: "running" } });
        const rows = await tx.stewardWorkAttempt.findMany({ where: { status: "running", ...(scope ? { workspaceId: scope } : {}), deadlineAt: { lt: new Date(now().getTime() - 60_000) } } });
        for (const a of rows) await finish(tx, a, "lease_expired"); return { recovered: rows.length };
      });
    },
    async wakeDueFollowUps() {
      return transaction(async tx => {
        const at = now();
        await tx.followUp.updateMany({ where: { id: { startsWith: "work:" }, status: "pending", dueAt: { lte: at }, ...(scope ? { workspaceId: scope } : {}) }, data: { status: "pending" } });
        const rows = await tx.followUp.findMany({ where: { id: { startsWith: "work:" }, status: "pending", dueAt: { lte: at }, ...(scope ? { workspaceId: scope } : {}) } });
        let woken = 0;
        for (const f of rows) {
          const work = await tx.stewardWork.findFirst({ where: { id: f.id.split(":")[1], workspaceId: f.workspaceId } });
          if (work && ["result_ready", "accepted", "waiting_input", "waiting_authorization"].includes(work.status)) {
            await tx.stewardAudit.create({ data: { workspaceId: work.workspaceId, subjectId: work.id, actorKey: "steward-work", kind: "work.resting", details: { status: work.status }, createdAt: at } });
            await tx.stewardWork.update({ where: { id: work.id }, data: { status: "received", nextRunAt: at, wakeReason: "follow_up_due" } }); woken++;
          }
          await tx.followUp.update({ where: { id: f.id }, data: { status: "done" } });
        } return { woken };
      });
    },
    async callTool(token: string, name: string, raw: unknown): Promise<{ ok: true; data: unknown } | ReturnType<typeof fail>> {
      return transaction(async tx => {
        const a = await lookup(tx, token), denied = refusal(a);
        if (denied) { if (a) await log(tx, a, name, false, denied.error.code); return denied; }
        const attempt = a!;
        if (entries(attempt.toolCalls).length >= WORK_LIMITS.maxToolCalls) { await log(tx, attempt, name, false, "BUDGET_EXHAUSTED"); await finish(tx, attempt, "budget_exhausted"); return fail("BUDGET_EXHAUSTED"); }
        if (!Object.hasOwn(workToolInputSchemas, name)) { await log(tx, attempt, name, false, "UNKNOWN_TOOL"); return fail("UNKNOWN_TOOL"); }
        const tool = name as WorkTool, input = workToolInputSchemas[tool].safeParse(raw);
        if (!input.success) { await log(tx, attempt, name, false, "VALIDATION_ERROR"); return fail("VALIDATION_ERROR", input.error.issues.slice(0, 5).map(i => `${i.path.join(".")}: ${i.code}`.slice(0, 100)).join("; ")); }
        const handler = workToolHandlers[tool];
        if (!handler) { await log(tx, attempt, name, false, "NOT_IMPLEMENTED"); return fail("NOT_IMPLEMENTED"); }
        let data: unknown;
        try { data = await handler({ tx, work: attempt.work, attempt, delegation: attempt.work.delegation, now: now(), workspaceId: attempt.workspaceId }, input.data); }
        catch (error) { if (!(error instanceof WorkToolError)) throw error; await log(tx, attempt, name, false, error.code); return fail(error.code, error.message); }
        await log(tx, attempt, name, true, "completed");
        await tx.stewardAudit.create({ data: { workspaceId: attempt.workspaceId, actorKey: "steward-agent", subjectId: attempt.workId, kind: `work.tool.${tool}`, details: { attemptId: attempt.id }, createdAt: now() } });
        if ((WORK_TERMINAL_TOOLS as readonly string[]).includes(tool)) {
          await tx.stewardWorkAttempt.update({ where: { id: attempt.id }, data: { status: terminal[tool] } });
          await tx.stewardWork.update({ where: { id: attempt.workId }, data: { leaseUntil: null, failures: 0, lastError: null, ...(attempt.work.revision > attempt.workRevision ? { status: "received", nextRunAt: now(), wakeReason: "user_input" } : {}) } });
        }
        return { ok: true as const, data };
      }).catch(async error => {
        // Results-layer refusals must roll back the entire tool effect before logging.
        if (!(error instanceof WorkResultError)) throw error;
        return transaction(async tx => { const a = await lookup(tx, token); if (a) await log(tx, a, name, false, error.code); return fail(error.code, error.message); });
      });
    },
    async webPreflight(token: string, raw: unknown) {
      return transaction(async tx => {
        const a = await lookup(tx, token), denied = refusal(a); if (denied) return { allow: false as const, reason: denied.error.code };
        const deny = async (reason: string) => { await log(tx, a!, typeof (raw as { tool?: unknown })?.tool === "string" ? String((raw as { tool: string }).tool) : "web", false, reason); return { allow: false as const, reason }; };
        const parsed = workWebPreflightSchema.safeParse(raw); if (!parsed.success) return deny("VALIDATION_ERROR");
        if (a!.webCalls >= WORK_LIMITS.maxWebCalls) return deny("BUDGET_EXHAUSTED");
        const { tool, input } = parsed.data;
        if (input.auth) return deny("AUTH_NOT_ALLOWED");
        let sanitized: Record<string, unknown>;
        if (tool === "fetch_content") {
          if (Object.keys(input).some(k => !["url", "urls", "auth", "mode", "prompt"].includes(k)) || (input.urls !== undefined && !Array.isArray(input.urls)) || (input.mode !== undefined && !["readable", "raw", "answer"].includes(input.mode as string)) || (input.prompt !== undefined && typeof input.prompt !== "string")) return deny("URL_REQUIRED");
          const urls = [...(input.url === undefined ? [] : [input.url]), ...(Array.isArray(input.urls) ? input.urls : [])];
          if (!urls.length || urls.length > 50 || !urls.every(publicUrl)) return deny("PUBLIC_HTTP_URL_REQUIRED");
          sanitized = { ...(input.url !== undefined ? { url: input.url } : {}), ...(input.urls !== undefined ? { urls: input.urls } : {}), ...(input.mode !== undefined ? { mode: input.mode } : {}), ...(typeof input.prompt === "string" ? { prompt: input.prompt.slice(0, 2000) } : {}) };
        } else {
          const queries = Array.isArray(input.queries) ? input.queries.filter((q): q is string => typeof q === "string" && q.trim() !== "").slice(0, 4).map(q => q.slice(0, 500)) : [];
          if (!queries.length && (typeof input.query !== "string" || !input.query.trim())) return deny("QUERY_REQUIRED");
          sanitized = { ...(queries.length ? { queries } : { query: (input.query as string).slice(0, 500) }), workflow: "none", includeContent: false, numResults: typeof input.numResults === "number" && Number.isFinite(input.numResults) ? Math.max(1, Math.min(8, Math.floor(input.numResults))) : 8 };
        }
        await tx.stewardWorkAttempt.update({ where: { id: a!.id }, data: { webCalls: { increment: 1 } } });
        await log(tx, a!, tool, true, tool === "web_search" ? `search: ${JSON.stringify(sanitized.queries ?? sanitized.query)}` : `fetch: ${JSON.stringify(sanitized.urls ?? sanitized.url)}`);
        return { allow: true as const, input: sanitized };
      });
    },
    async webObserved(token: string, raw: unknown) {
      return transaction(async tx => {
        const a = await lookup(tx, token), denied = refusal(a); if (denied) return denied;
        const parsed = workWebObservedSchema.safeParse(raw); if (!parsed.success) return fail("VALIDATION_ERROR");
        if (!parsed.data.failed) {
          const sources = entries(a!.observedSources), seen = new Set(sources.map(s => (s as { url?: string })?.url));
          for (const [i, url] of parsed.data.urls.entries()) if (!seen.has(url) && sources.length < 200) { sources.push({ url, title: parsed.data.titles[i] ?? "", tool: parsed.data.tool, at: now().toISOString() }); seen.add(url); }
          await tx.stewardWorkAttempt.update({ where: { id: a!.id }, data: { observedSources: json(sources) } });
        } return { ok: true as const, data: { recorded: true } };
      });
    },
  };
}
