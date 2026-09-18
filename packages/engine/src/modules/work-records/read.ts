import { db } from "@chrona/db";
import { workContextSchema, type WorkSignals, type WorkSummary, type WorkEntry, type WorkSource, type WorkView, type WorkSearch, type workReadSchema, type workSearchSchema } from "@chrona/contracts/work";
import type { z } from "zod";
import type { WorkRecord, Task } from "@chrona/db";
import { sourceKey, workRevision, workWritesEnabled, type WorkActor } from "./access";
import { WorkResultError } from "../results/access";

export function summary(record: WorkRecord & { task: Pick<Task, "title" | "status"> }): WorkSummary {
  return { taskId: record.taskId, title: record.task.title, taskStatus: record.task.status, revision: workRevision(record.taskId, record.revision),
    context: workContextSchema.parse(record.context), signals: record.signals as WorkSignals, cancelled: record.cancelled,
    nextAction: record.nextAction, needsAttention: record.needsAttention, updatedAt: record.updatedAt.toISOString(), lastActorKey: record.lastActorKey };
}
export async function readWork(actor: WorkActor, input: z.infer<typeof workReadSchema>): Promise<WorkView> {
  const task = await db.task.findFirst({ where: { id: input.taskId, workspaceId: actor.workspaceId }, select: { id: true, taskExecutionMode: true, status: true } });
  if (!task) throw new WorkResultError("NOT_FOUND", "Task not found");
  const record = await db.workRecord.findUnique({ where: { taskId: task.id }, include: { task: { select: { title: true, status: true } }, sources: { orderBy: { createdAt: "asc" } } } });
  const canWrite = actor.canWrite && workWritesEnabled() && task.taskExecutionMode === "manual" && !["Completed", "Done", "Cancelled"].includes(task.status);
  const block = await db.workBlock.findFirst({ where: { taskId: task.id, status: "Scheduled" }, orderBy: { createdAt: "desc" } });
  const schedule = block ? { startsAt: block.scheduledStartAt.toISOString(), endsAt: block.scheduledEndAt.toISOString() } : null;
  if (!record) return { record: null, sources: [], entries: [], pendingChanges: [], total: 0, nextOffset: null, canWrite, canResolve: false, schedule };
  const allPending = await pendingChanges(task.id);
  const rows = await db.workEntry.findMany({ where: { taskId: task.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: input.offset, take: input.limit });
  const total = await db.workEntry.count({ where: { taskId: task.id } });
  const view: WorkView = { record: summary(record), sources: record.sources.map(s => ({ ...s.data as WorkSource, id: s.id, actorKey: s.actorKey, createdAt: s.createdAt.toISOString() })),
    entries: rows.map(entryView), pendingChanges: allPending.map(entryView), total, nextOffset: null, canWrite, canResolve: canWrite && actor.canResolve,
    schedule };
  while (Buffer.byteLength(JSON.stringify(view)) > 120_000 && view.entries.length > 1) view.entries.pop();
  view.nextOffset = input.offset + view.entries.length < total ? input.offset + view.entries.length : null;
  return view;
}
export function entryView(entry: { id: string; kind: string; actorKey: string; summary: string; createdAt: Date; details: unknown; resolvesId: string | null }): WorkEntry {
  return { ...entry, details: entry.details as Record<string, unknown>, createdAt: entry.createdAt.toISOString() };
}
export async function pendingChanges(taskId: string) {
  const resolved = await db.workEntry.findMany({ where: { taskId, resolvesId: { not: null } }, select: { resolvesId: true } });
  return db.workEntry.findMany({ where: { taskId, kind: "propose", id: { notIn: resolved.map(r => r.resolvesId!) } }, orderBy: { createdAt: "asc" }, take: 8 });
}
export async function searchWork(actor: WorkActor, input: z.infer<typeof workSearchSchema>): Promise<WorkSearch> {
  const where = { workspaceId: actor.workspaceId, ...(input.attentionOnly ? { needsAttention: true } : {}),
    task: { workspaceId: actor.workspaceId, ...(input.query ? { title: { contains: input.query } } : {}), ...(input.attentionOnly ? { status: { notIn: ["Completed", "Done", "Cancelled"] as Task["status"][] } } : {}) },
    ...(input.source ? { sources: { some: { sourceKey: sourceKey(input.source) } } } : {}) };
  const rows = await db.workRecord.findMany({ where, include: { task: { select: { title: true, status: true } } }, orderBy: [{ updatedAt: "desc" }, { taskId: "asc" }], skip: input.offset, take: input.limit });
  const total = await db.workRecord.count({ where });
  const items = rows.map(summary);
  while (Buffer.byteLength(JSON.stringify(items)) > 100_000 && items.length > 1) items.pop();
  return { items, total, nextOffset: input.offset + items.length < total ? input.offset + items.length : null };
}
