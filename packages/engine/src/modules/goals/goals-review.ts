import { db, Prisma } from "@chrona/db";
import type { ApplyGoalReviewRequest } from "@chrona/contracts/api";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { buildAutomaticGoalTaskContext } from "./goal-task-context";
import { getGoal, getGoalOrThrow } from "./goals-read";

export async function applyGoalReview(input: { goalId: string; command: ApplyGoalReviewRequest }) {
  const goal = await getGoalOrThrow(input.goalId);
  if (goal.status !== "Active") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can apply reviews");
  }
  const context = await buildAutomaticGoalTaskContext({ goalId: goal.id, workspaceId: goal.workspaceId });
  const now = new Date();
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: goal.workspaceId }, select: { defaultRuntime: true } });
  const createdTaskIds: string[] = [];
  await db.$transaction(async (tx) => {
    await tx.goal.update({
      where: { id: goal.id },
      data: {
        ...(input.command.brief ? { operationalBrief: input.command.brief } : {}),
        ...(input.command.nextReviewAt !== undefined ? { nextReviewAt: input.command.nextReviewAt ? new Date(input.command.nextReviewAt) : null } : {}),
      },
    });
    if (input.command.brief) {
      await tx.goalBriefRevision.create({ data: { workspaceId: goal.workspaceId, goalId: goal.id, brief: input.command.brief, actorType: "user", actorId: "server-action" } });
    }
    for (const command of input.command.tasks) {
      const task = await tx.task.create({
        data: {
          workspaceId: goal.workspaceId,
          goalId: goal.id,
          title: command.title,
          description: command.description ?? null,
          priority: command.priority,
          kind: "single",
          status: "Ready",
          executionRuntime: workspace.defaultRuntime,
          executionConfig: {},
          autoPlanGeneration: command.autoPlanGeneration,
          autoExecute: false,
          goalContext: { ...context, expectedOutcome: command.expectedOutcome ?? null } as Prisma.InputJsonObject,
        },
      });
      createdTaskIds.push(task.id);
    }
    const latest = await tx.event.aggregate({ _max: { ingestSequence: true } });
    await tx.event.create({
      data: {
        eventType: "goal.review_applied",
        workspaceId: goal.workspaceId,
        actorType: "user",
        actorId: "server-action",
        source: "ui",
        payload: { goal_id: goal.id, task_ids: createdTaskIds, next_review_at: input.command.nextReviewAt ?? null, brief_updated: Boolean(input.command.brief) },
        summary: input.command.summary,
        occurredAt: now,
        ingestSequence: (latest._max.ingestSequence ?? 0) + 1,
      },
    });
  });
  return getGoal({ goalId: goal.id });
}
