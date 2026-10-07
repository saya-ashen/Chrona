/* eslint-disable complexity -- Configuration merge preserves the explicit mode/schedule/provider policy matrix. */
import { db } from "@/lib/db";
import { expandRecurrenceRule } from "@chrona/integrations";
import type { CreateTaskInput, UpdateTaskInput } from "@chrona/contracts";
import { managementCreateSchema, type ManagementCreate, type ManagementUpdate } from "@chrona/contracts/api";
import { resolveTaskExecutionProviderSelection } from "../ai";
import { createTask } from "../tasks/create-task";
import { updateTask } from "../tasks/update-task";
import type { ManagementIdentity } from "./clients";
import { ManagementError } from "./errors";
import { assertRevision, configRevision, record, requireScopes, scopedTask } from "./reads";
import type { ManagementDeps } from "./types";

export function automation(input: ManagementCreate) {
  return { autoPlanGeneration: input.mode !== "todo", autoExecute: input.mode === "automatic",
    autoPlanGenerationTiming: input.timing?.plan ?? (input.schedule ? "at_start" : "immediate"),
    autoExecuteTiming: input.timing?.execution ?? (input.start === "now" ? "immediate" : "at_start") } as const;
}
export function requiresImmediatePlanning(input: ManagementCreate) {
  return input.mode !== "todo" && automation(input).autoPlanGenerationTiming === "immediate";
}
function validateRecurrence(input: Pick<ManagementCreate, "schedule" | "recurrence">) {
  if (!input.recurrence) return;
  if (input.recurrence.timezone !== "UTC") throw new ManagementError("VALIDATION_ERROR", "Recurrence currently requires UTC; wall-clock timezone recurrence is not yet supported");
  if (!input.schedule) throw new ManagementError("VALIDATION_ERROR", "Recurrence requires a schedule");
  const from = new Date(input.schedule.startsAt), duration = Date.parse(input.schedule.endsAt) - from.getTime();
  try { expandRecurrenceRule(input.recurrence.rule, from, duration, { from, to: new Date(from.getTime() + 180 * 86_400_000), maxOccurrences: 1 }); }
  catch { throw new ManagementError("VALIDATION_ERROR", "Invalid recurrence rule"); }
}
export async function validateCreation(client: ManagementIdentity, input: ManagementCreate) {
  requireScopes(client, ["tasks:write", ...(input.schedule || input.dueAt || input.recurrence ? ["schedule:write"] : []), ...(input.mode !== "todo" ? ["plans:write"] : []), ...(input.mode === "automatic" || input.executionConfig || input.aiClientId !== undefined ? ["executions:control"] : [])]);
  validateRecurrence(input);
  const selected = await resolveTaskExecutionProviderSelection({ aiClientId: input.aiClientId });
  if ((input.mode !== "todo" || input.aiClientId) && !selected) throw new ManagementError("PRECONDITION_FAILED", "Configure an enabled AI client before planning or execution");
  if (input.parentTaskId) await scopedTask(client, input.parentTaskId);
  if (input.goalId && !await db.goal.findFirst({ where: { id: input.goalId, workspaceId: client.workspaceId }, select: { id: true } })) throw new ManagementError("NOT_FOUND", "Goal not found");
  return { taskExecutionMode: input.taskExecutionMode ?? "ai", mode: input.mode, start: input.start ?? null, provider: selected ? { id: selected.clientId, name: selected.clientName, type: selected.providerName } : null, automation: automation(input), schedule: input.schedule ?? null, dueAt: input.dueAt ?? null, recurrence: input.recurrence ?? null };
}

