import { db } from "@/lib/db";
import { activateInternalEvent } from "../triggers/task-triggers";
import { assertSchedulerWorkOwnership, type SchedulerWorkContext } from "./scheduler-lease-repository";

export async function runGoalReviewDueWorker(input: { now?: Date; workContext?: SchedulerWorkContext } = {}) {
  const now = input.now ?? new Date();
  const goals = await db.goal.findMany({
    where: { status: "Active", nextReviewAt: { lte: now } },
    select: { id: true, workspaceId: true, title: true, nextReviewAt: true },
  });
  let activated = 0;
  for (const goal of goals) {
    await assertSchedulerWorkOwnership(input.workContext);
    activated += await activateInternalEvent({
      workspaceId: goal.workspaceId,
      topic: "goal.review_due",
      causationId: `goal-review:${goal.id}:${goal.nextReviewAt!.toISOString()}`,
      normalizedInput: {
        goalId: goal.id,
        title: goal.title,
        reviewDueAt: goal.nextReviewAt!.toISOString(),
      },
      workContext: input.workContext,
    });
    await assertSchedulerWorkOwnership(input.workContext);
  }
  return activated;
}
