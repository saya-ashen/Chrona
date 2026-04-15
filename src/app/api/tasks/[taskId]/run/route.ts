import { NextResponse } from "next/server";
import { startRun } from "@/modules/commands/start-run";
import { createRuntimeAdapter } from "@/modules/runtime/openclaw/adapter";

/**
 * POST /api/tasks/[taskId]/run — Start a new AI agent run for a task.
 * Body: { prompt? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await request.json().catch(() => ({}));

    const adapter = await createRuntimeAdapter();

    const result = await startRun({
      taskId,
      prompt: body.prompt,
      adapter,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start run";
    console.error("POST /api/tasks/[taskId]/run error:", message);

    if (message.includes("not found") || message.includes("No 'Task' record")) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
