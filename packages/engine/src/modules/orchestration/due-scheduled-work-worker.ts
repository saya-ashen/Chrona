import { db } from "@/lib/db";
import {
  autoStartScheduledPlanTasks,
  type AutoStartScheduledPlanResult,
} from "@/modules/scheduling/auto-start-scheduled-plan";
import { assertSchedulerWorkOwnership, type SchedulerWorkContext, withSchedulerWorkOwnership } from "./scheduler-lease-repository";
import { recordOrchestratorEvent } from "./scheduler-events";

type DueScheduledWorkWorkerDeps = {
  startDueWork?: typeof autoStartScheduledPlanTasks;
  recordEvent?: (
    input: Parameters<typeof recordOrchestratorEvent>[0],
    tx?: Parameters<typeof recordOrchestratorEvent>[1],
  ) => PromiseLike<unknown> | unknown;
};

export async function runDueScheduledWorkWorker(
  input: {
    now?: Date;
    workContext?: SchedulerWorkContext;
    deps?: DueScheduledWorkWorkerDeps;
  } = {},
): Promise<AutoStartScheduledPlanResult> {
  const startDueWork = input.deps?.startDueWork ?? autoStartScheduledPlanTasks;
  const recordEvent = input.deps?.recordEvent ?? recordOrchestratorEvent;
  await assertSchedulerWorkOwnership(input.workContext);
  const result = await startDueWork({ now: input.now, workContext: input.workContext });
  const taskIds = [...result.started, ...result.skipped, ...result.failed].map(
    (entry) => entry.taskId,
  );
  const tasks = await db.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, workspaceId: true },
  });
  await assertSchedulerWorkOwnership(input.workContext);
  const workspaceByTaskId = new Map(
    tasks.map((task) => [task.id, task.workspaceId]),
  );

  for (const entry of result.started) {
    const workspaceId = workspaceByTaskId.get(entry.taskId);
    if (!workspaceId) continue;
    await withSchedulerWorkOwnership(input.workContext, async (tx) => {
      await recordEvent({
        workspaceId,
        taskId: entry.taskId,
        eventType: "scheduler.start",
        payload: { workBlockId: entry.workBlockId, runId: entry.runId },
      }, tx);
    });
  }

  for (const entry of result.skipped) {
    if (!entry.actionable) continue;
    const workspaceId = workspaceByTaskId.get(entry.taskId);
    if (!workspaceId) continue;
    await withSchedulerWorkOwnership(input.workContext, async (tx) => {
      await recordEvent({
        workspaceId,
        taskId: entry.taskId,
        eventType: "scheduler.skip",
        reason: entry.reason,
        payload: {
          workBlockId: entry.workBlockId,
          reasonCode: entry.reasonCode,
          actionable: true,
        },
      }, tx);
    });
  }

  for (const entry of result.failed) {
    const workspaceId = workspaceByTaskId.get(entry.taskId);
    if (!workspaceId) continue;
    await withSchedulerWorkOwnership(input.workContext, async (tx) => {
      await recordEvent({
        workspaceId,
        taskId: entry.taskId,
        eventType: "scheduler.fail",
        reason: entry.error,
        payload: { workBlockId: entry.workBlockId },
      }, tx);
    });
  }

  return result;
}
