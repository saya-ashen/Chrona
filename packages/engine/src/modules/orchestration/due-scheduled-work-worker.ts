import { db } from "@/lib/db";
import {
  autoStartScheduledPlanTasks,
  type AutoStartScheduledPlanResult,
} from "@/modules/scheduling/auto-start-scheduled-plan";
import { recordOrchestratorEvent } from "./scheduler-events";

type DueScheduledWorkWorkerDeps = {
  startDueWork?: typeof autoStartScheduledPlanTasks;
  recordEvent?: typeof recordOrchestratorEvent;
};

export async function runDueScheduledWorkWorker(
  input: {
    now?: Date;
    deps?: DueScheduledWorkWorkerDeps;
  } = {},
): Promise<AutoStartScheduledPlanResult> {
  const startDueWork = input.deps?.startDueWork ?? autoStartScheduledPlanTasks;
  const recordEvent = input.deps?.recordEvent ?? recordOrchestratorEvent;
  const result = await startDueWork({ now: input.now });
  const taskIds = [...result.started, ...result.skipped, ...result.failed].map(
    (entry) => entry.taskId,
  );
  const tasks = await db.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, workspaceId: true },
  });
  const workspaceByTaskId = new Map(
    tasks.map((task) => [task.id, task.workspaceId]),
  );

  for (const entry of result.started) {
    const workspaceId = workspaceByTaskId.get(entry.taskId);
    if (!workspaceId) continue;
    await recordEvent({
      workspaceId,
      taskId: entry.taskId,
      eventType: "scheduler.start",
      payload: { workBlockId: entry.workBlockId, runId: entry.runId },
    });
  }

  for (const entry of result.skipped) {
    if (!entry.actionable) continue;
    const workspaceId = workspaceByTaskId.get(entry.taskId);
    if (!workspaceId) continue;
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
    });
  }

  for (const entry of result.failed) {
    const workspaceId = workspaceByTaskId.get(entry.taskId);
    if (!workspaceId) continue;
    await recordEvent({
      workspaceId,
      taskId: entry.taskId,
      eventType: "scheduler.fail",
      reason: entry.error,
      payload: { workBlockId: entry.workBlockId },
    });
  }

  return result;
}
