import { db } from "@/lib/db";
import { taskTriggerDefinitionSchema } from "@chrona/contracts/api";
import { ensureWorkBlockTaskSession } from "@/modules/execution-runtime";
import { expandRecurrenceRule } from "@chrona/integrations";
import {
  resolveTaskExecutionProviderSelection,
  unresolvedTaskProviderName,
  type TaskExecutionProviderSelection,
} from "@/modules/ai";
import {
  assertSchedulerWorkOwnership,
  type SchedulerWorkContext,
  withSchedulerWorkOwnership,
} from "./scheduler-lease-repository";

const EXPANSION_LOOKAHEAD_DAYS = 90;
const EXPANSION_MAX_OCCURRENCES = 200;

type Deps = {
  now?: Date;
  workContext?: SchedulerWorkContext;
};

interface RecurringTask {
  id: string;
  workspaceId: string;
  title: string;
  aiClientId: string | null;
  triggers: Array<{ id: string; kind: string; config: unknown; version: number }>;
}


function loadRecurringTasks() {
  return db.task.findMany({
    where: { definitionStatus: "Active", triggers: { some: { kind: "schedule", state: "Enabled" } } },
    select: { id: true, workspaceId: true, title: true, aiClientId: true, triggers: { where: { kind: "schedule", state: "Enabled" } } },
  });
}


async function materializeOccurrence(
  task: RecurringTask,
  trigger: RecurringTask["triggers"][number],
  occurrence: { startsAt: Date; endsAt: Date },
  now: Date,
  existingKeys: Set<string | null>,
  provider: TaskExecutionProviderSelection | null,
  workContext?: SchedulerWorkContext,
) {
  const occurrenceKey = `schedule:v${trigger.version}:${occurrence.startsAt.toISOString()}`;
  if (existingKeys.has(occurrenceKey)) return false;
  await withSchedulerWorkOwnership(workContext, async (tx) => {
    const workBlock = await tx.workBlock.upsert({
      where: { taskId_recurrenceKey: { taskId: task.id, recurrenceKey: occurrenceKey } },
      create: {
        workspaceId: task.workspaceId,
        taskId: task.id,
        recurrenceKey: occurrenceKey,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: occurrence.startsAt,
        scheduledEndAt: occurrence.endsAt,
        trigger: "scheduled",
        occurrence: {
          create: {
            workspaceId: task.workspaceId,
            taskId: task.id,
            triggerId: trigger.id,
            occurrenceKey,
            triggerVersion: trigger.version,
            source: { kind: "trigger", triggerId: trigger.id },
            status: occurrence.startsAt > now ? "Scheduled" : "Ready",
            eligibleAt: occurrence.startsAt,
          },
        },
      },
      update: {
        title: task.title,
        scheduledStartAt: occurrence.startsAt,
        scheduledEndAt: occurrence.endsAt,
      },
      select: { id: true, sessionId: true },
    });
    await ensureWorkBlockTaskSession({
      taskId: task.id,
      taskTitle: task.title,
      runtimeName: provider?.providerName ?? unresolvedTaskProviderName(),
      providerClientId: provider?.clientId,
      providerName: provider?.providerName,
      providerConfigFingerprint: provider?.configFingerprint,
      workBlockId: workBlock.id,
      sessionId: workBlock.sessionId,
      label: `${task.title} · Work block session`,
    }, tx);
  });
  await assertSchedulerWorkOwnership(workContext);
  return true;
}

async function expandTaskSchedule(task: RecurringTask, now: Date, lookaheadDate: Date, workContext?: SchedulerWorkContext) {
  let created = 0;
  const provider = await resolveTaskExecutionProviderSelection({
    aiClientId: task.aiClientId,
  });
  for (const trigger of task.triggers) {
    const definition = taskTriggerDefinitionSchema.parse({ kind: trigger.kind, config: trigger.config });
    if (definition.kind !== "schedule" || definition.config.mode !== "recurring") continue;
    const anchorStartAt = new Date(definition.config.anchorStartAt);
    const latestBlock = await db.workBlock.findFirst({
      where: { taskId: task.id, recurrenceKey: { startsWith: `schedule:v${trigger.version}:` }, status: { not: "Cancelled" } },
      orderBy: { scheduledEndAt: "desc" },
      select: { scheduledEndAt: true },
    });
    if (latestBlock?.scheduledEndAt && latestBlock.scheduledEndAt.getTime() >= lookaheadDate.getTime()) continue;
    const expansionFrom = new Date(Math.max(latestBlock?.scheduledEndAt.getTime() ?? anchorStartAt.getTime(), now.getTime()));
    const expansionTo = definition.config.windowUntil ? new Date(Math.min(lookaheadDate.getTime(), new Date(definition.config.windowUntil).getTime())) : lookaheadDate;
    if (expansionTo <= expansionFrom) continue;
    const occurrences = expandRecurrenceRule(definition.config.rrule, anchorStartAt, definition.config.durationMs ?? 3_600_000, { from: expansionFrom, to: expansionTo, maxOccurrences: EXPANSION_MAX_OCCURRENCES });
    await assertSchedulerWorkOwnership(workContext);
    const existingKeys = new Set((await db.workBlock.findMany({ where: { taskId: task.id, recurrenceKey: { startsWith: `schedule:v${trigger.version}:` }, status: { not: "Cancelled" } }, select: { recurrenceKey: true } })).map((block) => block.recurrenceKey));
    await assertSchedulerWorkOwnership(workContext);
    for (const occurrence of occurrences) {
      await assertSchedulerWorkOwnership(workContext);
      created += Number(await materializeOccurrence(task, trigger, occurrence, now, existingKeys, provider, workContext));
    }
  }
  return created;
}

export async function runRecurringWorkBlockExpansionWorker(input: Deps = {}) {
  const now = input.now ?? new Date();
  const lookaheadDate = new Date(now.getTime() + EXPANSION_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  await assertSchedulerWorkOwnership(input.workContext);
  const tasks = await loadRecurringTasks();
  await assertSchedulerWorkOwnership(input.workContext);
  const counts = await Promise.all(tasks.map((task) =>
    expandTaskSchedule(task, now, lookaheadDate, input.workContext),
  ));
  return counts.reduce((total, count) => total + count, 0);
}
