import { NextResponse } from "next/server";
import { generateTaskPlan } from "@/modules/commands/generate-task-plan";

/**
 * POST /api/tasks/[taskId]/plan — Generate or update a task plan.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    const result = await generateTaskPlan({ taskId });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate task plan";
    console.error("POST /api/tasks/[taskId]/plan error:", message);

    if (message.includes("not found") || message.includes("No 'Task' record")) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
