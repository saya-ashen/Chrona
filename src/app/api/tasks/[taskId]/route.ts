import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { updateTask } from "@/modules/commands/update-task";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";

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

/**
 * DELETE /api/tasks/[taskId] — Delete a task and its related records.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { id: true, workspaceId: true, title: true },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Delete related records in correct order to avoid FK constraint issues
    await db.$transaction(async (tx) => {
      // Delete task projection
      await tx.taskProjection.deleteMany({ where: { taskId } });

      // Delete runs associated with the task
      await tx.run.deleteMany({ where: { taskId } });

      // Delete task sessions
      await tx.taskSession.deleteMany({ where: { taskId } });

      // Delete approvals
      await tx.approval.deleteMany({ where: { taskId } });

      // Delete artifacts
      await tx.artifact.deleteMany({ where: { taskId } });

      // Delete memories
      await tx.memory.deleteMany({ where: { taskId } });

      // Delete events
      await tx.event.deleteMany({ where: { taskId } });

      // Delete task dependencies (both directions)
      await tx.taskDependency.deleteMany({
        where: { OR: [{ taskId }, { dependsOnTaskId: taskId }] },
      });

      // Delete schedule proposals
      await tx.scheduleProposal.deleteMany({ where: { taskId } });

      // Delete child tasks (subtasks) and their related records
      const childTasks = await tx.task.findMany({
        where: { parentTaskId: taskId },
        select: { id: true },
      });

      for (const child of childTasks) {
        await tx.taskProjection.deleteMany({ where: { taskId: child.id } });
        await tx.run.deleteMany({ where: { taskId: child.id } });
        await tx.taskSession.deleteMany({ where: { taskId: child.id } });
        await tx.approval.deleteMany({ where: { taskId: child.id } });
        await tx.artifact.deleteMany({ where: { taskId: child.id } });
        await tx.memory.deleteMany({ where: { taskId: child.id } });
        await tx.event.deleteMany({ where: { taskId: child.id } });
        await tx.taskDependency.deleteMany({
          where: { OR: [{ taskId: child.id }, { dependsOnTaskId: child.id }] },
        });
        await tx.scheduleProposal.deleteMany({ where: { taskId: child.id } });
        await tx.task.delete({ where: { id: child.id } });
      }

      // Delete the task itself
      await tx.task.delete({ where: { id: taskId } });
    });

    await appendCanonicalEvent({
      eventType: "task.deleted",
      workspaceId: task.workspaceId,
      taskId: task.id,
      actorType: "user",
      actorId: "server-action",
      source: "ui",
      payload: { title: task.title },
      dedupeKey: `task.deleted:${task.id}`,
    });

    return NextResponse.json({ success: true, taskId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete task";
    console.error("DELETE /api/tasks/[taskId] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
