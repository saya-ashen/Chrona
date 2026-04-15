import { NextResponse } from "next/server";
import { markTaskDone } from "@/modules/commands/mark-task-done";

/**
 * POST /api/tasks/[taskId]/done — Mark a task as done.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    const result = await markTaskDone({ taskId });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mark task done";
    console.error("POST /api/tasks/[taskId]/done error:", message);

    if (message.includes("not found") || message.includes("No 'Task' record")) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
