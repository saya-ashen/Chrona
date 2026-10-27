import { z } from "zod";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { CHRONA_TOOLS, chronaToolInputSchemas as schemas, RUN_LIMITS, type Action } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { authenticateRun } from "./runs";
import { createSchedules } from "./schedules";
import { createModules } from "./modules";
import { callModuleTool, moduleToolCatalog } from "./module-tools";
import { createPreferences } from "./preferences";
import { createApprovals } from "./approvals";
import { notifyUser } from "./notify-user";
import { drainCalls } from "./module-calls";
import { assessApproval } from "./approval-level";
import { pushReply } from "./chat-replies";
import { runFile } from "./chat";
import { consumeOnce, effectivePolicyIn } from "./grants";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { BUILD_MODULE_TOOLS } from "./module-reference";
import { REFLECT_TOOLS } from "./reflection";

type ToolName = keyof typeof schemas;
type Claim = Awaited<ReturnType<typeof authenticateRun>> & { index: number };
function toolContext(ports: StewardPorts, claim: Claim, tool: ToolName) {
  const { db, now } = ports, { workspaceId } = claim, ctx = { db, workspaceId, now };
  return { ...claim, ...ctx, ports, tool, modules: createModules(ports, workspaceId),
    schedules: createSchedules(ports, workspaceId), preferences: createPreferences(ctx), approvals: createApprovals(ctx) };
}
type ToolContext = ReturnType<typeof toolContext>;
/** Where the decision continues the conversation (see `resume` in approvals). */
const resumeIn = (ctx: ToolContext) => ({ sessionId: ctx.run.sessionId, lane: ctx.run.lane });
async function gate(ctx: ToolContext, action: Action, target: { moduleId?: string }, payload: Prisma.InputJsonObject) {
  const { db, workspaceId, now, tool } = ctx;
  return db.$transaction(async tx => {
    const decision = await effectivePolicyIn(tx, workspaceId, action, target, now());
    if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
    if (decision.mode === "ask") {
      const assessed = await assessApproval(tx, { isolated: !!ctx.ports.sandbox?.isolated, dataDir: ctx.ports.dataDir }, { action, title: tool, payload });
      const approval = await tx.approval.create({ data: { workspaceId, action, title: tool, detail: decision.reason, preview: JSON.stringify(payload).slice(0, 20000), payload: { ...payload, ...resumeIn(ctx) }, ...assessed, createdAt: now() } });
      await audit(tx, { workspaceId, actor: "chrona", kind: "approval_created", subjectId: approval.id, details: { action } });
      return { approvalId: approval.id, status: "awaiting_approval" };
    }
    if (decision.grantId) await consumeOnce(tx, workspaceId, decision.grantId, now());
    return null;
  });
}
/** shortcut: LIKE scans message text with at most 200 hits, upgrade to FTS5 when search volume or history requires indexed ranking. */
export async function searchSessions(db: StewardPorts["db"], workspaceId: string, query: string, limit = 3) {
  const pattern = `%${query.replace(/[\\%_]/g, value => `\\${value}`)}%`;
  const hits = await db.$queryRaw<{ sessionId: string; text: string }[]>`SELECT sessionId, text FROM Message WHERE workspaceId = ${workspaceId} AND text LIKE ${pattern} ESCAPE '\\' ORDER BY at DESC, id DESC LIMIT 200`;
  const ids = [...new Set(hits.map(hit => hit.sessionId))].slice(0, Math.max(1, Math.min(10, limit)));
  const sessions = await db.session.findMany({ where: { workspaceId, id: { in: ids } } });
  return ids.flatMap(id => {
    const session = sessions.find(session => session.id === id);
    return session ? [{ sessionId: id, title: session.title, source: session.source, snippets: hits.filter(hit => hit.sessionId === id).slice(0, 3).map(hit => {
      const index = hit.text.toLowerCase().indexOf(query.toLowerCase()), start = Math.max(0, index - 80);
      return hit.text.slice(start, start + 240);
    }) }] : [];
  });
}
const replyFile = (ctx: ToolContext, path: string) => runFile(ctx.ports, ctx.run.cwd, path);
async function reply(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_reply, raw), { run, db, workspaceId, now, session } = ctx;
  if (!session || !run.sessionId) throw new StewardError("invalid", "Reply requires a session");
  const target = session.originSessionId ?? session.id;
  const conversation = await db.message.findFirst({ where: { workspaceId, sessionId: target }, orderBy: [{ at: "desc" }, { id: "desc" }] });
  const files = await Promise.all(input.files.map(path => replyFile(ctx, path)));
  const attachments = files.map(file => ({ name: file.name, ref: file.ref, mime: "application/octet-stream", size: file.size }));
  const message = await db.$transaction(async tx => {
    const message = await tx.message.create({ data: { workspaceId, direction: "out", channel: conversation?.channel ?? "in_app", sessionId: session.id, text: input.text, attachments, at: now() } });
    await audit(tx, { workspaceId, actor: "chrona", kind: "run_reply", subjectId: run.id, details: { messageId: message.id } });
    // Background results reach their origin conversation at finalization; conversation replies go to its entry now.
    if (!["wake", "module", "build"].includes(session.source)) await pushReply(tx, ctx.ports, message, run.id);
    return message;
  });
  void drainCalls(ctx.ports, workspaceId).catch(() => {});
  return { messageId: message.id };
}
async function notify(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_notify, raw);
  const pending = await gate(ctx, "notify_user", {}, { tool: ctx.tool, ...input });
  if (pending) return pending;
  const queued = await notifyUser(ctx.db, ctx.ports, ctx.workspaceId, { level: input.level, title: input.title, body: input.body, key: `tool:${ctx.run.id}:${ctx.index}` });
  void drainCalls(ctx.ports, ctx.workspaceId).catch(() => {});
  return { status: "queued", callId: queued.callId };
}
async function schedule(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_schedule, raw);
  const pending = await gate(ctx, "schedule", {}, { tool: ctx.tool, ...input });
  return pending ?? ctx.schedules.create(ctx.run.sessionId ?? undefined, input, "chrona");
}
async function schedules(ctx: ToolContext, raw: unknown) {
  parseInput(schemas.chrona_schedules, raw);
  return ctx.schedules.list(ctx.run.sessionId ?? undefined);
}
async function cancelSchedule(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_schedule_cancel, raw);
  if (!await ctx.db.schedule.findFirst({ where: { workspaceId: ctx.workspaceId, id: input.scheduleId } })) throw new StewardError("not_found", "Schedule not found");
  const pending = await gate(ctx, "schedule", {}, { tool: ctx.tool, ...input });
  return pending ?? ctx.schedules.cancel(input.scheduleId);
}
async function requestApproval(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_request_approval, raw);
  const decision = await effectivePolicyIn(ctx.db, ctx.workspaceId, input.action, {}, ctx.now());
  if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
  return ctx.approvals.create({ ...input, payload: { tool: ctx.tool, ...input, ...resumeIn(ctx) } });
}
async function requestPathAccess(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_request_path_access, raw), expanded = input.path.replace(/^~(?=\/|$)/, homedir());
  if (!isAbsolute(expanded)) throw new StewardError("invalid", "Path must be absolute");
  const path = await realpath(expanded).catch(() => { throw new StewardError("not_found", "Path does not exist"); });
  const decision = await effectivePolicyIn(ctx.db, ctx.workspaceId, "access_host_path", {}, ctx.now());
  if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
  return ctx.approvals.create({ action: "access_host_path", title: `访问 ${path}`.slice(0, 200), detail: input.reason, preview: `批准后，后续运行可以读写：\n${path}`, payload: { tool: ctx.tool, kind: "host_path", path, ...resumeIn(ctx) } });
}
const handlers: Record<ToolName, (ctx: ToolContext, raw: unknown) => Promise<unknown>> = {
  chrona_reply: reply, chrona_notify: notify, chrona_schedule: schedule, chrona_schedules: schedules,
  chrona_schedule_cancel: cancelSchedule,
  chrona_session_search: async (ctx, raw) => { const input = parseInput(schemas.chrona_session_search, raw); return searchSessions(ctx.db, ctx.workspaceId, input.query, input.limit); },
  chrona_request_approval: requestApproval, chrona_request_path_access: requestPathAccess,
  chrona_remember: async (ctx, raw) => ctx.preferences.add(parseInput(schemas.chrona_remember, raw), "learned"),
  chrona_forget: async (ctx, raw) => ctx.preferences.delete(parseInput(schemas.chrona_forget, raw).preferenceId),
  chrona_preferences: async (ctx, raw) => { parseInput(schemas.chrona_preferences, raw); return ctx.preferences.list(); },
};
/** No provider-supplied workspace IDs: all ownership comes from the capability. */
/** A build conversation (v2-13) writes and submits one module: it reports back and nothing else (no user data, no other apps). */
const BUILD_TOOLS = ["chrona_reply", ...BUILD_MODULE_TOOLS];
/** A reflection (v2-19) only reads the facts in its prompt and may start builds through reflection.suggest. */
const ONLY: Partial<Record<string, string[]>> = { build: BUILD_TOOLS, reflect: REFLECT_TOOLS };
export function createTools(ports: StewardPorts) {
  const { db, now } = ports;
  /** `timeoutSeconds` (v2-13): how long the caller waits; tools that wait stop by then, and never past the run's deadline. */
  async function call(token: string, name: string, raw: unknown, { timeoutSeconds = 60 }: { timeoutSeconds?: number } = {}) {
    const claim = await db.$transaction(async tx => {
      const auth = await authenticateRun(tx, token, now(), name);
      const calls = Array.isArray(auth.run.toolCalls) ? auth.run.toolCalls as Prisma.InputJsonObject[] : [];
      if (calls.length >= RUN_LIMITS.maxChronaToolCalls) {
        await audit(tx, { workspaceId: auth.workspaceId, actor: "chrona", kind: "tool_limit_rejected", subjectId: auth.run.id, details: { tool: name.slice(0, 200) } });
        return null;
      }
      const index = calls.length;
      calls.push({ tool: name.slice(0, 200), at: now().toISOString(), ok: false });
      await tx.run.update({ where: { id: auth.run.id }, data: { toolCalls: calls } });
      await audit(tx, { workspaceId: auth.workspaceId, actor: "chrona", kind: "tool_started", subjectId: auth.run.id, details: { tool: name.slice(0, 200), index } });
      return { ...auth, index };
    });
    if (!claim) throw new StewardError("forbidden", "Chrona tool call limit reached");
    const { workspaceId, run, index } = claim;
    const deadline = Math.min(now().getTime() + timeoutSeconds * 1000, run.deadlineAt!.getTime());
    let ok = false;
    try {
      const only = claim.session ? ONLY[claim.session.source] : undefined;
      if (only && !only.includes(name)) throw new StewardError("forbidden", `A ${claim.session!.source} conversation may only use ${only.join(", ")}`);
      if (name.startsWith("m_")) {
        const result = await callModuleTool(ports, { workspaceId, sessionId: run.sessionId, runId: run.id, deadline }, name, raw);
        ok = true; return result;
      }
      if (!CHRONA_TOOLS.includes(name as ToolName)) throw new StewardError("invalid", "Unknown Chrona tool");
      const tool = name as ToolName, result = await handlers[tool](toolContext(ports, claim, tool), raw);
      ok = true; return result;
    } finally {
      await db.$transaction(async tx => {
        const row = await tx.run.findUniqueOrThrow({ where: { id: run.id } }), calls = row.toolCalls as Prisma.InputJsonObject[];
        calls[index] = { ...calls[index], ok };
        await tx.run.update({ where: { id: run.id }, data: { toolCalls: calls } });
        await audit(tx, { workspaceId, actor: "chrona", kind: "tool_finished", subjectId: run.id, details: { tool: name.slice(0, 200), index, ok } });
      });
    }
  }
  return { catalog: async (token: string) => {
    const { run, session } = await authenticateRun(db, token, now());
    if (session?.source === "build") return [{ name: "chrona_reply", inputSchema: z.toJSONSchema(schemas.chrona_reply) }, ...(await moduleToolCatalog(ports, run)).filter(tool => BUILD_TOOLS.includes(tool.name))];
    if (session?.source === "reflect") return (await moduleToolCatalog(ports, run)).filter(tool => REFLECT_TOOLS.includes(tool.name));
    // request-group only means something inside a build conversation (v2-15), suggest inside a reflection (v2-19).
    return [...CHRONA_TOOLS.map(name => ({ name, inputSchema: z.toJSONSchema(schemas[name]) })), ...(await moduleToolCatalog(ports, run)).filter(tool => tool.name !== "m_modules_request_group" && !REFLECT_TOOLS.includes(tool.name))];
  }, call };
}
