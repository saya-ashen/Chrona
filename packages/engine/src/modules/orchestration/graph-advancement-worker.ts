import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { taskPlanExecution } from "@/modules/plan-execution";
import { recordOrchestratorEvent } from "./scheduler-events";

type GraphAdvancementWorkerDeps = {
  startExecution?: typeof taskPlanExecution.start;
  recordEvent?: typeof recordOrchestratorEvent;
};

export async function runGraphAdvancementWorker(input: {
  deps?: GraphAdvancementWorkerDeps;
} = {}) {
  const startExecution = input.deps?.startExecution ?? taskPlanExecution.start.bind(taskPlanExecution);
  const recordEvent = input.deps?.recordEvent ?? recordOrchestratorEvent;
  const tasks = await db.task.findMany({
    where: {
      status: { in: [TaskStatus.Queued, TaskStatus.Running] },
      runs: { none: { status: { in: ["Pending", "Running", "WaitingForInput", "WaitingForApproval"] } } },
      executionSessions: { none: { status: { in: ["Active", "Paused", "Abandoned"] } } },
      taskPlanRuns: {
        some: {
          executionOwnerId: null,
        },
      },
    },
    select: { id: true, workspaceId: true },
    orderBy: { updatedAt: "asc" },
    take: 25,
  });

  const advanced: Array<{ taskId: string; status: string }> = [];
  for (const task of tasks) {
    const execution = await startExecution({ taskId: task.id, trigger: "system" });
    advanced.push({ taskId: task.id, status: execution.status });
    await recordEvent({
      workspaceId: task.workspaceId,
      taskId: task.id,
      eventType: execution.status === "completed" ? "scheduler.complete" : "scheduler.advance",
      payload: { status: execution.status, currentNodeId: execution.currentNodeId },
    });
  }

  return { advanced };
}
