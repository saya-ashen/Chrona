import { NextResponse } from "next/server";
import { acceptTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, planId } = body as { taskId?: string; planId?: string };

    if (!taskId || !planId) {
      return NextResponse.json({ error: "taskId and planId are required" }, { status: 400 });
    }

    const savedPlan = await acceptTaskPlanGraph({ taskId, planId });

    return NextResponse.json({
      savedPlan: {
        id: savedPlan.id,
        status: savedPlan.status,
        prompt: savedPlan.prompt,
        revision: savedPlan.revision,
        summary: savedPlan.summary,
        updatedAt: savedPlan.updatedAt,
        plan: savedPlan.plan,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to accept task AI plan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
