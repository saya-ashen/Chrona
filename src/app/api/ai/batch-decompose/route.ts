import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decomposeTaskSmart } from "@/modules/ai/task-decomposer";
import { createTask } from "@/modules/commands/create-task";
import type { TaskDecompositionInput } from "@/modules/ai/types";

/**
 * POST /api/ai/batch-decompose — Decompose a task into subtasks and create them all in one call.
 * Body: { taskId }
 *
 * Calls decomposeTaskSmart to generate subtask suggestions, then creates each
 * as a real Task record with parentTaskId set to the original task.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 },
      );
    }

    // Look up the parent task
    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 },
      );
    }

    // Compute estimatedMinutes from scheduled window if available
    let estimatedMinutes: number | undefined;
    if (task.scheduledStartAt && task.scheduledEndAt) {
      estimatedMinutes = Math.round(
        (task.scheduledEndAt.getTime() - task.scheduledStartAt.getTime()) / 60000,
      );
    }

    // Decompose the task using AI
    const input: TaskDecompositionInput = {
      taskId: task.id,
      title: task.title,
      description: task.description ?? undefined,
      priority: task.priority,
      dueAt: task.dueAt,
      estimatedMinutes,
    };

    const decomposition = await decomposeTaskSmart(input);

    // Create each suggested subtask as a real task in the DB
    const createdSubtasks = [];

    for (const suggestion of decomposition.subtasks) {
      const result = await createTask({
        workspaceId: task.workspaceId,
        title: suggestion.title,
        description: suggestion.description,
        priority: suggestion.priority as "Low" | "Medium" | "High" | "Urgent" | undefined,
      });

      // Set parentTaskId on the created subtask
      const subtask = await db.task.update({
        where: { id: result.taskId },
        data: { parentTaskId: taskId },
        include: { projection: true },
      });

      createdSubtasks.push(subtask);
    }

    return NextResponse.json({
      parentTaskId: taskId,
      subtasks: createdSubtasks,
      decomposition: {
        totalEstimatedMinutes: decomposition.totalEstimatedMinutes,
        feasibilityScore: decomposition.feasibilityScore,
        warnings: decomposition.warnings,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to batch decompose task";
    console.error("POST /api/ai/batch-decompose error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
