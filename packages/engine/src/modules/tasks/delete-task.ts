import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import type { Prisma } from "@/generated/prisma/client";
import { appendCanonicalEvent } from "@/modules/events";
import { createLogger } from "@chrona/logging";

const logger = createLogger("engine.tasks.delete");
async function collectTaskTreeIds(taskId: string): Promise<string[]> {
  const tasks = await db.task.findMany({ select: { id: true, parentTaskId: true } });
  const children = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const siblings = children.get(task.parentTaskId) ?? [];
    siblings.push(task.id);
    children.set(task.parentTaskId, siblings);
  }
  const taskIds: string[] = [];
  const pending = [taskId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    taskIds.push(current);
    pending.push(...(children.get(current) ?? []));
  }
  return taskIds;
}

export async function getTaskDeleteImpact(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) throw new Error("Task not found");
  const taskIds = await collectTaskTreeIds(taskId);
  const artifacts = await db.artifact.findMany({
    where: { taskId: { in: taskIds } },
    select: { id: true },
  });
  const artifactIds = artifacts.map((artifact) => artifact.id);
  const assets = artifactIds.length === 0 ? [] : await db.goalAsset.findMany({
    where: {
      OR: [
        { sourceArtifactId: { in: artifactIds } },
        { currentArtifactId: { in: artifactIds } },
        { versions: { some: { artifactId: { in: artifactIds } } } },
      ],
    },
    select: { id: true, label: true, goalId: true },
    orderBy: [{ label: "asc" }, { id: "asc" }],
  });
  return { taskIds, taskCount: taskIds.length, assets };
}

async function deleteTaskTreeGoalAssets(tx: Prisma.TransactionClient, taskIds: string[]) {
  const artifacts = await tx.artifact.findMany({
    where: { taskId: { in: taskIds } },
    select: { id: true },
  });
  const artifactIds = artifacts.map((artifact) => artifact.id);
  if (artifactIds.length === 0) return;
  const assets = await tx.goalAsset.findMany({
    where: {
      OR: [
        { sourceArtifactId: { in: artifactIds } },
        { currentArtifactId: { in: artifactIds } },
        { versions: { some: { artifactId: { in: artifactIds } } } },
      ],
    },
    select: { id: true },
  });
  if (assets.length === 0) return;
  await tx.goalAsset.deleteMany({ where: { id: { in: assets.map((asset) => asset.id) } } });
}

export async function deleteTaskTreeRecords(
  tx: Prisma.TransactionClient,
  currentTaskId: string,
  requestedTaskId = currentTaskId,
): Promise<void> {
  const childTasks = await tx.task.findMany({
    where: { parentTaskId: currentTaskId },
    select: { id: true },
  });

  for (const child of childTasks) {
    await deleteTaskTreeRecords(tx, child.id, requestedTaskId);
  }

  const runs = await tx.run.findMany({
    where: { taskId: currentTaskId },
    select: { id: true },
  });
  const runIds = runs.map((run) => run.id);

  if (runIds.length > 0) {
    logger.warn("task.delete.removing_runs", {
      requestedTaskId,
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
  await tx.approval.deleteMany({ where: { taskId: currentTaskId } });
  await tx.artifact.deleteMany({ where: { taskId: currentTaskId } });
  await tx.taskPlanLayer.deleteMany({ where: { taskId: currentTaskId } });
  await tx.taskPlanRun.deleteMany({ where: { taskId: currentTaskId } });
  await tx.taskPlan.deleteMany({ where: { taskId: currentTaskId } });
  await tx.taskProjection.deleteMany({ where: { taskId: currentTaskId } });
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

export async function deleteTask(taskId: string, expected: { expectedTaskIds: string[]; expectedAssetIds: string[] }) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, workspaceId: true, title: true },
  });

  if (!task) {
    throw new Error("Task not found");
  }


  const impact = await getTaskDeleteImpact(taskId);
  const actualTaskIds = [...impact.taskIds].sort();
  const actualAssetIds = impact.assets.map((asset) => asset.id).sort();
  const expectedTaskIds = [...expected.expectedTaskIds].sort();
  const expectedAssetIds = [...expected.expectedAssetIds].sort();
  if (JSON.stringify(actualTaskIds) !== JSON.stringify(expectedTaskIds)
    || JSON.stringify(actualAssetIds) !== JSON.stringify(expectedAssetIds)) {
    throw new EngineError(
      ENGINE_ERROR_CODES.CONFLICT,
      "The tasks or Goal assets changed after deletion was reviewed. Review the deletion impact again.",
    );
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
    await deleteTaskTreeGoalAssets(tx, impact.taskIds);
    await deleteTaskTreeRecords(tx, taskId);
  });

  return { success: true, taskId, deletedAssetCount: impact.assets.length };
}
