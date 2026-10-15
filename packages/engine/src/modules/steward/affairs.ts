import type { Prisma, PrismaClient } from "@chrona/db";
import { createAffairSchema, updateAffairSchema, addEntrySchema, affairDetailSchema, type AffairStatus, type EntryActor, type Run } from "@chrona/contracts/steward";
import { generateRef } from "@chrona/domain/steward/refs";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import * as view from "./store";
export type RecordContext = { db: PrismaClient; workspaceId: string; now(): Date };
export async function requireAffair(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
  const row = await tx.affair.findFirst({ where: { id, workspaceId } });
  if (!row) throw new StewardError("not_found", "Affair not found");
  return row;
}
export async function newRef(tx: Prisma.TransactionClient, workspaceId: string) {
  for (let i = 0; i < 100; i++) {
    const ref = generateRef(Math.random);
    if (!await tx.affair.findFirst({ where: { workspaceId, ref } }) && !await tx.ask.findFirst({ where: { workspaceId, ref } })) return ref;
  }
  throw new StewardError("conflict", "Reference space busy");
}
export async function queueAffair(tx: Prisma.TransactionClient, id: string, reason: Run["wakeReason"], at: Date) {
  const row = await tx.affair.findUnique({ where: { id } });
  if (!row) throw new StewardError("not_found", "Affair not found");
  const blocked = await tx.ask.count({ where: { affairId: id, status: "open", kind: { in: ["question", "approval"] } } });
  const stopped = row.status === "paused" || row.status === "done";
  const updated = await tx.affair.update({ where: { id }, data: { revision: { increment: 1 }, lastActivityAt: at, wakeReason: reason, nextRunAt: stopped || blocked ? null : at, agentState: stopped ? "idle" : blocked ? "waiting_user" : "queued" } });
  await audit(tx, { workspaceId: row.workspaceId, kind: "affair_queued", actor: "chrona", subjectId: id, details: { reason, agentState: updated.agentState } });
  return updated;
}
export async function createAffairIn(tx: Prisma.TransactionClient, ctx: Pick<RecordContext, "workspaceId" | "now">, raw: unknown, actor: EntryActor) {
  const input = parseInput(createAffairSchema, raw), at = ctx.now();
  if (!await tx.workspace.findUnique({ where: { id: ctx.workspaceId } })) throw new StewardError("not_found", "Workspace not found");
  const row = await tx.affair.create({ data: { workspaceId: ctx.workspaceId, title: input.title ?? input.request.slice(0, 200), ref: await newRef(tx, ctx.workspaceId), agentState: "queued", nextRunAt: at, createdAt: at, lastActivityAt: at } });
  await tx.affairEntry.create({ data: { workspaceId: ctx.workspaceId, affairId: row.id, kind: "request", text: input.request, actor, at } });
  await audit(tx, { workspaceId: ctx.workspaceId, kind: "affair_created", actor, subjectId: row.id, details: {} });
  return row;
}
async function mapped(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
  const row = await requireAffair(tx, workspaceId, id);
  return view.toAffair(row, await tx.ask.count({ where: { workspaceId, affairId: id, status: "open" } }), await tx.affairResult.findFirst({ where: { workspaceId, affairId: id }, orderBy: { version: "desc" } }));
}
function affairUpdateData(row: Awaited<ReturnType<typeof requireAffair>>, patch: ReturnType<typeof updateAffairSchema.parse>, at: Date) {
  const cadence = patch.care === undefined ? row.cadenceSeconds : patch.care?.cadenceSeconds ?? null;
  let status = patch.status ?? row.status;
  if (status !== "paused" && status !== "done") status = cadence === null ? "active" : "watching";
  const stopped = status === "paused" || status === "done";
  return { title: patch.title, goal: patch.goal, status, cadenceSeconds: cadence, notify: patch.care?.notify, nextCheckAt: nextCheckAt(row, patch, at, stopped, cadence), revision: { increment: 1 }, lastActivityAt: at, ...(stopped ? { agentState: "idle", nextRunAt: null, leaseUntil: null } : {}) };
}

function nextCheckAt(row: Awaited<ReturnType<typeof requireAffair>>, patch: ReturnType<typeof updateAffairSchema.parse>, at: Date, stopped: boolean, cadence: number | null) {
  if (stopped || cadence === null) return null;
  return patch.care !== undefined || row.nextCheckAt === null ? new Date(at.getTime() + cadence * 1000) : row.nextCheckAt;
}

