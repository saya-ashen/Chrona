import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decomposeTaskSmart } from "@/modules/ai/task-decomposer";
import type { TaskDecompositionInput } from "@/modules/ai/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, title, description, priority, dueAt, estimatedMinutes } = body;

    // Validate: need either taskId or title
    if (!taskId && !title) {
      return NextResponse.json(
        { error: "Either taskId or title is required" },
        { status: 400 },
      );
    }

    let input: TaskDecompositionInput;

    if (taskId) {
      // Look up task from DB
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
      let taskEstimatedMinutes: number | undefined;
      if (task.scheduledStartAt && task.scheduledEndAt) {
        taskEstimatedMinutes = Math.round(
          (task.scheduledEndAt.getTime() - task.scheduledStartAt.getTime()) / 60000,
        );
      }

      input = {
        taskId: task.id,
        title: task.title,
        description: task.description ?? undefined,
        priority: task.priority,
        dueAt: task.dueAt,
        estimatedMinutes: taskEstimatedMinutes,
      };
    } else {
      // Use directly provided fields
      input = {
        title,
        description: description ?? undefined,
        priority: priority ?? "Medium",
        dueAt: dueAt ? new Date(dueAt) : null,
        estimatedMinutes: estimatedMinutes ?? undefined,
      };
    }

    const result = await decomposeTaskSmart(input);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error decomposing task:", error);
    return NextResponse.json(
      { error: "Failed to decompose task" },
      { status: 500 },
    );
  }
}
