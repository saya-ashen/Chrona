import { db, type WorkBlock } from "@chrona/db";
import type { WorkCapture, WorkContext, WorkSourceInput } from "@chrona/contracts/work";
import { WorkResultError } from "../results/access";
import { assertManualWorkTask, conflict, type WorkActor } from "./access";
/** Native calendar IDs are validated references, never a request to fetch a URL or
 * reparent an imported event. Managed/automatic tasks cannot be enrolled here. */
export async function captureTarget(actor: WorkActor, input: WorkCapture) {
  const nativeIds = [...new Set(input.sources.flatMap(source => source.calendarEventId ? [source.calendarEventId] : []))];
  const native = await db.importedCalendarEvent.findMany({ where: { id: { in: nativeIds }, workspaceId: actor.workspaceId }, select: { id: true, taskId: true } });
  if (native.length !== nativeIds.length) throw new WorkResultError("NOT_FOUND", "Calendar reference not found in this workspace");
  if (native.some(event => !event.taskId)) throw new WorkResultError("PRECONDITION_FAILED", "Calendar source must establish its task association first");
  const targets = [...new Set([...(input.taskId ? [input.taskId] : []), ...native.map(event => event.taskId!)])];
  if (targets.length > 1) throw conflict("Calendar references and requested task do not identify the same work");
  return targets[0] ?? null;
}
function adoptionContext(context: WorkContext, blocks: Pick<WorkBlock, "status" | "scheduledStartAt" | "scheduledEndAt">[]): WorkContext {
  if (blocks.length > 1 || blocks.some(block => block.status === "Active")) throw new WorkResultError("PRECONDITION_FAILED", "Reconcile existing work blocks before enrollment");
  const block = blocks.at(0), window = context.window;
  if (window && (!block || block.scheduledStartAt.getTime() !== Date.parse(window.startsAt) || block.scheduledEndAt.getTime() !== Date.parse(window.endsAt))) throw conflict("Enrollment must preserve the existing schedule");
  return block && !window ? { ...context, window: { startsAt: block.scheduledStartAt.toISOString(), endsAt: block.scheduledEndAt.toISOString(), timezone: "UTC" } } : context;
}
export async function validateAdoption(actor: WorkActor, taskId: string, input: WorkCapture): Promise<{ context: WorkContext; nativeSources: WorkSourceInput[] }> {
  const task = await db.task.findFirst({ where: { id: taskId, workspaceId: actor.workspaceId }, select: {
    id: true, title: true, taskExecutionMode: true, autoPlanGeneration: true, autoExecute: true, recurrenceRule: true, status: true,
    importedCalendarEvents: { select: { id: true, calendarSourceId: true, title: true } },
    workBlocks: { where: { status: { in: ["Scheduled", "Active"] } }, select: { status: true, scheduledStartAt: true, scheduledEndAt: true } },
  } });
  if (!task) throw new WorkResultError("NOT_FOUND", "Task not found");
  assertManualWorkTask(task);
  if (task.recurrenceRule) throw new WorkResultError("PRECONDITION_FAILED", "Recurring tasks require occurrence-specific recording");
  if (task.title !== input.title) throw conflict("Task title changed; read the current task before enrollment");
  const context = adoptionContext(input.context, task.workBlocks);
  if (task.importedCalendarEvents.length > 12) throw new WorkResultError("PRECONDITION_FAILED", "Calendar series requires occurrence-specific recording");
  return { context, nativeSources: task.importedCalendarEvents.map(event => ({ kind: "calendar", system: "chrona-calendar", account: event.calendarSourceId, externalId: event.id, calendarEventId: event.id, label: event.title.slice(0, 200) || input.title.slice(0, 200) })) };
}
export async function assertCalendarReference(actor: WorkActor, taskId: string, source: WorkSourceInput) {
  if (!source.calendarEventId) return;
  if (source.kind !== "calendar") throw new WorkResultError("VALIDATION_ERROR", "Native event references require calendar sources");
  const event = await db.importedCalendarEvent.findFirst({ where: { id: source.calendarEventId, workspaceId: actor.workspaceId }, select: { taskId: true } });
  if (!event) throw new WorkResultError("NOT_FOUND", "Calendar reference not found");
  if (event.taskId !== taskId) throw conflict("Use the calendar event's existing task; do not create a parallel association");
}
