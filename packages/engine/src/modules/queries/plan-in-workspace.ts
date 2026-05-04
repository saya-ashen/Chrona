import { db } from "@/lib/db";

export async function ensurePlanInWorkspace(planId: string, taskId: string, workspaceId: string) {
  const plan = await db.memory.findUnique({
    where: { id: planId },
    select: { id: true, taskId: true, workspaceId: true },
  });

  if (!plan || plan.taskId !== taskId) {
    throw new Error("Task plan graph not found");
  }

  if (plan.workspaceId !== workspaceId) {
    throw new Error("Task plan graph not found");
  }

  return plan;
}
