import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createTask } from "@/modules/commands/create-task";

/**
 * GET /api/tasks/[taskId]/subtasks — List subtasks of a parent task.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    // Verify parent task exists
    const parentTask = await db.task.findUnique({
      where: { id: taskId },
      select: { id: true },
    });

    if (!parentTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const subtasks = await db.task.findMany({
      where: { parentTaskId: taskId },
      include: { projection: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ subtasks, count: subtasks.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list subtasks";
    console.error("GET /api/tasks/[taskId]/subtasks error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/tasks/[taskId]/subtasks — Create a subtask under a parent task.
 * Body: { title, description?, priority?, dueAt? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await request.json();

    // Verify parent task exists and get its workspaceId
    const parentTask = await db.task.findUnique({
      where: { id: taskId },
      select: { id: true, workspaceId: true },
    });

    if (!parentTask) {
      return NextResponse.json({ error: "Parent task not found" }, { status: 404 });
    }

    const { title } = body;

    if (!title || (typeof title === "string" && !title.trim())) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 },
      );
    }

    // Create the subtask using the shared createTask command,
    // inheriting workspaceId from the parent
    const result = await createTask({
      workspaceId: parentTask.workspaceId,
      title,
      description: body.description,
      priority: body.priority,
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
    });

    // Set the parentTaskId (createTask doesn't support it directly)
    await db.task.update({
      where: { id: result.taskId },
      data: { parentTaskId: taskId },
    });

    // Fetch the full created subtask to return
    const subtask = await db.task.findUnique({
      where: { id: result.taskId },
      include: { projection: true },
    });

    return NextResponse.json({ subtask }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create subtask";
    console.error("POST /api/tasks/[taskId]/subtasks error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
