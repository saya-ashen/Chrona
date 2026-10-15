import { z } from "zod";
import { join, relative } from "node:path";
import { CHRONA_TOOLS, chronaToolInputSchemas as schemas, RUN_LIMITS, type Action } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./service";
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
      const result = await dispatch(name as ToolName);
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
    async function dispatch(tool: ToolName): Promise<unknown> {
      const ctx = { db, workspaceId, now }, fs = createWorkspaceFs(ports.dataDir);
      const affairs = createAffairs(ctx, fs), schedules = createSchedules(ports, workspaceId);
      const preferences = createPreferences(ctx), approvals = createApprovals(ctx);
      const affairId = (id?: string) => {
        const result = id ?? run.affairId;
        if (!result) throw new StewardError("invalid", "This run is at the workspace root: create or focus an affair first (chrona_affair_create / chrona_focus), then pass affairId.");
        return result;
      };
      async function scheduleAffairId(id?: string) {
        if (id || run.affairId) return affairId(id);
        const focus = run.conversationKey ? await db.audit.findFirst({ where: { workspaceId, kind: "conversation_focus", subjectId: run.conversationKey }, orderBy: { createdAt: "desc" } }) : null;
        const focusedId = z.object({ affairId: z.string() }).safeParse(focus?.details).data?.affairId;
        if (focusedId) {
          const focused = await requireAffair(db, workspaceId, focusedId);
          if (focused.status === "active") return focused.id;
        }
        return affairId();
      }
      async function gate(action: Action, target: { affairId?: string; connectorId?: string }, payload: Prisma.InputJsonValue) {
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
      switch (tool) {
        case "chrona_reply": {
          const input = parseInput(schemas[tool], raw);
          if (run.lane !== "foreground" || !run.conversationKey) throw new StewardError("invalid", "Reply requires a foreground conversation");
          const conversation = await db.message.findFirst({ where: { workspaceId, conversationKey: run.conversationKey }, orderBy: { at: "desc" } });
          if (!conversation) throw new StewardError("not_found", "Conversation not found");
          const files: { name: string; path: string; mime: string; size: number }[] = [], deliveryFiles = [];
          for (const path of input.files) {
            const directory = await affairs.files(affairId());
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
        case "chrona_notify": {
          const input = parseInput(schemas[tool], raw);
          const pending = await gate("notify_user", { affairId: run.affairId ?? undefined }, { tool, ...input });
          if (pending) return pending;
          if (input.file) await (await affairs.files(affairId())).read(input.file);
          return createNotifications(ports, workspaceId).enqueue({ level: input.level, title: input.title, body: input.body, affairId: run.affairId ?? undefined, dedupeKey: `tool:${run.id}:${index}` });
        }
        case "chrona_schedule": {
          const input = parseInput(schemas[tool], raw), id = await scheduleAffairId(input.affairId);
          const pending = await gate("schedule", { affairId: id }, { tool, ...input, affairId: id });
          if (pending) return pending;
          return schedules.create(id, { mode: input.mode, rule: input.rule, text: input.text, command: input.command, until: input.until });
        }
        case "chrona_schedules": return schedules.list(await scheduleAffairId(parseInput(schemas[tool], raw).affairId));
        case "chrona_schedule_cancel": {
          const input = parseInput(schemas[tool], raw);
          const row = await db.schedule.findFirst({ where: { workspaceId, id: input.scheduleId } });
          if (!row) throw new StewardError("not_found", "Schedule not found");
          const pending = await gate("schedule", { affairId: row.affairId }, { tool, ...input });
          return pending ?? await schedules.cancel(row.id);
        }
        case "chrona_affairs": return affairs.list(parseInput(schemas[tool], raw).status);
        case "chrona_affair_create": {
          const input = parseInput(schemas[tool], raw);
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
        case "chrona_affair_update": {
          const { affairId: id, ...input } = parseInput(schemas[tool], raw);
          return affairs.update(id, input);
        }
        case "chrona_focus": {
          const input = parseInput(schemas[tool], raw);
          if (!run.conversationKey) throw new StewardError("invalid", "Focus requires a conversation");
          const directory = await (await affairs.files(input.affairId)).directory();
          await audit(db, { workspaceId, actor: "chrona", kind: "conversation_focus", subjectId: run.conversationKey, details: input });
          return { ...input, path: relative(run.cwd, directory) || "." };
        }
        case "chrona_request_approval": {
          const input = parseInput(schemas[tool], raw);
          const decision = await effectivePolicyIn(db, workspaceId, input.action, { affairId: run.affairId ?? undefined }, now());
          if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
          return approvals.create({ ...input, affairId: run.affairId ?? undefined, payload: { tool, ...input } });
        }
        case "chrona_send_email": {
          const input = parseInput(schemas[tool], raw);
          const connector = await db.connector.findFirst({ where: { workspaceId, id: input.connectorId } });
          if (!connector || connector.kind !== "email" || !connector.canSend || connector.status !== "active") throw new StewardError("forbidden", "Email connector cannot send");
          const decision = await effectivePolicyIn(db, workspaceId, "send_external_message", { affairId: run.affairId ?? undefined, connectorId: input.connectorId }, now());
          if (decision.mode === "never") throw new StewardError("forbidden", decision.reason);
          // V5 executes the stored payload through approvals.onApproved. Never claim a send here.
          return approvals.create({ action: "send_external_message", title: input.subject, detail: `Email to ${input.to.join(", ")}`, preview: input.body.slice(0, 20000), affairId: run.affairId ?? undefined, payload: { tool, ...input } });
        }
        case "chrona_inbound": {
          const { limit, ...where } = parseInput(schemas[tool], raw);
          const connectors = where.connectorId ? [{ id: where.connectorId }] : await db.connector.findMany({ where: { workspaceId }, select: { id: true } });
          for (const connector of connectors) {
            const pending = await gate("read_source", { connectorId: connector.id, affairId: run.affairId ?? undefined }, { tool, ...where, limit });
            if (pending) return pending;
          }
          return db.inboundItem.findMany({ where: { workspaceId, ...where }, take: limit, orderBy: { receivedAt: "desc" }, select: { id: true, connectorId: true, from: true, subject: true, receivedAt: true, path: true, status: true, ruleNote: true } });
        }
        case "chrona_remember": return preferences.add(parseInput(schemas[tool], raw), "learned");
        case "chrona_forget": return preferences.delete(parseInput(schemas[tool], raw).preferenceId);
        case "chrona_preferences": parseInput(schemas[tool], raw); return preferences.list();
      }
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
