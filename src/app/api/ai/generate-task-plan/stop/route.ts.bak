import { NextResponse } from "next/server";
import { stopTaskPlanGeneration } from "@/modules/commands/task-plan-generation-registry";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const taskId = typeof body.taskId === "string" ? body.taskId : null;

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const stopped = stopTaskPlanGeneration(taskId);
  return NextResponse.json({ taskId, stopped });
}
