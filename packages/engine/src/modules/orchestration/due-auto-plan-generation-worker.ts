import { db } from "@/lib/db";
import { autoGenerateScheduledPlanTasks, type AutoGenerateScheduledPlanResult } from "@/modules/scheduling/auto-generate-scheduled-plan";
import { recordOrchestratorEvent } from "./scheduler-events";
import { assertSchedulerWorkOwnership, type SchedulerWorkContext, withSchedulerWorkOwnership } from "./scheduler-lease-repository";

type DueAutoPlanGenerationWorkerDeps = {
  generateDuePlans?: typeof autoGenerateScheduledPlanTasks;
  recordEvent?: typeof recordOrchestratorEvent;
};

export async function runDueAutoPlanGenerationWorker(input: {
  now?: Date;
  workContext?: SchedulerWorkContext;
  deps?: DueAutoPlanGenerationWorkerDeps;
} = {}): Promise<AutoGenerateScheduledPlanResult> {
  const generateDuePlans = input.deps?.generateDuePlans ?? autoGenerateScheduledPlanTasks;
  const recordEvent = input.deps?.recordEvent ?? recordOrchestratorEvent;
  await assertSchedulerWorkOwnership(input.workContext);
  const result = await generateDuePlans({ now: input.now, workContext: input.workContext });

  // Only `triggered` is actionable; `skipped` is dominated by the steady-state
  // `not_due` reason inside the widened look-ahead window and would flood the
  // scheduler log on every tick.
  const taskIds = result.triggered.map((entry) => entry.taskId);
  if (taskIds.length === 0) {
    return result;
  }

  const tasks = await db.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, workspaceId: true },
  });
  await assertSchedulerWorkOwnership(input.workContext);
  const workspaceByTaskId = new Map(tasks.map((task) => [task.id, task.workspaceId]));

  for (const entry of result.triggered) {
    const workspaceId = workspaceByTaskId.get(entry.taskId);
    if (!workspaceId) continue;
    await withSchedulerWorkOwnership(input.workContext, (tx) => recordEvent({
      workspaceId,
      taskId: entry.taskId,
      eventType: "scheduler.advance",
      reason: entry.reason,
      payload: { kind: "auto_plan_generation", trigger: entry.reason },
    }, tx));
  }

  return result;
}
