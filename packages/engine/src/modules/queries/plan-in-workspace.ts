import { db } from "@/lib/db";

export async function ensurePlanInWorkspace(planId: string, taskId: string, workspaceId: string) {
  const direct = await db.memory.findUnique({
    where: { id: planId },
    select: { id: true, taskId: true, workspaceId: true },
  });

  if (direct?.taskId === taskId && direct.workspaceId === workspaceId) {
    return direct;
  }

  const plans = await db.memory.findMany({
    where: { taskId, workspaceId },
    select: { id: true, taskId: true, workspaceId: true, content: true },
  });

  for (const plan of plans) {
    try {
      const parsed = JSON.parse(plan.content) as { type?: string; compiledPlan?: { editablePlanId?: string } };
      if (parsed.type === "compiled_plan_v1" && parsed.compiledPlan?.editablePlanId === planId) {
        return { id: plan.id, taskId: plan.taskId, workspaceId: plan.workspaceId };
      }
    } catch {
      // Ignore unrelated memory payloads.
    }
  }

  throw new Error("Task plan graph not found");
}
