import { NextResponse } from "next/server";
import { reopenTask } from "@/modules/commands/reopen-task";

/**
 * POST /api/tasks/[taskId]/reopen — Reopen a completed task.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    const result = await reopenTask({ taskId });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reopen task";
    console.error("POST /api/tasks/[taskId]/reopen error:", message);

    if (message.includes("not found") || message.includes("No 'Task' record")) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