/** Called inside the management command transaction; all core writes join it. */
export async function createManagedTask(client: ManagementIdentity, input: ManagementCreate, deps: ManagementDeps) {
  const desired = automation(input), immediate = requiresImmediatePlanning(input);
  const core: CreateTaskInput = {
    workspaceId: client.workspaceId, title: input.title, description: input.description, priority: input.priority,
    taskExecutionMode: input.taskExecutionMode,
    aiClientId: input.aiClientId, executionConfig: input.executionConfig, goalId: input.goalId, parentTaskId: input.parentTaskId,
    ...desired,
    // Persistent command owns immediate planning. Do not let scheduler race its
    // half-completed pipeline; restore requested automation after the plan commits.
    ...(immediate ? { autoPlanGeneration: false, autoExecute: false } : {}),
    recurrenceRule: input.recurrence?.rule,
    recurrenceAnchorStartAt: input.recurrence ? input.schedule!.startsAt : undefined,
    recurrenceAnchorEndAt: input.recurrence ? input.schedule!.endsAt : undefined,
  };
  const created = await createTask(core);
  if (input.schedule && !input.recurrence) await deps.schedule.apply({ taskId: created.taskId, dueAt: input.dueAt ? new Date(input.dueAt) : null, scheduledStartAt: new Date(input.schedule.startsAt), scheduledEndAt: new Date(input.schedule.endsAt), scheduleSource: "human" });
  else if (input.dueAt) await db.task.update({ where: { id: created.taskId }, data: { dueAt: new Date(input.dueAt) } });
  const workBlock = input.schedule ? await db.workBlock.findFirst({ where: { taskId: created.taskId, scheduledStartAt: new Date(input.schedule.startsAt) }, select: { id: true }, orderBy: { createdAt: "asc" } }) : null;
  const task = await scopedTask(client, created.taskId);
  return { taskId: task.id, workBlockId: workBlock?.id ?? null, immediate, stageData: { desiredAutomation: desired, expectedRevision: configRevision(task.configRevision), start: input.start ?? null } };
}

