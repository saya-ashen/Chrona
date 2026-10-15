import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { ACTIONS, DEFAULT_POLICY, resolveAskSchema, SUGGESTION_COOLDOWN_DAYS, type EntryActor } from "@chrona/contracts/steward";
import { canSuggest } from "@chrona/domain/steward/suggestions";
import { createAffairIn, newRef, queueAffair, requireAffair, type RecordContext } from "./affairs";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toAsk } from "./store";
const base = z.object({ affairId: z.string().min(1), title: z.string().trim().min(1).max(200), detail: z.string().max(2000).default("") });
const question = base.extend({ questions: z.array(z.object({ question: z.string().min(1).max(500), why: z.string().max(500) })).min(1).max(3) }).strict();
const approval = base.extend({ action: z.enum(ACTIONS), actionPayload: z.object({ toolId: z.string().min(1), version: z.number().int().positive() }).strict().optional() }).strict();
const suggestion = base.omit({ affairId: true }).extend({ affairId: z.string().optional(), topic: z.string().trim().min(1).max(80), nextStep: z.string().trim().min(1).max(500) }).strict();
export async function createBlockingAskIn(tx: Prisma.TransactionClient, ctx: Pick<RecordContext, "workspaceId" | "now">, kind: "question" | "approval", raw: unknown) {
    const { workspaceId, now } = ctx;
    const input = kind === "question" ? parseInput(question, raw) : parseInput(approval, raw);
      const affair = await requireAffair(tx, workspaceId, input.affairId), at = now();
      const payload = "actionPayload" in input ? input.actionPayload : undefined;
      if (payload && (!("action" in input) || input.action !== "run_script" || !await tx.toolVersion.findFirst({ where: { workspaceId, toolId: payload.toolId, version: payload.version } }))) throw new StewardError("invalid", "Invalid approval tool version");
      if ("action" in input) {
        const candidates = await tx.ask.findMany({ where: { workspaceId, affairId: affair.id, kind, action: input.action, status: "open" }, include: { affair: true } });
        const existing = candidates.find(row => {
          const stored = row.actionPayload as { toolId?: string; version?: number } | null;
          return payload ? stored?.toolId === payload.toolId && stored.version === payload.version : stored === null;
        });
        if (existing) return toAsk(existing);
      }
      const row = await tx.ask.create({ data: { workspaceId, affairId: affair.id, title: input.title, detail: input.detail, kind, questions: "questions" in input ? input.questions : [], action: "action" in input ? input.action : null, actionPayload: payload, affairRevision: affair.revision, ref: await newRef(tx, workspaceId), createdAt: at }, include: { affair: true } });
      await tx.affairEntry.create({ data: { workspaceId, affairId: affair.id, actor: "chrona", kind: kind === "question" ? "question" : "approval_request", text: input.title, data: { askId: row.id }, at } });
      await tx.affair.update({ where: { id: affair.id }, data: { agentState: "waiting_user", nextRunAt: null, revision: { increment: 1 }, lastActivityAt: at } });
      await audit(tx, { workspaceId, kind: "ask_created", actor: "chrona", subjectId: row.id, details: { kind } });
      return toAsk(row);
}
export async function createSuggestionIn(tx: Prisma.TransactionClient, ctx: Pick<RecordContext, "workspaceId" | "now">, raw: unknown) {
  const { workspaceId, now } = ctx;
  const input = parseInput(suggestion, raw), at = now();
  if (input.affairId) await requireAffair(tx, workspaceId, input.affairId);
  const recent = (await tx.ask.findMany({ where: { workspaceId, kind: "suggestion" } })).map(toAsk);
  if (!canSuggest(input.topic, recent, at)) return null;
  const row = await tx.ask.create({ data: { workspaceId, affairId: input.affairId, kind: "suggestion", title: input.title, detail: input.detail, topic: input.topic, actionPayload: { nextStep: input.nextStep }, ref: await newRef(tx, workspaceId), createdAt: at }, include: { affair: true } });
  if (input.affairId) await tx.affair.update({ where: { id: input.affairId }, data: { revision: { increment: 1 }, lastActivityAt: at } });
  await audit(tx, { workspaceId, kind: "ask_created", actor: "chrona", subjectId: row.id, details: { kind: "suggestion" } });
  return toAsk(row);
}
export function createAsks(ctx: RecordContext) {
  const { db, workspaceId, now } = ctx;
  const createBlocking = (kind: "question" | "approval", raw: unknown) => db.$transaction(tx => createBlockingAskIn(tx, ctx, kind, raw));
  return {
    createQuestion: (raw: unknown) => createBlocking("question", raw),
    createApproval: (raw: unknown) => createBlocking("approval", raw),
    createSuggestion: (raw: unknown) => db.$transaction(tx => createSuggestionIn(tx, ctx, raw)),
    resolve: (id: string, raw: unknown, actor: EntryActor = "user") => db.$transaction(async tx => {
      const input = parseInput(resolveAskSchema, raw), at = now();
      if (actor !== "user") throw new StewardError("forbidden", "Only the user resolves asks");
      const row = await tx.ask.findFirst({ where: { id, workspaceId } });
      if (!row) throw new StewardError("not_found", "Ask not found");
      if (row.affairId && (await requireAffair(tx, workspaceId, row.affairId)).status === "done") throw new StewardError("conflict", "这件事已经结束");
      if (row.status !== "open") throw new StewardError("conflict", "Ask already resolved");
      const allowed = row.kind === "question" ? ["answer"] : row.kind === "approval" ? ["approve", "deny"] : ["dismiss", "never_again", "accept_suggestion"];
      if (!allowed.includes(input.decision) || (input.scope && row.kind !== "approval") || (input.decision === "answer" && !input.text?.trim())) throw new StewardError("invalid", "Decision does not match ask");
      const status = input.decision === "approve" ? "approved" : input.decision === "deny" ? "denied" : ["dismiss", "never_again"].includes(input.decision) ? "dismissed" : "answered";
      const updated = await tx.ask.update({ where: { id }, data: { status, decision: input.decision, answer: input.text ?? null, approvalScope: input.decision === "approve" ? input.scope ?? "once" : null, resolvedAt: at, cooldownUntil: input.decision === "dismiss" ? new Date(at.getTime() + SUGGESTION_COOLDOWN_DAYS * 86400000) : null, revision: { increment: 1 } }, include: { affair: true } });
      if (input.decision === "approve") {
        if (!row.affairId || !row.action || DEFAULT_POLICY[row.action as keyof typeof DEFAULT_POLICY] === "never") throw new StewardError("forbidden", "Action cannot be granted");
        const payload = row.actionPayload as { toolId?: unknown; version?: unknown } | null;
        const toolScoped = row.action === "run_script" && typeof payload?.toolId === "string" && typeof payload.version === "number" && Number.isInteger(payload.version) && payload.version > 0;
        if (toolScoped && !await tx.toolVersion.findFirst({ where: { workspaceId, toolId: payload.toolId as string, version: payload.version as number } })) throw new StewardError("not_found", "Tool version not found");
        const scope = toolScoped ? { kind: "tool_version", toolId: payload.toolId as string, version: payload.version as number } : { kind: "affair", affairId: row.affairId };
        const grant = await tx.grant.create({ data: { workspaceId, action: row.action, mode: "preapproved", scope, once: input.scope !== "affair", origin: "user", createdAt: at } });
        await audit(tx, { workspaceId, kind: "grant_created", actor, subjectId: grant.id, details: { askId: id } });
      }
      let linkedAffairId: string | null = null;
      if (input.decision === "accept_suggestion") {
        const payload = row.actionPayload as { nextStep?: string } | null;
        if (!payload?.nextStep) throw new StewardError("invalid", "Suggestion has no next step");
        const affair = await createAffairIn(tx, ctx, { title: row.title, request: `${row.title}\n${payload.nextStep}` }, actor);
        linkedAffairId = affair.id;
        await tx.affairEntry.create({ data: { workspaceId, affairId: affair.id, actor, kind: "decision", text: row.title, data: { askId: id, sourceAffairId: row.affairId }, at } });
        await queueAffair(tx, affair.id, "new_request", at);
      }
      if (row.affairId) {
        await tx.affairEntry.create({ data: { workspaceId, affairId: row.affairId, actor, kind: input.decision === "answer" ? "answer" : "decision", text: input.text ?? input.decision, data: { askId: id, decision: input.decision, linkedAffairId }, at } });
        if (row.kind !== "suggestion") {
          await queueAffair(tx, row.affairId, "user_input", at);
        } else await tx.affair.update({ where: { id: row.affairId }, data: { revision: { increment: 1 }, lastActivityAt: at } });
      }
      await audit(tx, { workspaceId, kind: "ask_resolved", actor, subjectId: id, details: { ...input, linkedAffairId } });
      return toAsk(updated);
    }),
  };
}
