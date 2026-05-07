import { db } from "@/lib/db";

export async function ensurePlanInWorkspace(
  planId: string,
  taskId: string,
  workspaceId: string,
) {
  const plan = await db.taskPlan.findFirst({
    where: {
      taskId,
      workspaceId,
      OR: [{ id: planId }, { planId }],
    },
    select: { id: true, taskId: true, workspaceId: true },
  });

  if (!plan) {
    throw new Error("Task plan graph not found");
  }

  return plan;
}
