import { db } from "@/lib/db";
import { ensureWorkBlockTaskSession } from "@/modules/execution-runtime";
import { expandRecurrenceRule } from "@chrona/integrations";

const EXPANSION_LOOKAHEAD_DAYS = 90;
const EXPANSION_MAX_OCCURRENCES = 200;

type Deps = {
  now?: Date;
};

export async function runRecurringWorkBlockExpansionWorker(input: Deps = {}) {
  const now = input.now ?? new Date();
  const lookaheadDate = new Date(now.getTime() + EXPANSION_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const recurringTasks = await db.task.findMany({
    where: {
      recurrenceRule: { not: null },
      recurrenceAnchorStartAt: { not: null },
      recurrenceAnchorEndAt: { not: null },
      status: { notIn: ["Completed", "Done", "Cancelled"] },
    },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      executionRuntime: true,
      recurrenceRule: true,
      recurrenceAnchorStartAt: true,
      recurrenceAnchorEndAt: true,
      workBlocks: {
        where: { recurrenceKey: { not: null }, status: { not: "Cancelled" } },
        orderBy: { scheduledEndAt: "desc" },
        take: 1,
        select: { scheduledEndAt: true, recurrenceKey: true },
      },
    },
  });

  let created = 0;

  for (const task of recurringTasks) {
    if (!task.recurrenceRule || !task.recurrenceAnchorStartAt || !task.recurrenceAnchorEndAt) {
      continue;
    }

    const latestBlock = task.workBlocks[0];
    if (latestBlock && latestBlock.scheduledEndAt.getTime() >= lookaheadDate.getTime()) {
      continue;
    }

    const anchorStart = task.recurrenceAnchorStartAt;
    const durationMs = task.recurrenceAnchorEndAt.getTime() - anchorStart.getTime();
    const expansionFrom = latestBlock
      ? new Date(Math.max(latestBlock.scheduledEndAt.getTime(), now.getTime()))
      : now;
    const expansionTo = new Date(Math.max(lookaheadDate.getTime(), expansionFrom.getTime()));

    if (expansionTo <= expansionFrom) continue;

    const occurrences = expandRecurrenceRule(task.recurrenceRule, anchorStart, durationMs, {
      from: expansionFrom,
      to: expansionTo,
      maxOccurrences: EXPANSION_MAX_OCCURRENCES,
    });

    const existingKeys = new Set(
      (
        await db.workBlock.findMany({
          where: { taskId: task.id, recurrenceKey: { not: null } },
          select: { recurrenceKey: true },
        })
      ).map((block) => block.recurrenceKey),
    );

    for (const occurrence of occurrences) {
      const recurrenceKey = occurrence.startsAt.toISOString();
      if (existingKeys.has(recurrenceKey)) continue;

      const workBlock = await db.workBlock.upsert({
        where: {
          taskId_recurrenceKey: { taskId: task.id, recurrenceKey },
        },
        create: {
          workspaceId: task.workspaceId,
          taskId: task.id,
          recurrenceKey,
          title: task.title,
          status: "Scheduled",
          scheduledStartAt: occurrence.startsAt,
          scheduledEndAt: occurrence.endsAt,
          trigger: "scheduled",
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
        runtimeName: task.executionRuntime,
        workBlockId: workBlock.id,
        sessionId: workBlock.sessionId,
        label: `${task.title} · Work block session`,
      });
      created++;
    }
  }

  return created;
}
