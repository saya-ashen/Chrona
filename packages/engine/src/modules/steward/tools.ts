import { z } from "zod";
import { join, relative } from "node:path";
import { CHRONA_TOOLS, chronaToolInputSchemas as schemas, RUN_LIMITS, type Action } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { authenticateRun } from "./runs";
import { createAffairs, requireAffair } from "./affairs";
import { createWorkspaceFs } from "./workspace-fs";
import { createSchedules } from "./schedules";
import { createPreferences } from "./preferences";
import { createApprovals } from "./approvals";
import { createNotifications } from "./notify";
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
async function reply(ctx: ToolContext, raw: unknown) {
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
  const message = await db.$transaction(async tx => {
    const message = await tx.message.create({ data: { workspaceId, direction: "out", channel: conversation.channel, conversationKey: run.conversationKey!, affairId: run.affairId, text: input.text, attachments: files, at: now() } });
    await audit(tx, { workspaceId, actor: "chrona", kind: "run_reply", subjectId: run.id, details: { messageId: message.id } });
    return message;
  });
  const adapter = ports.deliveries.find(d => d.channel === conversation.channel);
  const delivery = adapter ? await adapter.send({ idempotencyKey: `reply:${message.id}`, title: "", body: input.text, link: run.affairId ? `${ports.publicUrl ?? ""}/affairs/${run.affairId}` : null, recipient: null, files: deliveryFiles }) : { outcome: "rejected", retryable: true, error: "Delivery unavailable" };
  return { messageId: message.id, delivery };
}
async function notify(ctx: ToolContext, raw: unknown) {
  const { run, tool, affairs, ports, workspaceId, index } = ctx;
  const input = parseInput(schemas.chrona_notify, raw);
  const pending = await gate(ctx, "notify_user", { affairId: run.affairId ?? undefined }, { tool, ...input });
  if (pending) return pending;
  if (input.file) await (await affairs.files(affairId(ctx))).read(input.file);
  return createNotifications(ports, workspaceId).enqueue({ level: input.level, title: input.title, body: input.body, affairId: run.affairId ?? undefined, dedupeKey: `tool:${run.id}:${index}` });
}
async function schedule(ctx: ToolContext, raw: unknown) {
  const input = parseInput(schemas.chrona_schedule, raw), id = await scheduleAffairId(ctx, input.affairId);
  const pending = await gate(ctx, "schedule", { affairId: id }, { tool: ctx.tool, ...input, affairId: id });
  if (pending) return pending;
  return ctx.schedules.create(id, { mode: input.mode, rule: input.rule, text: input.text, command: input.command, until: input.until });
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
async function createAffair(ctx: ToolContext, raw: unknown) {
  const { affairs, run, db, workspaceId } = ctx;
  const input = parseInput(schemas.chrona_affair_create, raw);
  const affair = await affairs.create({ title: input.title });
  if (input.readme) {
    const files = await affairs.files(affair.id), current = await files.read("README.md");
    await files.save("README.md", input.readme, current.revision, "chrona");
  }
  // The conversation now talks about this affair, so later messages and schedules land in it.
  if (run.conversationKey) await audit(db, { workspaceId, actor: "chrona", kind: "conversation_focus", subjectId: run.conversationKey, details: { affairId: affair.id } });
  const path = relative(run.cwd, await (await affairs.files(affair.id)).directory()) || ".";
  // A sandboxed run cannot write into a directory created after it started.
  const next = run.affairId ? null : "The new affair directory may not be writable in this run. Its README already holds `readme`; to continue working inside it, chrona_schedule a wake at now with a precise instruction (the next run starts inside the affair), reply briefly, and stop.";
  return { ...(await affairs.detail(affair.id)).affair, path, next };
}
function updateAffair(ctx: ToolContext, raw: unknown) {
  const { affairId: id, ...input } = parseInput(schemas.chrona_affair_update, raw);
  return ctx.affairs.update(id, input);
}
async function focus(ctx: ToolContext, raw: unknown) {
  const { run, affairs, db, workspaceId } = ctx;
  const input = parseInput(schemas.chrona_focus, raw);
  if (!run.conversationKey) throw new StewardError("invalid", "Focus requires a conversation");
  const directory = await (await affairs.files(input.affairId)).directory();
  await audit(db, { workspaceId, actor: "chrona", kind: "conversation_focus", subjectId: run.conversationKey, details: input });
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
const handlers: Record<ToolName, (ctx: ToolContext, raw: unknown) => Promise<unknown>> = {
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
      const auth = await authenticateRun(tx, token, now());
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
      await authenticateRun(db, token, now());
      return CHRONA_TOOLS.map(name => ({ name, inputSchema: z.toJSONSchema(schemas[name]) }));
    },
    call,
  };
}
