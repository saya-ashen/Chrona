import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events";
import { createLogger } from "@chrona/shared/logger";

const logger = createLogger("engine.tasks.delete");

export async function deleteTask(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, workspaceId: true, title: true },
  });

  if (!task) {
    throw new Error("Task not found");
  }

  await appendCanonicalEvent({
    eventType: "task.deleted",
    workspaceId: task.workspaceId,
    taskId: task.id,
    workBlockId: null,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: { title: task.title },
    dedupeKey: `task.deleted:${task.id}`,
  });

  await db.$transaction(async (tx) => {
    async function deleteTaskTree(currentTaskId: string): Promise<void> {
      const childTasks = await tx.task.findMany({
        where: { parentTaskId: currentTaskId },
        select: { id: true },
      });

      for (const child of childTasks) {
        await deleteTaskTree(child.id);
      }

      const runs = await tx.run.findMany({
        where: { taskId: currentTaskId },
        select: { id: true },
      });
      const runIds = runs.map((run) => run.id);

      if (runIds.length > 0) {
        logger.warn("task.delete.removing_runs", {
          requestedTaskId: taskId,
          currentTaskId,
          runIds,
          stack: new Error("Run deletion trace").stack,
        });
        await tx.runtimeCursor.deleteMany({ where: { runId: { in: runIds } } });
        await tx.toolInvocation.deleteMany({ where: { runId: { in: runIds } } });
        await tx.conversationEntry.deleteMany({ where: { runId: { in: runIds } } });
      }

      await tx.schedulerEvent.deleteMany({ where: { taskId: currentTaskId } });
      await tx.reconciliationEvent.deleteMany({ where: { taskId: currentTaskId } });
      await tx.graphMutationRecord.deleteMany({ where: { taskId: currentTaskId } });
      await tx.graphVersion.deleteMany({ where: { taskId: currentTaskId } });
      await tx.executionSession.deleteMany({ where: { taskId: currentTaskId } });
      await tx.workBlock.deleteMany({ where: { taskId: currentTaskId } });
      await tx.taskPlanLayer.deleteMany({ where: { taskId: currentTaskId } });
      await tx.taskPlanRun.deleteMany({ where: { taskId: currentTaskId } });
      await tx.taskPlan.deleteMany({ where: { taskId: currentTaskId } });
      await tx.taskProjection.deleteMany({ where: { taskId: currentTaskId } });
      await tx.approval.deleteMany({ where: { taskId: currentTaskId } });
      await tx.artifact.deleteMany({ where: { taskId: currentTaskId } });
      await tx.memory.deleteMany({ where: { taskId: currentTaskId } });
      await tx.taskTimelineItem.deleteMany({ where: { taskId: currentTaskId } });
      await tx.event.deleteMany({ where: { taskId: currentTaskId } });
      await tx.rawEventLog.deleteMany({ where: { taskId: currentTaskId } });
      await tx.taskDependency.deleteMany({
        where: { OR: [{ taskId: currentTaskId }, { dependsOnTaskId: currentTaskId }] },
      });
      await tx.scheduleProposal.deleteMany({ where: { taskId: currentTaskId } });
      await tx.run.deleteMany({ where: { taskId: currentTaskId } });
      await tx.taskSession.deleteMany({ where: { taskId: currentTaskId } });
      await tx.taskAssistantMessage.deleteMany({ where: { taskId: currentTaskId } });
      await tx.task.delete({ where: { id: currentTaskId } });
    }

    await deleteTaskTree(taskId);
  });

  return { success: true, taskId };
}
