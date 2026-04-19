import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decomposeTaskSmart } from "@/modules/ai/task-decomposer";
import { createTask } from "@/modules/commands/create-task";
import type { TaskDecompositionInput } from "@/modules/ai/types";

/**
 * POST /api/ai/batch-decompose — Decompose a task into subtasks and create them all in one call.
 * Body: { taskId, subtasks? }
 *
 * If `subtasks` array is provided, uses those directly instead of calling AI.
 * Otherwise calls decomposeTaskSmart to generate subtask suggestions.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, subtasks: providedSubtasks } = body;

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

    // Use provided subtasks or generate via AI
    let subtaskSuggestions: Array<{
      title: string;
      description?: string;
      priority?: string;
      estimatedMinutes?: number;
      order?: number;
    }>;
    let decompositionMeta: {
      totalEstimatedMinutes: number;
      feasibilityScore: number;
      warnings: string[];
    };

    if (providedSubtasks && Array.isArray(providedSubtasks) && providedSubtasks.length > 0) {
      // Use pre-generated subtasks from the frontend
      subtaskSuggestions = providedSubtasks;
      decompositionMeta = {
        totalEstimatedMinutes: providedSubtasks.reduce(
          (sum: number, s: { estimatedMinutes?: number }) => sum + (s.estimatedMinutes ?? 0),
          0,
        ),
        feasibilityScore: 80,
        warnings: [],
      };
    } else {
      // Generate via AI
      let estimatedMinutes: number | undefined;
      if (task.scheduledStartAt && task.scheduledEndAt) {
        estimatedMinutes = Math.round(
          (task.scheduledEndAt.getTime() - task.scheduledStartAt.getTime()) / 60000,
        );
      }

      const input: TaskDecompositionInput = {
        taskId: task.id,
        title: task.title,
        description: task.description ?? undefined,
        priority: task.priority,
        dueAt: task.dueAt,
        estimatedMinutes,
      };

      const decomposition = await decomposeTaskSmart(input);
      subtaskSuggestions = decomposition.subtasks;
      decompositionMeta = {
        totalEstimatedMinutes: decomposition.totalEstimatedMinutes,
        feasibilityScore: decomposition.feasibilityScore,
        warnings: decomposition.warnings,
      };
    }

    // Create each subtask as a real task in the DB
    const createdSubtasks = [];

    for (const suggestion of subtaskSuggestions) {
      // Normalize priority to match enum (capitalize first letter)
      let normalizedPriority: "Low" | "Medium" | "High" | "Urgent" = "Medium";
      if (suggestion.priority) {
        const p = suggestion.priority.charAt(0).toUpperCase() + suggestion.priority.slice(1).toLowerCase();
        if (p === "Low" || p === "Medium" || p === "High" || p === "Urgent") {
          normalizedPriority = p;
        }
      }

      const result = await createTask({
        workspaceId: task.workspaceId,
        title: suggestion.title,
        description: suggestion.description,
        priority: normalizedPriority,
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
      decomposition: decompositionMeta,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to batch decompose task";
    console.error("POST /api/ai/batch-decompose error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