export async function prepareManagedUpdate(client: ManagementIdentity, input: ManagementUpdate) {
  requireScopes(client, ["tasks:write"]);
  const task = await scopedTask(client, input.taskId);
  assertRevision(task, input.expectedRevision);
  const patch = input.patch;
  if (task.taskExecutionMode === "manual" && (
    patch.executionConfig !== undefined ||
    (patch.aiClientId !== undefined && patch.aiClientId !== null) ||
    patch.mode !== undefined ||
    patch.start !== undefined ||
    patch.timing !== undefined ||
    patch.recurrence !== undefined
  )) {
    throw new ManagementError("VALIDATION_ERROR", "Manual tasks cannot configure AI providers, automation, execution settings, or recurrence");
  }
  if (patch.executionConfig || patch.aiClientId !== undefined) requireScopes(client, ["executions:control"]);
  if (patch.schedule !== undefined || patch.dueAt !== undefined || patch.recurrence !== undefined) requireScopes(client, ["schedule:write"]);
  if (patch.mode !== undefined || patch.timing !== undefined || patch.start !== undefined) {
    requireScopes(client, ["plans:write", ...(patch.mode === "automatic" || task.autoExecute || patch.start ? ["executions:control"] : [])]);
  }
  if (task.importedCalendarEvents.length && (patch.title !== undefined && patch.title !== task.title || patch.schedule !== undefined || patch.recurrence !== undefined)) throw new ManagementError("PRECONDITION_FAILED", "Calendar source owns title, schedule and recurrence; Chrona notes remain editable");
  const block = await db.workBlock.findFirst({ where: { taskId: task.id, status: { in: ["Scheduled", "Active"] } }, orderBy: { createdAt: "desc" } });
  if (patch.start === "now" && block && patch.schedule !== null) throw new ManagementError("PRECONDITION_FAILED", "Clear the existing schedule explicitly before starting now");
  if (patch.schedule === null && task.recurrenceRule && patch.recurrence !== null) throw new ManagementError("VALIDATION_ERROR", "Clear recurrence explicitly when clearing its schedule");
  if (patch.schedule === null && block?.status === "Active") throw new ManagementError("PRECONDITION_FAILED", "Stop the active work block before clearing its schedule");
  const currentSchedule = block ? { startsAt: block.scheduledStartAt.toISOString(), endsAt: block.scheduledEndAt.toISOString(), timezone: "UTC" } : undefined;
  const selectedSchedule = patch.schedule === null ? undefined : patch.schedule ?? currentSchedule;
  const hasAutomationRequest = patch.mode !== undefined || patch.start !== undefined || patch.timing !== undefined;
  const mode = hasAutomationRequest ? patch.mode ?? (task.autoExecute ? "automatic" : task.autoPlanGeneration ? "plan" : "todo") : "todo";
  const merged = managementCreateSchema.parse({
    requestId: input.requestId, title: patch.title ?? task.title, description: task.description ?? undefined, priority: patch.priority ?? task.priority,
    taskExecutionMode: task.taskExecutionMode,
    mode, start: mode === "automatic" ? patch.start ?? (selectedSchedule ? "scheduled" : "now") : undefined,
    timing: mode === "todo" || (mode === "automatic" && (patch.start === "now" || !selectedSchedule)) ? undefined : patch.timing ?? { plan: task.autoPlanGenerationTiming, ...(mode === "automatic" ? { execution: task.autoExecuteTiming } : {}) },
    aiClientId: task.taskExecutionMode === "manual" ? undefined : patch.aiClientId === undefined ? task.aiClientId : patch.aiClientId,
    schedule: patch.start === "now" ? undefined : selectedSchedule,
    recurrence: patch.recurrence === null ? undefined : patch.recurrence ?? (task.recurrenceRule ? { rule: task.recurrenceRule, timezone: "UTC" } : undefined),
    dueAt: patch.dueAt === undefined ? task.dueAt?.toISOString() : patch.dueAt,
  });
  // Metadata-only edits must not depend on provider health or acquire automation permissions.
  if (hasAutomationRequest || patch.aiClientId !== undefined) {
    const selected = await resolveTaskExecutionProviderSelection({ aiClientId: merged.aiClientId });
    if (merged.mode !== "todo" && !selected) throw new ManagementError("PRECONDITION_FAILED", "An enabled AI client is required for automation");
  }
  if (patch.recurrence || patch.schedule && task.recurrenceRule) validateRecurrence(merged);
  let description: string | null | undefined;
  if (patch.description?.mode === "clear") description = null;
  else if (patch.description?.mode === "replace") description = patch.description.text;
  else if (patch.description?.mode === "append") description = task.description ? `${task.description}\n\n${patch.description.text}` : patch.description.text;
  if ((description?.length ?? 0) > 10_000) throw new ManagementError("VALIDATION_ERROR", "Combined description exceeds 10000 characters");
  const desired = automation(merged), immediate = hasAutomationRequest && requiresImmediatePlanning(merged);
  const core: UpdateTaskInput = {
    title: patch.title, description, priority: patch.priority, aiClientId: patch.aiClientId, taskId: task.id,
    executionConfig: patch.executionConfig ? { ...record(task.executionConfig), ...patch.executionConfig } : undefined,
    ...(hasAutomationRequest ? { ...desired, ...(immediate ? { autoPlanGeneration: false, autoExecute: false } : {}) } : {}),
    ...(patch.recurrence !== undefined || patch.schedule && task.recurrenceRule ? { recurrenceRule: merged.recurrence?.rule ?? null, recurrenceAnchorStartAt: merged.recurrence ? merged.schedule!.startsAt : null, recurrenceAnchorEndAt: merged.recurrence ? merged.schedule!.endsAt : null } : {}),
  };
  return { task, merged, core, immediate, desired };
}
export async function updateManagedTask(client: ManagementIdentity, input: ManagementUpdate, deps: ManagementDeps) {
  const prepared = await prepareManagedUpdate(client, input);
  const { patch } = input;
  const coreEntries: Array<[string, unknown]> = Object.entries(prepared.core);
  const coreChanged = coreEntries.some(([key, value]) => key !== "taskId" && value !== undefined && JSON.stringify(value) !== JSON.stringify(prepared.task[key as keyof typeof prepared.task]));
  if (coreChanged) await updateTask(prepared.core, { deferAutomation: true });
  if (patch.schedule === null) {
    await deps.schedule.clear({ taskId: input.taskId });
    // Clearing a window does not implicitly clear the independent deadline.
    await db.task.update({ where: { id: input.taskId }, data: { dueAt: patch.dueAt === undefined ? prepared.task.dueAt : patch.dueAt ? new Date(patch.dueAt) : null } });
  } else if (patch.schedule && !prepared.merged.recurrence) {
    await deps.schedule.apply({ taskId: input.taskId, dueAt: patch.dueAt === undefined ? prepared.task.dueAt : patch.dueAt ? new Date(patch.dueAt) : null, scheduledStartAt: new Date(patch.schedule.startsAt), scheduledEndAt: new Date(patch.schedule.endsAt), scheduleSource: "human" });
  } else if (patch.dueAt !== undefined) await db.task.update({ where: { id: input.taskId }, data: { dueAt: patch.dueAt ? new Date(patch.dueAt) : null } });
  const task = await scopedTask(client, input.taskId);
  const workBlock = await db.workBlock.findFirst({ where: { taskId: task.id, status: "Scheduled" }, orderBy: { scheduledStartAt: "asc" }, select: { id: true } });
  return { taskId: task.id, workBlockId: prepared.merged.start === "now" ? null : workBlock?.id ?? null, immediate: prepared.immediate,
    outcome: task.configRevision === prepared.task.configRevision && !prepared.immediate ? "noop" : "updated",
    stageData: { desiredAutomation: prepared.desired, expectedRevision: configRevision(task.configRevision), start: prepared.merged.start ?? null } };
}
