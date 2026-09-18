import { db, type Task } from "@chrona/db";
import { createHash } from "node:crypto";
import type { WorkSourceInput } from "@chrona/contracts/work";
import { WorkResultError } from "../results/access";

export type WorkActor = { workspaceId: string; actorKey: string; canWrite: boolean; canResolve: boolean };
export type WorkPorts = { authorize: (write: boolean) => Promise<WorkActor> };
export const workRevision = (taskId: string, revision: number) => `work-v1:${taskId}:${revision}`;
export const workWritesEnabled = () => process.env.CHRONA_WORK_WRITES_ENABLED === "true";
export function workCapabilities(scopes: readonly string[]) {
  const canRead = scopes.includes("tasks:read") && scopes.includes("work:read");
  return { contractVersion: 1, canRead, canWrite: canRead && scopes.includes("work:write") && workWritesEnabled(),
    canResolve: false, writesEnabled: workWritesEnabled(), manualCaptureOnly: true, externalSideEffects: false, notifications: false };
}
export function sourceKey(source: Pick<WorkSourceInput, "kind" | "system" | "account" | "externalId" | "calendarEventId">) {
  const identity = source.calendarEventId ? ["chrona-calendar-event", source.calendarEventId] : [source.kind, source.system, source.account, source.externalId];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
export async function authorized(ports: WorkPorts, write: boolean) {
  const actor = await ports.authorize(write);
  if (write && (!actor.canWrite || !workWritesEnabled())) throw new WorkResultError("FORBIDDEN", "Work recording writes are unavailable");
  return actor;
}
export async function scopedWork(actor: WorkActor, taskId: string) {
  const record = await db.workRecord.findFirst({ where: { taskId, workspaceId: actor.workspaceId, task: { workspaceId: actor.workspaceId } }, include: { task: true } });
  if (!record) throw new WorkResultError("NOT_FOUND", "Work record not found");
  return record;
}
export function assertManualWorkTask(task: Pick<Task, "taskExecutionMode" | "autoPlanGeneration" | "autoExecute" | "status">) {
  if (task.taskExecutionMode !== "manual" || task.autoPlanGeneration || task.autoExecute || ["Completed", "Done", "Cancelled"].includes(task.status)) {
    throw new WorkResultError("PRECONDITION_FAILED", "Only open, non-automatic manual work can be recorded; no execution mode is changed");
  }
}
export function assertOpen(record: Awaited<ReturnType<typeof scopedWork>>) { assertManualWorkTask(record.task); }
export function conflict(message = "Work changed; refresh, compare and reconcile") {
  return new WorkResultError("REVISION_CONFLICT", message);
}
