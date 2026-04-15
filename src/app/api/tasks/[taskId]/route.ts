import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { updateTask } from "@/modules/commands/update-task";

/**
 * GET /api/tasks/[taskId] — Get a single task with projection and recent runs.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    const task = await db.task.findUnique({
      where: { id: taskId },
      include: {
        projection: true,
        runs: { orderBy: { startedAt: "desc" }, take: 5 },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get task";
    console.error("GET /api/tasks/[taskId] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/tasks/[taskId] — Update a task.
 * Body: { title?, description?, priority?, dueAt?, scheduledStartAt?, scheduledEndAt?,
 *         runtimeAdapterKey?, runtimeInput?, runtimeInputVersion?, runtimeModel?,
 *         prompt?, runtimeConfig? }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await request.json();

    const result = await updateTask({
      taskId,
      title: body.title,
      description: body.description,
      priority: body.priority,
      dueAt: body.dueAt !== undefined ? (body.dueAt ? new Date(body.dueAt) : null) : undefined,
      scheduledStartAt: body.scheduledStartAt !== undefined
        ? (body.scheduledStartAt ? new Date(body.scheduledStartAt) : null)
        : undefined,
      scheduledEndAt: body.scheduledEndAt !== undefined
        ? (body.scheduledEndAt ? new Date(body.scheduledEndAt) : null)
        : undefined,
      runtimeAdapterKey: body.runtimeAdapterKey,
      runtimeInput: body.runtimeInput,
      runtimeInputVersion: body.runtimeInputVersion,
      runtimeModel: body.runtimeModel,
      prompt: body.prompt,
      runtimeConfig: body.runtimeConfig,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update task";
    console.error("PATCH /api/tasks/[taskId] error:", message);

    if (message.includes("Record to update not found") || message.includes("not found")) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
