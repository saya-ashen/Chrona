import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { normalizeAutomationTiming } from "@chrona/contracts";
import { createTask } from "./create-task";
import { deleteTaskTreeRecords } from "./delete-task";

export async function rebuildTaskWithLatestGoalAssets(input: {
  taskId: string;
  workspaceId?: string;
}) {
  const source = await db.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      workspaceId: true,
      goalId: true,
      title: true,
      description: true,
      priority: true,
      executionRuntime: true,
      executionConfig: true,
      aiClientId: true,
      autoPlanGenerationTiming: true,
      autoExecuteTiming: true,
      parentTaskId: true,
      recurrenceRule: true,
      recurrenceAnchorStartAt: true,
      recurrenceAnchorEndAt: true,
      goalContext: true,
    },
  });

  if (!source || (input.workspaceId && source.workspaceId !== input.workspaceId)) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }
  if (!source.goalId) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Only Goal-linked Tasks can be rebuilt with the latest asset snapshot",
    );
  }

  const existingContext = source.goalContext;
  const expectedOutcome = existingContext
    && typeof existingContext === "object"
    && !Array.isArray(existingContext)
    && "expectedOutcome" in existingContext
      ? existingContext.expectedOutcome
      : undefined;

  const rebuilt = await db.$transaction(async (tx) => {
    await deleteTaskTreeRecords(tx, source.id);
    const created = await createTask({
      workspaceId: source.workspaceId,
      goalId: source.goalId,
      title: source.title,
      description: source.description,
      priority: source.priority,
      executionRuntime: source.executionRuntime,
      executionConfig: source.executionConfig as Prisma.InputJsonObject,
      aiClientId: source.aiClientId,
      autoPlanGeneration: false,
      autoExecute: false,
      autoPlanGenerationTiming: normalizeAutomationTiming(source.autoPlanGenerationTiming),
      autoExecuteTiming: normalizeAutomationTiming(source.autoExecuteTiming),
      parentTaskId: source.parentTaskId,
      recurrenceRule: source.recurrenceRule,
      recurrenceAnchorStartAt: source.recurrenceAnchorStartAt?.toISOString(),
      recurrenceAnchorEndAt: source.recurrenceAnchorEndAt?.toISOString(),
      goalContext: expectedOutcome === undefined ? undefined : { expectedOutcome },
    }, tx);

    await tx.event.update({
      where: { dedupeKey: `task.created:${created.taskId}` },
      data: {
        payload: {
          rebuilt_from_task_id: source.id,
          title: source.title,
          description: source.description,
          priority: source.priority,
          executionRuntime: source.executionRuntime,
          autoPlanGeneration: false,
          autoExecute: false,
          autoPlanGenerationTiming: source.autoPlanGenerationTiming,
          autoExecuteTiming: source.autoExecuteTiming,
          status: "Ready",
          parentTaskId: source.parentTaskId,
        },
        summary: `Rebuilt task with latest Goal assets: ${source.title}`,
      },
    });

    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await rebuildTaskProjection(rebuilt.taskId);
  return {
    taskId: rebuilt.taskId,
    replacedTaskId: source.id,
    workspaceId: rebuilt.workspaceId,
  };
}
