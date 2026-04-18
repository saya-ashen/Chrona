import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiDecompose } from "@/modules/ai/ai-service";
import { decomposeTaskSmart } from "@/modules/ai/task-decomposer";
import type { TaskDecompositionInput } from "@/modules/ai/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, title, description, priority, dueAt, estimatedMinutes } = body;

    if (!taskId && !title) {
      return NextResponse.json(
        { error: "Either taskId or title is required" },
        { status: 400 },
      );
    }

    let resolvedTitle = title;
    let resolvedDescription = description;
    let resolvedEstimatedMinutes = estimatedMinutes;

    if (taskId) {
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      resolvedTitle = task.title;
      resolvedDescription = task.description ?? undefined;
      if (task.scheduledStartAt && task.scheduledEndAt) {
        resolvedEstimatedMinutes = Math.round(
          (task.scheduledEndAt.getTime() - task.scheduledStartAt.getTime()) / 60000,
        );
      }
    }

    // Try new adapter layer first
    const adapterResult = await aiDecompose({
      taskId: taskId ?? "",
      title: resolvedTitle,
      description: resolvedDescription,
      estimatedMinutes: resolvedEstimatedMinutes,
    });

    if (adapterResult) {
      return NextResponse.json({
        subtasks: adapterResult.subtasks,
        reasoning: adapterResult.reasoning,
        source: adapterResult.source,
        totalEstimatedMinutes: adapterResult.subtasks.reduce(
          (sum, s) => sum + (s.estimatedMinutes ?? 0),
          0,
        ),
      });
    }

    // Fallback to existing rule-based + LLM logic
    const input: TaskDecompositionInput = {
      taskId,
      title: resolvedTitle,
      description: resolvedDescription,
      priority: priority ?? "Medium",
      dueAt: dueAt ? new Date(dueAt) : null,
      estimatedMinutes: resolvedEstimatedMinutes,
    };

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
