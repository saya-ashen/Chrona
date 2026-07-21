import { db } from "@/lib/db";
import { taskTriggerDefinitionSchema } from "@chrona/contracts/api";
import { ensureWorkBlockTaskSession } from "@/modules/execution-runtime";
import { expandRecurrenceRule } from "@chrona/integrations";

const EXPANSION_LOOKAHEAD_DAYS = 90;
const EXPANSION_MAX_OCCURRENCES = 200;

type Deps = {
  now?: Date;
};

interface RecurringTask {
  id: string;
  workspaceId: string;
  title: string;
  executionRuntime: string;
  recurrenceRule: string | null;
  recurrenceAnchorStartAt: Date | null;
  recurrenceAnchorEndAt: Date | null;
  recurrenceWindowUntil: Date | null;
  triggers: Array<{ id: string; kind: string; config: unknown; version: number }>;
  workBlocks: Array<{ scheduledEndAt: Date; recurrenceKey: string | null }>;
}


function loadRecurringTasks() {
  return db.task.findMany({
    where: { definitionStatus: "Active", OR: [{ triggers: { some: { kind: "schedule", state: "Enabled" } } }, { recurrenceRule: { not: null } }] },
    select: { id: true, workspaceId: true, title: true, executionRuntime: true, recurrenceRule: true, recurrenceAnchorStartAt: true, recurrenceAnchorEndAt: true, recurrenceWindowUntil: true, triggers: { where: { kind: "schedule", state: "Enabled" } }, workBlocks: { where: { recurrenceKey: { not: null }, status: { not: "Cancelled" } }, orderBy: { scheduledEndAt: "desc" }, take: 1, select: { scheduledEndAt: true, recurrenceKey: true } } },
  });
}

async function ensureLegacyScheduleTrigger(task: RecurringTask) {
  if (task.triggers.length > 0 || !task.recurrenceRule || !task.recurrenceAnchorStartAt || !task.recurrenceAnchorEndAt) return;
  const durationMs = task.recurrenceAnchorEndAt.getTime() - task.recurrenceAnchorStartAt.getTime();
  const trigger = await db.taskTrigger.create({ data: { workspaceId: task.workspaceId, taskId: task.id, kind: "schedule", state: "Enabled", config: { mode: "recurring", rrule: task.recurrenceRule, anchorStartAt: task.recurrenceAnchorStartAt.toISOString(), timezone: "UTC", durationMs, windowUntil: task.recurrenceWindowUntil?.toISOString() } } });
  task.triggers.push(trigger);
}

async function materializeOccurrence(task: RecurringTask, trigger: RecurringTask["triggers"][number], occurrence: { startsAt: Date; endsAt: Date }, now: Date, existingKeys: Set<string | null>) {
  const workBlockRecurrenceKey = occurrence.startsAt.toISOString();
  if (existingKeys.has(workBlockRecurrenceKey)) return false;
  const workBlock = await db.workBlock.upsert({ where: { taskId_recurrenceKey: { taskId: task.id, recurrenceKey: workBlockRecurrenceKey } }, create: { workspaceId: task.workspaceId, taskId: task.id, recurrenceKey: workBlockRecurrenceKey, title: task.title, status: "Scheduled", scheduledStartAt: occurrence.startsAt, scheduledEndAt: occurrence.endsAt, trigger: "scheduled", occurrence: { create: { workspaceId: task.workspaceId, taskId: task.id, triggerId: trigger.id, occurrenceKey: `schedule:v${trigger.version}:${workBlockRecurrenceKey}`, triggerVersion: trigger.version, source: { kind: "trigger", triggerId: trigger.id }, status: occurrence.startsAt > now ? "Scheduled" : "Ready", eligibleAt: occurrence.startsAt } } }, update: { title: task.title, scheduledStartAt: occurrence.startsAt, scheduledEndAt: occurrence.endsAt }, select: { id: true, sessionId: true } });
  await ensureWorkBlockTaskSession({ taskId: task.id, taskTitle: task.title, runtimeName: task.executionRuntime, workBlockId: workBlock.id, sessionId: workBlock.sessionId, label: `${task.title} · Work block session` });
  return true;
}

async function expandTaskSchedule(task: RecurringTask, now: Date, lookaheadDate: Date) {
  await ensureLegacyScheduleTrigger(task);
  let created = 0;
  for (const trigger of task.triggers) {
    const definition = taskTriggerDefinitionSchema.parse({ kind: trigger.kind, config: trigger.config });
    if (definition.kind !== "schedule" || definition.config.mode !== "recurring") continue;
    const latestBlock = task.workBlocks[0];
    if (latestBlock.scheduledEndAt.getTime() >= lookaheadDate.getTime()) continue;
    const expansionFrom = new Date(Math.max(latestBlock.scheduledEndAt.getTime(), now.getTime()));
    const expansionTo = definition.config.windowUntil ? new Date(Math.min(lookaheadDate.getTime(), new Date(definition.config.windowUntil).getTime())) : lookaheadDate;
    if (expansionTo <= expansionFrom) continue;
    const occurrences = expandRecurrenceRule(definition.config.rrule, new Date(definition.config.anchorStartAt), definition.config.durationMs ?? 3_600_000, { from: expansionFrom, to: expansionTo, maxOccurrences: EXPANSION_MAX_OCCURRENCES });
    const existingKeys = new Set((await db.workBlock.findMany({ where: { taskId: task.id, recurrenceKey: { not: null } }, select: { recurrenceKey: true } })).map((block) => block.recurrenceKey));
    for (const occurrence of occurrences) created += Number(await materializeOccurrence(task, trigger, occurrence, now, existingKeys));
  }
  return created;
}

export async function runRecurringWorkBlockExpansionWorker(input: Deps = {}) {
  const now = input.now ?? new Date();
  const lookaheadDate = new Date(now.getTime() + EXPANSION_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const counts = await Promise.all((await loadRecurringTasks()).map((task) => expandTaskSchedule(task, now, lookaheadDate)));
  return counts.reduce((total, count) => total + count, 0);
}
