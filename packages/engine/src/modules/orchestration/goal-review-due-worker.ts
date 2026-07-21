import { db } from "@/lib/db";
import { activateInternalEvent } from "../triggers/task-triggers";

export async function runGoalReviewDueWorker(input: { now?: Date } = {}) {
  const now = input.now ?? new Date();
  const goals = await db.goal.findMany({
    where: { status: "Active", nextReviewAt: { lte: now } },
    select: { id: true, workspaceId: true, title: true, nextReviewAt: true },
  });
  let activated = 0;
  for (const goal of goals) {
    activated += await activateInternalEvent({
      workspaceId: goal.workspaceId,
      topic: "goal.review_due",
      causationId: `goal-review:${goal.id}:${goal.nextReviewAt!.toISOString()}`,
      normalizedInput: {
        goalId: goal.id,
        title: goal.title,
        reviewDueAt: goal.nextReviewAt!.toISOString(),
      },
    });
  }
  return activated;
}
