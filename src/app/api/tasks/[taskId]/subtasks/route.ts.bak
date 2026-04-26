import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createTask } from "@/modules/commands/create-task";

function mapSubtask(task: Awaited<ReturnType<typeof db.task.findMany>>[number] & { projection: { persistedStatus: string; scheduleStatus: string | null } | null }) {
  return {
    id: task.id,
    parentTaskId: task.parentTaskId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    persistedStatus: task.projection?.persistedStatus ?? task.status,
    scheduleStatus: task.projection?.scheduleStatus ?? task.scheduleStatus,
    dueAt: task.dueAt,
    scheduledStartAt: task.scheduledStartAt,
    scheduledEndAt: task.scheduledEndAt,
    completedAt: task.completedAt,
    isCompleted: task.status === "Done" || task.status === "Completed",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

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

    const normalizedSubtasks = subtasks.map(mapSubtask);

    return NextResponse.json({ subtasks: normalizedSubtasks, count: normalizedSubtasks.length });
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
      parentTaskId: taskId,
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
    });

    // Fetch the full created subtask to return
    const subtask = await db.task.findUnique({
      where: { id: result.taskId },
      include: { projection: true },
    });

    return NextResponse.json({ subtask: subtask ? mapSubtask(subtask) : null }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create subtask";
    console.error("POST /api/tasks/[taskId]/subtasks error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
