import { NextResponse } from "next/server";
import { applySchedule } from "@/modules/commands/apply-schedule";
import { clearSchedule } from "@/modules/commands/clear-schedule";

/**
 * POST /api/tasks/[taskId]/schedule — Apply a schedule to a task.
 * Body: { scheduledStartAt, scheduledEndAt, dueAt?, scheduleSource? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await request.json();

    if (!body.scheduledStartAt || !body.scheduledEndAt) {
      return NextResponse.json(
        { error: "scheduledStartAt and scheduledEndAt are required" },
        { status: 400 },
      );
    }

    const result = await applySchedule({
      taskId,
      scheduledStartAt: new Date(body.scheduledStartAt),
      scheduledEndAt: new Date(body.scheduledEndAt),
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      scheduleSource: body.scheduleSource ?? "system",
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply schedule";
    console.error("POST /api/tasks/[taskId]/schedule error:", message);

    if (message.includes("not found") || message.includes("No 'Task' record")) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[taskId]/schedule — Clear the schedule for a task.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    const result = await clearSchedule({ taskId });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear schedule";
    console.error("DELETE /api/tasks/[taskId]/schedule error:", message);

    if (message.includes("not found") || message.includes("No 'Task' record")) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
