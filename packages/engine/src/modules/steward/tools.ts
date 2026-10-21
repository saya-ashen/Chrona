import { z } from "zod";
import { compileUiSpec, checkUiSpec, uiGuide } from "@chrona/ui-catalog";
import { uiSummary } from "./ui-files";
import { uiUsage } from "./ui";
import { join, relative } from "node:path";
import { CHRONA_TOOLS, chronaToolInputSchemas as schemas, RUN_LIMITS, type Action } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { authenticateRun, canDescribeInactiveAffair, liveRuns } from "./runs";
import { createAffairs, requireAffair } from "./affairs";
import { createWorkspaceFs } from "./workspace-fs";
import { createSchedules } from "./schedules";
import { createModules } from "./modules";
import { callModuleTool, moduleToolCatalog } from "./module-tools";
import { proposeFromBuild, requestBuild } from "./module-build-lane";
import { createPreferences } from "./preferences";
import { createApprovals } from "./approvals";
import { createNotifications, RESPONSE_KEY_PREFIX } from "./notify";
import { consumeOnce, effectivePolicyIn } from "./grants";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";

type ToolName = keyof typeof schemas;
type Claim = Awaited<ReturnType<typeof authenticateRun>> & { index: number };
function toolContext(ports: StewardPorts, claim: Claim, tool: ToolName) {
  const { db, now } = ports, { workspaceId } = claim;
  const ctx = { db, workspaceId, now };
  return { ...claim, ...ctx, ports, tool,
    affairs: createAffairs(ctx, createWorkspaceFs(ports.dataDir)),
    modules: createModules(ports, workspaceId),
    schedules: createSchedules(ports, workspaceId), preferences: createPreferences(ctx), approvals: createApprovals(ctx) };
}
type ToolContext = ReturnType<typeof toolContext>;
function affairId({ run }: ToolContext, id?: string) {
  const result = id ?? run.affairId;
  if (!result) throw new StewardError("invalid", "This run is at the workspace root: create or focus an affair first (chrona_affair_create / chrona_focus), then pass affairId.");
  return result;
}
async function scheduleAffairId(ctx: ToolContext, id?: string) {
  const { run, db, workspaceId } = ctx;
  if (id || run.affairId) return affairId(ctx, id);
  const focus = run.conversationKey ? await db.audit.findFirst({ where: { workspaceId, kind: "conversation_focus", subjectId: run.conversationKey }, orderBy: { createdAt: "desc" } }) : null;
  const focusedId = z.object({ affairId: z.string() }).safeParse(focus?.details).data?.affairId;
  if (focusedId) {
    const focused = await requireAffair(db, workspaceId, focusedId);
    if (focused.status === "active") return focused.id;
  }
  return affairId(ctx);
}
async function gate(ctx: ToolContext, action: Action, target: { affairId?: string; connectorId?: string }, payload: Prisma.InputJsonValue) {
  const { db, workspaceId, now, tool } = ctx;
  return db.$transaction(async tx => {
    const decision = await effectivePolicyIn(tx, workspaceId, action, target, now());
    if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
    if (decision.mode === "ask") {
      const approval = await tx.approval.create({ data: { workspaceId, affairId: target.affairId, action, title: tool, detail: decision.reason, preview: JSON.stringify(payload).slice(0, 20000), payload, createdAt: now() } });
      await audit(tx, { workspaceId, actor: "chrona", kind: "approval_created", subjectId: approval.id, details: { action } });
      return { approvalId: approval.id, status: "awaiting_approval" };
    }
    if (decision.grantId) await consumeOnce(tx, workspaceId, decision.grantId, now());
    return null;
  });
}
async function explicitMessageAffair({ db, workspaceId, run }: ToolContext) {
  const source = await db.audit.findFirst({ where: { workspaceId, subjectId: run.id, kind: "chat_run_input" }, orderBy: { createdAt: "desc" } });
  const input = z.object({ messageId: z.string(), explicitAffair: z.boolean().optional() }).safeParse(source?.details);
  if (!input.success) return null;
  const message = await db.message.findFirst({ where: { workspaceId, id: input.data.messageId } });
  return input.data.explicitAffair || message?.quotedMessageId ? message?.affairId ?? null : null;
}
async function responseContext(ctx: ToolContext) {
  const explicitId = ctx.tool === "chrona_reply" ? await explicitMessageAffair(ctx) : null;
  const id = explicitId ?? await runFocus(ctx) ?? ctx.run.affairId;
  if (id) {
    const affair = await requireAffair(ctx.db, ctx.workspaceId, id);
    if (affair.status !== "active" && !await canDescribeInactiveAffair(ctx.db, ctx.run, id, ctx.tool)) throw new StewardError("conflict", "Affair is not active");
  }
  return { ...ctx, run: { ...ctx.run, affairId: id } };
}
async function reply(ctx: ToolContext, raw: unknown) {
  ctx = await responseContext(ctx);
  const { run, db, workspaceId, affairs, ports, now } = ctx;
  const input = parseInput(schemas.chrona_reply, raw);
  if (run.lane !== "foreground" || !run.conversationKey) throw new StewardError("invalid", "Reply requires a foreground conversation");
  const conversation = await db.message.findFirst({ where: { workspaceId, conversationKey: run.conversationKey }, orderBy: { at: "desc" } });
  if (!conversation) throw new StewardError("not_found", "Conversation not found");
  const files: { name: string; path: string; mime: string; size: number }[] = [], deliveryFiles = [];
  for (const path of input.files) {
    const directory = await affairs.files(affairId(ctx));
    // Resolve through the workspace filesystem boundary, never trust a supplied path.
    const file = await directory.read(path);
    const name = path.split("/").pop()!;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const node = (await directory.tree(parent)).find(node => node.path === path);
    if (!node || node.kind !== "file") throw new StewardError("not_found", "Reply file not found");
    files.push({ name, path, mime: file.mime, size: node.size });
    deliveryFiles.push({ name, path: join(await directory.directory(), path) });
  }
  const explicitAffair = Boolean(await explicitMessageAffair(ctx));
  const message = await db.$transaction(async tx => {
    const message = await tx.message.create({ data: { workspaceId, direction: "out", channel: conversation.channel, conversationKey: run.conversationKey!, affairId: run.affairId, text: input.text, attachments: files, at: now() } });
    await audit(tx, { workspaceId, actor: "chrona", kind: "run_reply", subjectId: run.id, details: { messageId: message.id, explicitAffair } });
    return message;
  });
  await linkFocusedMessages(ctx);
  const adapter = ports.deliveries.find(d => d.channel === conversation.channel);
  const delivery = adapter ? await adapter.send({ idempotencyKey: `reply:${message.id}`, title: "", body: input.text, link: run.affairId ? `${ports.publicUrl ?? ""}/affairs/${run.affairId}` : null, recipient: null, files: deliveryFiles }) : { outcome: "rejected", retryable: true, error: "Delivery unavailable" };
  return { messageId: message.id, delivery };
}
/** The user is waiting on this affair: they wrote about it after Chrona last told them anything about it. */
async function awaitedByUser({ db, workspaceId, run }: ToolContext) {
  if (!run.affairId) return false;
  const asked = await db.message.findFirst({ where: { workspaceId, affairId: run.affairId, direction: "in" }, orderBy: { at: "desc" } });
  if (!asked) return false;
  const told = await db.notification.findFirst({ where: { workspaceId, affairId: run.affairId, createdAt: { gt: asked.at }, status: { in: ["queued", "sent"] } } });
  return !told;
}
async function notify(ctx: ToolContext, raw: unknown) {
  ctx = await responseContext(ctx);
  const { run, tool, affairs, ports, workspaceId, index } = ctx;
  const input = parseInput(schemas.chrona_notify, raw);
  const pending = await gate(ctx, "notify_user", { affairId: run.affairId ?? undefined }, { tool, ...input });
  if (pending) return pending;
  if (input.file) await (await affairs.files(affairId(ctx))).read(input.file);
  const responds = await awaitedByUser(ctx);
  return createNotifications(ports, workspaceId).enqueue({ level: input.level, title: input.title, body: input.body, affairId: run.affairId ?? undefined, responds, dedupeKey: `${responds ? RESPONSE_KEY_PREFIX : "tool:"}${run.id}:${index}` });
}
async function schedule(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_schedule, raw), id = await scheduleAffairId(ctx, input.affairId);
  const pending = await gate(ctx, "schedule", { affairId: id }, { tool: ctx.tool, ...input, affairId: id });
  if (pending) return pending;
  if (input.mode === "wake" && input.rule.kind === "at" && new Date(input.rule.at).getTime() <= ctx.now().getTime() + 60000) {
    const affair = await requireAffair(ctx.db, ctx.workspaceId, id);
    if (affair.status !== "active") throw new StewardError("conflict", "Affair is not active");
    // A run scheduling follow-up work for itself must get a new run, not an instruction to its own session.
    const running = await ctx.db.run.findFirst({ where: { workspaceId: ctx.workspaceId, affairId: id, lane: "background", status: "running", id: { not: ctx.run.id } }, orderBy: { createdAt: "asc" } });
    const handle = running && liveRuns.get(running.id);
    let mergedId: string | null = null;
    if (handle) {
      try {
        await handle.inject("Additional instruction for the work in progress (from the conversation): " + input.text);
        mergedId = running.id;
      } catch { /* Failed delivery falls back to a normal schedule. */ }
    } else {
      mergedId = await ctx.db.$transaction(async tx => {
        const queued = await tx.run.findFirst({ where: { workspaceId: ctx.workspaceId, affairId: id, lane: "background", status: "queued" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        if (!queued) {
          // A due wake that has not fired yet becomes the same run: extend its instruction.
          const due = await tx.schedule.findFirst({ where: { workspaceId: ctx.workspaceId, affairId: id, mode: "wake", status: "active", nextAt: { lte: new Date(ctx.now().getTime() + 60000) } }, orderBy: { nextAt: "asc" } });
          if (!due || due.rule === null || (due.rule as { kind?: string }).kind !== "at") return null;
          const extended = await tx.schedule.updateMany({ where: { id: due.id, status: "active", text: due.text }, data: { text: (due.text + "\n\nAdditional instruction added later: " + input.text).slice(0, 4000) } });
          return extended.count ? due.id : null;
        }
        const updated = await tx.run.updateMany({ where: { id: queued.id, status: "queued", prompt: queued.prompt }, data: { prompt: queued.prompt + "\n\nAdditional instruction added later: " + input.text } });
        return updated.count ? queued.id : null;
      });
    }
    if (mergedId) {
      await audit(ctx.db, { workspaceId: ctx.workspaceId, actor: "chrona", kind: "wake_merged", subjectId: mergedId, details: { affairId: id } });
      return { merged: true, runId: mergedId, note: "Work on this affair is already running; the instruction was delivered to it. Do not schedule another wake." };
    }
  }
  return ctx.schedules.create(id, { mode: input.mode, rule: input.rule, text: input.text, label: input.label, until: input.until }, "chrona");
}
async function proposeModule(ctx: ToolContext, raw: unknown) {
  const { request, dir, ...input } = parseInput(schemas.chrona_propose, raw);
  if (ctx.run.lane === "build") {
    if (!dir) throw new StewardError("conflict", "Build runs submit module directories, not build requests");
    return proposeFromBuild(ctx.ports, ctx.workspaceId, ctx.run, { dir, intent: input.intent });
  }
  const affair = await scheduleAffairId(ctx, input.affairId);
  if (request) return requestBuild(ctx.ports, ctx.workspaceId, ctx.run, { affairId: affair, request, intent: input.intent });
  return ctx.modules.propose({ ...input, dir: dir!, affairId: affair }, "provider");
}
async function listModules(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_modules, raw);
  const rows = await ctx.modules.list(input.affairId ?? ctx.run.affairId ?? undefined);
  return rows.map(({ name, id, activeHash, status, versions, runs }) => ({ name, id, activeHash, status, versions, runs }));
}
async function requireRunModule(ctx: ToolContext, moduleId: string) {
  const row = await ctx.db.module.findFirst({ where: { id: moduleId, workspaceId: ctx.workspaceId, ...(ctx.run.affairId ? { affairId: ctx.run.affairId } : {}) } });
  if (!row) throw new StewardError("not_found", "Module not found");
  return row;
}
async function checkoutModule(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_module_checkout, raw);
  const module = await requireRunModule(ctx, input.moduleId);
  await ctx.modules.checkout(module.id, input.hash, input.dir);
  return { moduleId: module.id, hash: input.hash ?? module.activeHash, dir: input.dir };
}
async function rollbackModule(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_module_rollback, raw);
  await requireRunModule(ctx, input.moduleId);
  return ctx.modules.rollback(input.moduleId, input.hash);
}
async function schedules(ctx: ToolContext, raw: unknown) {
  return ctx.schedules.list(await scheduleAffairId(ctx, parseInput(schemas.chrona_schedules, raw).affairId));
}
async function cancelSchedule(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_schedule_cancel, raw);
  const row = await ctx.db.schedule.findFirst({ where: { workspaceId: ctx.workspaceId, id: input.scheduleId } });
  if (!row) throw new StewardError("not_found", "Schedule not found");
  const pending = await gate(ctx, "schedule", { affairId: row.affairId }, { tool: ctx.tool, ...input });
  return pending ?? await ctx.schedules.cancel(row.id);
}
function affairs(ctx: ToolContext, raw: unknown) { return ctx.affairs.list(parseInput(schemas.chrona_affairs, raw).status); }
async function runFocus({ db, workspaceId, run }: ToolContext) {
  if (!run.conversationKey) return null;
  const records = await db.audit.findMany({ where: { workspaceId, kind: "conversation_focus", subjectId: run.conversationKey }, orderBy: { createdAt: "desc" } });
  for (const record of records) {
    const focus = z.object({ affairId: z.string(), runId: z.string() }).safeParse(record.details);
    if (focus.success && focus.data.runId === run.id) return focus.data.affairId;
  }
  return null;
}
async function linkFocusedMessages(ctx: ToolContext) {
  const focusedId = await runFocus(ctx);
  if (focusedId) await linkRunMessages(ctx, focusedId);
}
async function linkRunMessages(ctx: ToolContext, id: string) {
  const { db, workspaceId, run } = ctx;
  const records = await db.audit.findMany({ where: { workspaceId, subjectId: run.id, kind: { in: ["chat_run_input", "run_reply"] } } });
  const ids = records.flatMap(record => {
    const parsed = z.object({ messageId: z.string(), explicitAffair: z.boolean().optional() }).safeParse(record.details);
    return parsed.success && !parsed.data.explicitAffair ? [parsed.data.messageId] : [];
  });
  await db.message.updateMany({ where: { workspaceId, conversationKey: run.conversationKey!, quotedMessageId: null, id: { in: ids } }, data: { affairId: id } });
}
async function createAffair(ctx: ToolContext, raw: unknown) {
  const { affairs, run, db, workspaceId } = ctx;
  const input = parseInput(schemas.chrona_affair_create, raw);
  const affair = await affairs.create({ title: input.title });
  if (input.readme) {
    const files = await affairs.files(affair.id), current = await files.read("README.md");
    await files.save("README.md", input.readme, current.revision, "chrona");
  }
  // The conversation now talks about this affair, so later messages and schedules land in it.
  if (run.conversationKey) {
    await audit(db, { workspaceId, actor: "chrona", kind: "conversation_focus", subjectId: run.conversationKey, details: { affairId: affair.id, runId: run.id } });
    await linkRunMessages(ctx, affair.id);
  }
  const path = relative(run.cwd, await (await affairs.files(affair.id)).directory()) || ".";
  // A sandboxed run cannot write into a directory created after it started.
  const next = run.affairId ? null : "The new affair directory may not be writable in this run. Its README already holds `readme`; to continue working inside it, chrona_schedule a wake at now with a precise instruction (the next run starts inside the affair), reply briefly, and stop.";
  return { ...(await affairs.detail(affair.id)).affair, path, next };
}
function updateAffair(ctx: ToolContext, raw: unknown) {
  const { affairId: id, ...input } = parseInput(schemas.chrona_affair_update, raw);
  return ctx.affairs.update(id, input, ctx.run.id);
}
async function focus(ctx: ToolContext, raw: unknown) {
  const { run, affairs, db, workspaceId } = ctx;
  const input = parseInput(schemas.chrona_focus, raw);
  if (!run.conversationKey) throw new StewardError("invalid", "Focus requires a conversation");
  const directory = await (await affairs.files(input.affairId)).directory();
  await audit(db, { workspaceId, actor: "chrona", kind: "conversation_focus", subjectId: run.conversationKey, details: { ...input, runId: run.id } });
  await linkRunMessages(ctx, input.affairId);
  return { ...input, path: relative(run.cwd, directory) || "." };
}
async function requestApproval(ctx: ToolContext, raw: unknown) {
  const { db, workspaceId, run, now, approvals, tool } = ctx;
  const input = parseInput(schemas.chrona_request_approval, raw);
  const decision = await effectivePolicyIn(db, workspaceId, input.action, { affairId: run.affairId ?? undefined }, now());
  if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
  return approvals.create({ ...input, affairId: run.affairId ?? undefined, payload: { tool, ...input } });
}
async function sendEmail(ctx: ToolContext, raw: unknown) {
  const { db, workspaceId, run, now, approvals, tool } = ctx;
  const input = parseInput(schemas.chrona_send_email, raw);
  const connector = await db.connector.findFirst({ where: { workspaceId, id: input.connectorId } });
  if (!connector || connector.kind !== "email" || !connector.canSend || connector.status !== "active") throw new StewardError("forbidden", "Email connector cannot send");
  const decision = await effectivePolicyIn(db, workspaceId, "send_external_message", { affairId: run.affairId ?? undefined, connectorId: input.connectorId }, now());
  if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
  // V5 executes the stored payload through approvals.onApproved. Never claim a send here.
  return approvals.create({ action: "send_external_message", title: input.subject, detail: `Email to ${input.to.join(", ")}`, preview: input.body.slice(0, 20000), affairId: run.affairId ?? undefined, payload: { tool, ...input } });
}
async function inbound(ctx: ToolContext, raw: unknown) {
  const { db, workspaceId, run, tool } = ctx;
  const { limit, ...where } = parseInput(schemas.chrona_inbound, raw);
  const connectors = where.connectorId ? [{ id: where.connectorId }] : await db.connector.findMany({ where: { workspaceId }, select: { id: true } });
  for (const connector of connectors) {
    const pending = await gate(ctx, "read_source", { connectorId: connector.id, affairId: run.affairId ?? undefined }, { tool, ...where, limit });
    if (pending) return pending;
  }
  return db.inboundItem.findMany({ where: { workspaceId, ...where }, take: limit, orderBy: { receivedAt: "desc" }, select: { id: true, connectorId: true, from: true, subject: true, receivedAt: true, path: true, status: true, ruleNote: true } });
}
function remember(ctx: ToolContext, raw: unknown) { return ctx.preferences.add(parseInput(schemas.chrona_remember, raw), "learned"); }
function forget(ctx: ToolContext, raw: unknown) { return ctx.preferences.delete(parseInput(schemas.chrona_forget, raw).preferenceId); }
function preferences(ctx: ToolContext, raw: unknown) { parseInput(schemas.chrona_preferences, raw); return ctx.preferences.list(); }
async function guideUi(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_ui_guide, raw);
  const id = affairId(ctx, input.affairId), files = await ctx.affairs.files(id);
  const preferences = (await ctx.preferences.list()).filter(p => p.topic === "ui").map(p => p.text);
  return { guide: uiGuide(preferences, await uiUsage(ctx, id, files)) };
}
async function setUi(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_ui_set, raw), id = affairId(ctx, input.affairId);
  const affair = await requireAffair(ctx.db, ctx.workspaceId, id);
  if (affair.status !== "active" && !await canDescribeInactiveAffair(ctx.db, ctx.run, id, ctx.tool)) throw new StewardError("conflict", "Affair is not active");
  let spec: object;
  try { spec = compileUiSpec(input.spec); }
  catch { return { ok: false, issues: ["Invalid JSONL patch stream"] }; }
  const checked = checkUiSpec(spec);
  if (!checked.ok) return checked;
  const files = await ctx.affairs.files(id);
  await files.writeUi(input.path, JSON.stringify(spec, null, 2) + "\n", input.role);
  return { ok: true, path: input.path, role: input.role, summary: uiSummary(spec) };
}
const handlers: Record<ToolName, (ctx: ToolContext, raw: unknown) => Promise<unknown>> = {
  chrona_ui_guide: guideUi, chrona_ui_set: setUi,
  chrona_propose: proposeModule, chrona_modules: listModules, chrona_module_checkout: checkoutModule, chrona_module_rollback: rollbackModule,
  chrona_reply: reply, chrona_notify: notify, chrona_schedule: schedule, chrona_schedules: schedules,
  chrona_schedule_cancel: cancelSchedule, chrona_affairs: affairs, chrona_affair_create: createAffair,
  chrona_affair_update: updateAffair, chrona_focus: focus, chrona_request_approval: requestApproval,
  chrona_send_email: sendEmail, chrona_inbound: inbound, chrona_remember: remember, chrona_forget: forget, chrona_preferences: preferences,
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
        const result = await callModuleTool(ports, run, name, raw);
        ok = true;
        return result;
      }
      if (!CHRONA_TOOLS.includes(name as ToolName)) throw new StewardError("invalid", "Unknown Chrona tool");
      const tool = name as ToolName;
      const result = await handlers[tool](toolContext(ports, claim, tool), raw);
      ok = true;
      return result;
    } finally {
      await db.$transaction(async tx => {
        const row = await tx.run.findUniqueOrThrow({ where: { id: run.id } });
        const calls = row.toolCalls as Prisma.InputJsonObject[];
        calls[index] = { ...calls[index], ok };
        await tx.run.update({ where: { id: run.id }, data: { toolCalls: calls } });
        await audit(tx, { workspaceId, actor: "chrona", kind: "tool_finished", subjectId: run.id, details: { tool: name.slice(0, 200), index, ok } });
      });
    }
  }
  return {
    catalog: async (token: string) => {
      const { run } = await authenticateRun(db, token, now());
      if (run.lane === "build") return [{ name: "chrona_propose", inputSchema: z.toJSONSchema(schemas.chrona_propose) }];
      return [...CHRONA_TOOLS.map(name => ({ name, inputSchema: z.toJSONSchema(schemas[name]) })), ...await moduleToolCatalog(ports, run)];
    },
    call,
  };
}
