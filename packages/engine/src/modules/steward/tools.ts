import { z } from "zod";
import { compileUiSpec, checkUiSpec, uiGuide } from "@chrona/ui-catalog";
import { contentArea } from "./content";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { CHRONA_TOOLS, chronaToolInputSchemas as schemas, RUN_LIMITS, type Action } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { authenticateRun } from "./runs";
import { createSchedules } from "./schedules";
import { createModules } from "./modules";
import { callModuleTool, moduleToolCatalog } from "./module-tools";
import { proposeFromBuild, requestBuild } from "./module-build-lane";
import { createPreferences } from "./preferences";
import { createApprovals } from "./approvals";
import { createNotifications } from "./notify";
import { consumeOnce, effectivePolicyIn } from "./grants";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";

type ToolName = keyof typeof schemas;
type Claim = Awaited<ReturnType<typeof authenticateRun>> & { index: number };
function toolContext(ports: StewardPorts, claim: Claim, tool: ToolName) {
  const { db, now } = ports, { workspaceId } = claim, ctx = { db, workspaceId, now };
  return { ...claim, ...ctx, ports, tool, modules: createModules(ports, workspaceId),
    schedules: createSchedules(ports, workspaceId), preferences: createPreferences(ctx), approvals: createApprovals(ctx) };
}
type ToolContext = ReturnType<typeof toolContext>;
async function gate(ctx: ToolContext, action: Action, target: { connectorId?: string }, payload: Prisma.InputJsonValue) {
  const { db, workspaceId, now, tool } = ctx;
  return db.$transaction(async tx => {
    const decision = await effectivePolicyIn(tx, workspaceId, action, target, now());
    if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
    if (decision.mode === "ask") {
      const approval = await tx.approval.create({ data: { workspaceId, action, title: tool, detail: decision.reason, preview: JSON.stringify(payload).slice(0, 20000), payload, createdAt: now() } });
      await audit(tx, { workspaceId, actor: "chrona", kind: "approval_created", subjectId: approval.id, details: { action } });
      return { approvalId: approval.id, status: "awaiting_approval" };
    }
    if (decision.grantId) await consumeOnce(tx, workspaceId, decision.grantId, now());
    return null;
  });
}
/** Content task supplies mounts using this persisted selection; focus changes apply next run. */
export async function sessionContentFocus(db: StewardPorts["db"], workspaceId: string, sessionId: string) {
  const session = await db.session.findFirst({ where: { id: sessionId, workspaceId } });
  if (!session) throw new StewardError("not_found", "Session not found");
  return z.array(z.string()).parse(session.focus);
}
async function focus(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_focus, raw);
  if (!ctx.run.sessionId) throw new StewardError("invalid", "Focus requires a session");
  const names = [...new Set(input.modules)];
  const modules = await ctx.db.module.findMany({ where: { workspaceId: ctx.workspaceId, name: { in: names }, status: "active" } });
  if (names.some(name => ["web", "qq", "mcp"].includes(name) || !modules.some(module => module.name === name))) throw new StewardError("invalid", "Focus requires active non-entry module names");
  await ctx.db.session.update({ where: { id: ctx.run.sessionId }, data: { focus: names } });
  return { modules: names };
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
/** Resolve only content references, never host paths; mounts/edits are owned by the content layer. */
async function contentFile(ctx: ToolContext, ref: string) {
  const [name, ...parts] = ref.split("/");
  const module = await ctx.db.module.findFirst({ where: { workspaceId: ctx.workspaceId, name, status: "active" } });
  if (!module) throw new StewardError("not_found", "Content module not found");
  const root = await realpath(join(ctx.ports.dataDir, "platform", "content", module.id));
  const path = await realpath(join(root, ...parts));
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new StewardError("forbidden", "Content path escapes its module");
  const info = await stat(path);
  if (!info.isFile()) throw new StewardError("invalid", "Content reference is not a file");
  return { name: parts.at(-1)!, path, size: info.size };
}
async function reply(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_reply, raw), { run, db, workspaceId, ports, now, session } = ctx;
  if (!session || !run.sessionId) throw new StewardError("invalid", "Reply requires a session");
  const target = session.originSessionId ?? session.id;
  const conversation = await db.message.findFirst({ where: { workspaceId, sessionId: target }, orderBy: [{ at: "desc" }, { id: "desc" }] });
  const files = await Promise.all(input.files.map(ref => contentFile(ctx, ref)));
  const attachments = files.map((file, index) => ({ name: file.name, ref: input.files[index], mime: "application/octet-stream", size: file.size }));
  const message = await db.$transaction(async tx => {
    const message = await tx.message.create({ data: { workspaceId, direction: "out", channel: conversation?.channel ?? "in_app", sessionId: session.id, text: input.text, attachments, at: now() } });
    await audit(tx, { workspaceId, actor: "chrona", kind: "run_reply", subjectId: run.id, details: { messageId: message.id } });
    return message;
  });
  // Background results are posted and budget-notified exactly once at finalization.
  if (session.source === "wake" || session.source === "module") return { messageId: message.id };
  const adapter = ports.deliveries.find(d => d.channel === conversation?.channel);
  const delivery = adapter ? await adapter.send({ idempotencyKey: `reply:${message.id}`, title: "", body: input.text, link: null, recipient: null, files: files.map(({ name, path }) => ({ name, path })) }) : { outcome: "rejected", retryable: true, error: "Delivery unavailable" };
  return { messageId: message.id, delivery };
}
async function notify(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_notify, raw);
  const pending = await gate(ctx, "notify_user", {}, { tool: ctx.tool, ...input });
  if (pending) return pending;
  if (input.file) await contentFile(ctx, input.file);
  return createNotifications(ctx.ports, ctx.workspaceId).enqueue({ level: input.level, title: input.title, body: input.body, dedupeKey: `tool:${ctx.run.id}:${ctx.index}` });
}
async function schedule(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_schedule, raw);
  const pending = await gate(ctx, "schedule", {}, { tool: ctx.tool, ...input });
  return pending ?? ctx.schedules.create(ctx.run.sessionId ?? undefined, input, "chrona");
}
async function proposeModule(ctx: ToolContext, raw: unknown) {
  const { request, dir, ...input } = parseInput(schemas.chrona_propose, raw);
  if (ctx.run.lane === "build") {
    if (!dir) throw new StewardError("conflict", "Build runs submit module directories, not requests");
    return proposeFromBuild(ctx.ports, ctx.workspaceId, ctx.run, { dir, intent: input.intent });
  }
  if (request) return requestBuild(ctx.ports, ctx.workspaceId, ctx.run, { request, intent: input.intent });
  return ctx.modules.propose({ ...input, dir: dir!, root: ctx.run.cwd }, "provider");
}
async function listModules(ctx: ToolContext, raw: unknown) {
  parseInput(schemas.chrona_modules, raw);
  return ctx.modules.list();
}
async function requireRunModule(ctx: ToolContext, moduleId: string) {
  const row = await ctx.db.module.findFirst({ where: { id: moduleId, workspaceId: ctx.workspaceId } });
  if (!row) throw new StewardError("not_found", "Module not found");
  return row;
}
async function checkoutModule(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_module_checkout, raw), module = await requireRunModule(ctx, input.moduleId);
  await ctx.modules.checkout(module.id, input.hash, input.dir, ctx.run.cwd);
  return { moduleId: module.id, hash: input.hash ?? module.activeHash, dir: input.dir };
}
async function rollbackModule(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_module_rollback, raw);
  await requireRunModule(ctx, input.moduleId);
  return ctx.modules.rollback(input.moduleId, input.hash);
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
  return ctx.approvals.create({ ...input, payload: { tool: ctx.tool, ...input } });
}
async function requestPathAccess(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_request_path_access, raw), expanded = input.path.replace(/^~(?=\/|$)/, homedir());
  if (!isAbsolute(expanded)) throw new StewardError("invalid", "Path must be absolute");
  const path = await realpath(expanded).catch(() => { throw new StewardError("not_found", "Path does not exist"); });
  const decision = await effectivePolicyIn(ctx.db, ctx.workspaceId, "access_host_path", {}, ctx.now());
  if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
  return ctx.approvals.create({ action: "access_host_path", title: `访问 ${path}`.slice(0, 200), detail: input.reason, preview: `批准后，后续运行可以读写：\n${path}`, payload: { tool: ctx.tool, kind: "host_path", path, sessionId: ctx.run.sessionId } });
}
async function sendEmail(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_send_email, raw);
  const connector = await ctx.db.connector.findFirst({ where: { workspaceId: ctx.workspaceId, id: input.connectorId } });
  if (!connector || connector.kind !== "email" || !connector.canSend || connector.status !== "active") throw new StewardError("forbidden", "Email connector cannot send");
  const decision = await effectivePolicyIn(ctx.db, ctx.workspaceId, "send_external_message", { connectorId: input.connectorId }, ctx.now());
  if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
  return ctx.approvals.create({ action: "send_external_message", title: input.subject, detail: `Email to ${input.to.join(", ")}`, preview: input.body.slice(0, 20000), payload: { tool: ctx.tool, ...input } });
}
async function inbound(ctx: ToolContext, raw: unknown) {
  const { limit, ...where } = parseInput(schemas.chrona_inbound, raw);
  const connectors = where.connectorId ? [{ id: where.connectorId }] : await ctx.db.connector.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true } });
  for (const connector of connectors) {
    const pending = await gate(ctx, "read_source", { connectorId: connector.id }, { tool: ctx.tool, ...where, limit });
    if (pending) return pending;
  }
  return ctx.db.inboundItem.findMany({ where: { workspaceId: ctx.workspaceId, ...where }, take: limit, orderBy: { receivedAt: "desc" }, select: { id: true, connectorId: true, from: true, subject: true, receivedAt: true, path: true, status: true, ruleNote: true } });
}
const handlers: Record<ToolName, (ctx: ToolContext, raw: unknown) => Promise<unknown>> = {
  chrona_ui_guide: async (ctx, raw) => {
    parseInput(schemas.chrona_ui_guide, raw);
    const preferences = await ctx.db.preference.findMany({ where: { workspaceId: ctx.workspaceId, topic: "ui" } });
    const rows = await ctx.db.audit.findMany({ where: { workspaceId: ctx.workspaceId, kind: "ui_event", createdAt: { gte: new Date(ctx.now().getTime() - 14 * 86400000) } } });
    const counts = new Map<string, number>();
    for (const row of rows) {
      const input = row.details as { kind?: string; path?: string; name?: string } | null;
      if (!input || !["open", "action"].includes(input.kind ?? "")) continue;
      const key = input.kind === "open" ? `Page opened: ${input.path}` : `Action used: ${input.name ?? "unnamed"}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { guide: uiGuide(preferences.map(row => row.text), [...counts].slice(0, 10).map(([key, count]) => `${key}: ${count}`)) };
  },
  chrona_ui_set: async (ctx, raw) => {
    const input = parseInput(schemas.chrona_ui_set, raw);
    if (!ctx.session || !Array.isArray(ctx.session.focus) || !ctx.session.focus.includes(input.module) || ["web", "qq", "mcp"].includes(input.module)) throw new StewardError("forbidden", "Module must be focused");
    const module = await ctx.db.module.findUnique({ where: { workspaceId_name: { workspaceId: ctx.workspaceId, name: input.module } } });
    if (!module) throw new StewardError("not_found", "Module not found");
    const spec = compileUiSpec(input.spec), check = checkUiSpec(spec);
    if (!check.ok) throw new StewardError("invalid", check.issues.join("; "));
    const files = await contentArea(ctx.ports, ctx.workspaceId, module.id);
    await files.intake([{ path: input.path, bytes: Buffer.from(JSON.stringify(spec)) }, ...(input.role === "entry" ? [{ path: ".chrona/entry", bytes: Buffer.from(input.path + "\n") }] : [])]);
    return { path: input.path };
  },
  chrona_propose: proposeModule, chrona_modules: listModules, chrona_module_checkout: checkoutModule, chrona_module_rollback: rollbackModule,
  chrona_reply: reply, chrona_notify: notify, chrona_schedule: schedule, chrona_schedules: schedules,
  chrona_schedule_cancel: cancelSchedule, chrona_focus: focus,
  chrona_session_search: async (ctx, raw) => { const input = parseInput(schemas.chrona_session_search, raw); return searchSessions(ctx.db, ctx.workspaceId, input.query, input.limit); },
  chrona_request_approval: requestApproval, chrona_request_path_access: requestPathAccess, chrona_send_email: sendEmail, chrona_inbound: inbound,
  chrona_remember: async (ctx, raw) => ctx.preferences.add(parseInput(schemas.chrona_remember, raw), "learned"),
  chrona_forget: async (ctx, raw) => ctx.preferences.delete(parseInput(schemas.chrona_forget, raw).preferenceId),
  chrona_preferences: async (ctx, raw) => { parseInput(schemas.chrona_preferences, raw); return ctx.preferences.list(); },
};
/** No provider-supplied workspace IDs: all ownership comes from the capability. */
export function createTools(ports: StewardPorts) {
  const { db, now } = ports;
  async function call(token: string, name: string, raw: unknown) {
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
    let ok = false;
    try {
      if (run.lane === "build" && name !== "chrona_propose") throw new StewardError("forbidden", "Build runs may only call chrona_propose");
      if (name.startsWith("m_")) {
        const result = await callModuleTool(ports, { workspaceId, sessionId: run.sessionId, runId: run.id }, name, raw);
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
    const { run } = await authenticateRun(db, token, now());
    if (run.lane === "build") return [{ name: "chrona_propose", inputSchema: z.toJSONSchema(schemas.chrona_propose) }];
    return [...CHRONA_TOOLS.map(name => ({ name, inputSchema: z.toJSONSchema(schemas[name]) })), ...await moduleToolCatalog(ports, run)];
  }, call };
}