export function createAffairs(ctx: RecordContext) {
  const { db, workspaceId, now } = ctx;
  return {
    create: (raw: unknown, actor: EntryActor = "user") => db.$transaction(async tx => view.toAffair(await createAffairIn(tx, ctx, raw, actor))),
    update: (id: string, raw: unknown) => db.$transaction(async tx => {
      const patch = parseInput(updateAffairSchema, raw), row = await requireAffair(tx, workspaceId, id), at = now();
      const data = affairUpdateData(row, patch, at);
      const { status } = data;
      const stopped = status === "paused" || status === "done";
      await tx.affair.update({ where: { id }, data });
      if (status === "done") {
        const expired = await tx.ask.updateMany({ where: { workspaceId, affairId: id, status: "open", kind: { in: ["question", "approval"] } }, data: { status: "expired", resolvedAt: at, revision: { increment: 1 } } });
        if (expired.count) {
          await tx.affairEntry.create({ data: { workspaceId, affairId: id, actor: "chrona", kind: "note", text: "事务已结束，未完成的问题和审批已过期。", at } });
          await audit(tx, { workspaceId, kind: "asks_expired", actor: "chrona", subjectId: id, details: { count: expired.count } });
        }
      }
      if (stopped) {
        await tx.affairRun.updateMany({ where: { affairId: id, workspaceId, status: "running" }, data: { status: "cancelled", endedAt: at } });
        await tx.notification.updateMany({ where: { affairId: id, workspaceId, status: { in: ["queued", "folded", "failed"] } }, data: { status: "suppressed", nextAttemptAt: null } });
      } else if (patch.status === "active") await queueAffair(tx, id, "user_input", at);
      await audit(tx, { workspaceId, kind: "affair_updated", actor: "user", subjectId: id, details: patch });
      return mapped(tx, workspaceId, id);
    }),
    addEntry: (id: string, raw: unknown, actor: EntryActor = "user") => db.$transaction(async tx => {
      const input = parseInput(addEntrySchema, raw), row = await requireAffair(tx, workspaceId, id), at = now();
      const entry = await tx.affairEntry.create({ data: { ...input, actor, workspaceId, affairId: id, at } });
      if (row.status === "done" && actor === "user") await tx.affair.update({ where: { id }, data: { status: row.cadenceSeconds === null ? "active" : "watching", nextCheckAt: row.cadenceSeconds === null ? null : new Date(at.getTime() + row.cadenceSeconds * 1000) } });
      await queueAffair(tx, id, "user_input", at);
      await audit(tx, { workspaceId, kind: "entry_added", actor, subjectId: id, details: { entryId: entry.id, kind: input.kind } });
      return view.toEntry(entry);
    }),
    list: (filters: { status?: AffairStatus } = {}) => db.$transaction(async tx => {
      const rows = await tx.affair.findMany({ where: { workspaceId, status: filters.status }, orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }] });
      const items = await Promise.all(rows.map(row => mapped(tx, workspaceId, row.id)));
      return items.sort((a, b) => Number(b.openAsks > 0) - Number(a.openAsks > 0));
    }),
    detail: (id: string) => db.$transaction(async tx => {
      await requireAffair(tx, workspaceId, id);
      const where = { workspaceId, affairId: id };
      const results = await tx.affairResult.findMany({ where, orderBy: { version: "desc" } });
      const grants = (await tx.grant.findMany({ where: { workspaceId } })).map(view.toGrant).filter(g => g.scope.kind === "affair" && g.scope.affairId === id);
      return affairDetailSchema.parse({ affair: await mapped(tx, workspaceId, id), asks: (await tx.ask.findMany({ where, include: { affair: true }, orderBy: { createdAt: "asc" } })).map(view.toAsk), latestResult: results[0] ? view.toResult(results[0]) : null, resultVersions: results.map(r => ({ version: r.version, title: r.title, createdAt: r.createdAt.toISOString() })), entries: (await tx.affairEntry.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], take: 100 })).reverse().map(view.toEntry), followUps: (await tx.followUp.findMany({ where, orderBy: { dueAt: "asc" } })).map(view.toFollowUp), tools: (await tx.managedTool.findMany({ where, include: { versions: true } })).map(view.toTool), grants, runs: (await tx.affairRun.findMany({ where, orderBy: { number: "desc" }, take: 10 })).map(view.toRun), events: (await tx.inboundEvent.findMany({ where, orderBy: { receivedAt: "desc" }, take: 20 })).map(view.toInboundEvent) });
    }),
    getResult: async (id: string, version: number) => {
      const row = await db.affairResult.findFirst({ where: { workspaceId, affairId: id, version } });
      if (!row) throw new StewardError("not_found", "Result not found");
      return view.toResult(row);
    },
  };
}
