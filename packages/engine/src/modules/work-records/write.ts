import { db, type Prisma } from "@chrona/db";
import { workContextSchema, workChangeSchema, type WorkCapture, type WorkUpdate, type WorkSourceInput, type WorkSignals } from "@chrona/contracts/work";
import { createTask } from "../tasks/create-task";
import { createTaskScheduleService } from "../../services/task-schedule.service";
import { WorkResultError } from "../results/access";
import { sourceKey, scopedWork, assertOpen, conflict, workRevision, type WorkActor } from "./access";
import { pendingChanges } from "./read";
import { assertCalendarReference, captureTarget, validateAdoption } from "./capture-target";

export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const schedule = createTaskScheduleService();
export async function addSource(actor: WorkActor, taskId: string, source: WorkSourceInput) {
  await assertCalendarReference(actor, taskId, source);
  if (Buffer.byteLength(JSON.stringify(source)) > 3072) throw new WorkResultError("VALIDATION_ERROR", "Source metadata exceeds its budget");
  const key = sourceKey(source);
  const existing = await db.workSource.findUnique({ where: { workspaceId_sourceKey: { workspaceId: actor.workspaceId, sourceKey: key } } });
  if (existing) {
    if (existing.taskId !== taskId) throw conflict("This source already belongs to another work record; do not merge silently");
    return { source: existing, added: false };
  }
  if (await db.workSource.count({ where: { taskId } }) >= 12) throw new WorkResultError("PRECONDITION_FAILED", "Source limit reached");
  return { source: await db.workSource.create({ data: { taskId, workspaceId: actor.workspaceId, sourceKey: key, data: json(source), actorKey: actor.actorKey } }), added: true };
}
export async function captureWork(actor: WorkActor, input: WorkCapture) {
  if (Buffer.byteLength(JSON.stringify(input.context)) > 12 * 1024) throw new WorkResultError("VALIDATION_ERROR", "Work context exceeds its metadata budget");
  const targetId = await captureTarget(actor, input);
  const matches = await db.workSource.findMany({ where: { workspaceId: actor.workspaceId, sourceKey: { in: input.sources.map(sourceKey) } }, select: { taskId: true } });
  const enrolled = targetId ? await db.workRecord.findFirst({ where: { taskId: targetId, workspaceId: actor.workspaceId }, select: { taskId: true } }) : null;
  const ids = [...new Set([...matches.map(s => s.taskId), ...(enrolled ? [enrolled.taskId] : [])])];
  if (targetId && ids.some(id => id !== targetId)) throw conflict("The source belongs to a different task");
  if (ids.length > 1) throw conflict("Sources refer to different work records; explicit reconciliation is required");
  if (ids.length) {
    const record = await scopedWork(actor, ids[0]);
    return { taskId: record.taskId, revision: workRevision(record.taskId, record.revision), outcome: "existing", executionStarted: false as const, taskStatusChanged: false as const };
  }
  if (await db.workRecord.count({ where: { workspaceId: actor.workspaceId } }) >= 2000) throw new WorkResultError("PRECONDITION_FAILED", "Work record limit reached");
  return initializeRecord(actor, input, targetId);
}
async function initializeRecord(actor: WorkActor, input: WorkCapture, targetId: string | null) {
  const adopted = targetId ? await validateAdoption(actor, targetId, input) : { context: input.context, nativeSources: [] };
  const task = targetId ? { taskId: targetId } : await createTask({ workspaceId: actor.workspaceId, title: input.title, description: input.description, taskExecutionMode: "manual", autoPlanGeneration: false, autoExecute: false });
  const record = await db.workRecord.create({ data: { taskId: task.taskId, workspaceId: actor.workspaceId, context: json(adopted.context), signals: json({}), nextAction: input.nextAction, lastActorKey: actor.actorKey } });
  for (const source of [...adopted.nativeSources, ...input.sources]) await addSource(actor, task.taskId, source);
  if (!targetId && input.context.window) await schedule.apply({ taskId: task.taskId, dueAt: null, scheduledStartAt: new Date(input.context.window.startsAt), scheduledEndAt: new Date(input.context.window.endsAt), scheduleSource: "human" });
  await db.workEntry.create({ data: { taskId: task.taskId, kind: "capture", actorKey: actor.actorKey, summary: input.title, details: json({ context: adopted.context, adoptedExistingTask: !!targetId }) } });
  return { taskId: task.taskId, revision: workRevision(task.taskId, record.revision), outcome: targetId ? "adopted" : "created", executionStarted: false as const, taskStatusChanged: false as const };
}
async function assertScheduleOwned(record: Awaited<ReturnType<typeof scopedWork>>) {
  if (await db.importedCalendarEvent.count({ where: { taskId: record.taskId } })) throw new WorkResultError("PRECONDITION_FAILED", "Calendar source owns this schedule; reconcile at the source");
  const blocks = await db.workBlock.findMany({ where: { taskId: record.taskId, status: { in: ["Active", "Scheduled"] } } });
  const window = workContextSchema.parse(record.context).window;
  if (blocks.some(b => b.status === "Active") || blocks.length !== (window && !record.cancelled ? 1 : 0)) throw conflict("Schedule changed outside this record; reconcile before applying");
  if (blocks[0] && (blocks[0].scheduledStartAt.getTime() !== Date.parse(window!.startsAt) || blocks[0].scheduledEndAt.getTime() !== Date.parse(window!.endsAt))) throw conflict("Schedule and record disagree; reconcile before applying");
}
async function resolveChange(actor: WorkActor, record: Awaited<ReturnType<typeof scopedWork>>, action: Extract<WorkUpdate["action"], { type: "resolve" }>) {
  if (!actor.canResolve) throw new WorkResultError("FORBIDDEN", "Owner confirmation is required; reports are not authorization");
  const entry = await db.workEntry.findFirst({ where: { id: action.entryId, taskId: record.taskId, kind: "propose" } });
  if (!entry || await db.workEntry.findUnique({ where: { resolvesId: action.entryId } })) throw conflict("Change is unavailable or already resolved");
  const details = entry.details as { change: unknown; baseRevision: number };
  if (action.decision === "apply") {
    if (details.baseRevision !== record.revision) throw conflict("The proposal predates another update; dismiss it and propose against current context");
    if (record.cancelled) throw new WorkResultError("PRECONDITION_FAILED", "This meeting has already been cancelled");
    await assertScheduleOwned(record);
    const change = workChangeSchema.parse(details.change), context = workContextSchema.parse(record.context);
    if (change.type === "reschedule") {
      context.window = change.window;
      await schedule.apply({ taskId: record.taskId, dueAt: record.task.dueAt, scheduledStartAt: new Date(change.window.startsAt), scheduledEndAt: new Date(change.window.endsAt), scheduleSource: "human" });
      await db.workRecord.update({ where: { taskId: record.taskId }, data: { context: json(context) } });
    } else {
      await schedule.clear({ taskId: record.taskId });
      await db.task.update({ where: { id: record.taskId }, data: { dueAt: record.task.dueAt } });
      await db.workRecord.update({ where: { taskId: record.taskId }, data: { cancelled: true } });
    }
  }
  return { summary: action.reason, details: json({ decision: action.decision, proposalId: action.entryId, externalSideEffects: false }), resolvesId: action.entryId };
}
async function prepareReport(actor: WorkActor, record: Awaited<ReturnType<typeof scopedWork>>, action: Extract<WorkUpdate["action"], { type: "report" }>) {
  if (action.sourceId && !await db.workSource.findFirst({ where: { id: action.sourceId, taskId: record.taskId } })) throw new WorkResultError("NOT_FOUND", "Source is not associated with this work");
  const signals = record.signals as WorkSignals;
  if (action.signal) signals[action.signal.dimension] = { value: action.signal.value, actorKey: actor.actorKey, recordedAt: new Date().toISOString() };
  const unresolved = Object.values(signals).some(signal => ["unknown", "failed", "pending"].includes(signal.value));
  const patch: Prisma.WorkRecordUpdateManyMutationInput = { signals: json(signals), needsAttention: unresolved || (action.needsAttention ?? record.needsAttention), nextAction: action.nextAction };
  const { summary: reportedSummary, ...details } = action;
  return { patch, entry: { summary: reportedSummary, details: json({ ...details, attribution: "source_reported", grantsPermission: false }) } };
}
export async function updateWork(actor: WorkActor, input: WorkUpdate) {
  const record = await scopedWork(actor, input.taskId); assertOpen(record);
  if (workRevision(record.taskId, record.revision) !== input.expectedRevision) throw conflict();
  if (await db.workEntry.count({ where: { taskId: input.taskId } }) >= 2000) throw new WorkResultError("PRECONDITION_FAILED", "Work history limit reached");
  const action = input.action;
  let entry: { summary: string; details: Prisma.InputJsonValue; resolvesId?: string };
  const patch: Prisma.WorkRecordUpdateManyMutationInput = { revision: { increment: 1 }, lastActorKey: actor.actorKey };
  if (action.type === "source") {
    const linked = await addSource(actor, input.taskId, action.source);
    if (!linked.added) return { taskId: input.taskId, revision: input.expectedRevision, outcome: "source_already_linked", executionStarted: false as const, taskStatusChanged: false as const };
    entry = { summary: action.source.label, details: json({ sourceId: linked.source.id }) };
  } else if (action.type === "report") {
    const report = await prepareReport(actor, record, action);
    Object.assign(patch, report.patch); entry = report.entry;
  } else if (action.type === "propose") {
    if (workContextSchema.parse(record.context).kind !== "meeting") throw new WorkResultError("PRECONDITION_FAILED", "Meeting changes require a meeting record");
    if (record.cancelled) throw new WorkResultError("PRECONDITION_FAILED", "Meeting is cancelled");
    if ((await pendingChanges(input.taskId)).length >= 8) throw new WorkResultError("PRECONDITION_FAILED", "Resolve pending changes before adding more");
    patch.needsAttention = true;
    entry = { summary: action.change.reason, details: json({ change: action.change, baseRevision: record.revision + 1 }) };
  } else {
    entry = await resolveChange(actor, record, action);
    patch.needsAttention = true; // External calendar/participants still require explicit follow-through.
  }
  await db.workEntry.create({ data: { taskId: input.taskId, kind: action.type, actorKey: actor.actorKey, ...entry } });
  if ((await pendingChanges(input.taskId)).length) patch.needsAttention = true;
  const changed = await db.workRecord.updateMany({ where: { taskId: input.taskId, revision: record.revision }, data: patch });
  if (changed.count !== 1) throw conflict();
  return { taskId: input.taskId, revision: workRevision(input.taskId, record.revision + 1), outcome: action.type, executionStarted: false as const, taskStatusChanged: false as const };
}
