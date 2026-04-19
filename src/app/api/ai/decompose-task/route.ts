import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiDecompose } from "@/modules/ai/ai-service";
import { decomposeTaskSmart } from "@/modules/ai/task-decomposer";
import type { TaskDecompositionInput } from "@/modules/ai/types";
import {
  getLatestTaskPlanGraph,
  saveTaskPlanGraph,
  taskPlanGraphToDecompositionResult,
} from "@/modules/tasks/task-plan-graph-store";

function buildSavedPlanSummary(savedPlan: {
  id: string;
  status: string;
  prompt: string | null;
  revision: number;
  summary: string | null;
  updatedAt: string;
}) {
  return {
    id: savedPlan.id,
    status: savedPlan.status,
    prompt: savedPlan.prompt,
    revision: savedPlan.revision,
    summary: savedPlan.summary,
    updatedAt: savedPlan.updatedAt,
  };
}

function buildSavedPlanResponse(savedPlan: Awaited<ReturnType<typeof getLatestTaskPlanGraph>>) {
  if (!savedPlan) return null;
  return {
    ...taskPlanGraphToDecompositionResult(savedPlan.plan),
    source: "saved",
    planGraph: savedPlan.plan,
    savedPlan: buildSavedPlanSummary(savedPlan),
  };
}

function buildGeneratedPlanResponse(
  savedPlan: Awaited<ReturnType<typeof saveTaskPlanGraph>>,
  result: {
    subtasks: unknown[];
    totalEstimatedMinutes: number;
    feasibilityScore: number;
    warnings: string[];
    source?: string;
    reasoning?: unknown;
  },
) {
  return {
    ...result,
    planGraph: savedPlan.plan,
    savedPlan: buildSavedPlanSummary(savedPlan),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      taskId,
      title,
      description,
      priority,
      dueAt,
      estimatedMinutes,
      planningPrompt,
      forceRefresh = false,
    } = body;

    if (!taskId && !title) {
      return NextResponse.json(
        { error: "Either taskId or title is required" },
        { status: 400 },
      );
    }

    if (taskId && !forceRefresh) {
      const savedPlan = await getLatestTaskPlanGraph(taskId);
      const response = buildSavedPlanResponse(savedPlan);
      if (response) {
        return NextResponse.json(response);
      }
    }

    let resolvedWorkspaceId: string | null = null;
    let resolvedTitle = title;
    let resolvedDescription = description;
    let resolvedEstimatedMinutes = estimatedMinutes;

    if (taskId) {
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      resolvedWorkspaceId = task.workspaceId;
      resolvedTitle = task.title;
      resolvedDescription = task.description ?? undefined;
      if (task.scheduledStartAt && task.scheduledEndAt) {
        resolvedEstimatedMinutes = Math.round(
          (task.scheduledEndAt.getTime() - task.scheduledStartAt.getTime()) / 60000,
        );
      }
    }

    const normalizedPriority = priority ?? "Medium";

    // Try new adapter layer first
    const adapterResult = await aiDecompose({
      taskId: taskId ?? "",
      title: resolvedTitle,
      description: resolvedDescription,
      estimatedMinutes: resolvedEstimatedMinutes,
    });

    if (adapterResult) {
      const result = {
        subtasks: adapterResult.subtasks,
        reasoning: adapterResult.reasoning,
        source: adapterResult.source,
        totalEstimatedMinutes: adapterResult.subtasks.reduce(
          (sum, s) => sum + (s.estimatedMinutes ?? 0),
          0,
        ),
        feasibilityScore: 80,
        warnings: [],
      };

      if (taskId && resolvedWorkspaceId) {
        const savedPlan = await saveTaskPlanGraph({
          workspaceId: resolvedWorkspaceId,
          taskId,
          prompt: planningPrompt ?? null,
          decompositionResult: {
            subtasks: result.subtasks,
            totalEstimatedMinutes: result.totalEstimatedMinutes,
            feasibilityScore: result.feasibilityScore,
            warnings: result.warnings,
          },
          status: "draft",
          source: "ai",
          generatedBy: adapterResult.source ?? "adapter",
          summary: `${result.subtasks.length} planned item${result.subtasks.length === 1 ? "" : "s"}`,
        });

        return NextResponse.json(buildGeneratedPlanResponse(savedPlan, result));
      }

      return NextResponse.json(result);
    }

    // Fallback to existing rule-based + LLM logic
    const input: TaskDecompositionInput = {
      taskId,
      title: resolvedTitle,
      description: resolvedDescription,
      priority: normalizedPriority,
      dueAt: dueAt ? new Date(dueAt) : null,
      estimatedMinutes: resolvedEstimatedMinutes,
      planningPrompt,
    };

    const result = await decomposeTaskSmart(input);

    if (taskId && resolvedWorkspaceId) {
      const savedPlan = await saveTaskPlanGraph({
        workspaceId: resolvedWorkspaceId,
        taskId,
        prompt: planningPrompt ?? null,
        decompositionResult: result,
        status: "draft",
        source: "ai",
        generatedBy: "decompose-task",
        summary: `${result.subtasks.length} planned item${result.subtasks.length === 1 ? "" : "s"}`,
      });

      return NextResponse.json(buildGeneratedPlanResponse(savedPlan, result));
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error decomposing task:", error);
    return NextResponse.json(
      { error: "Failed to decompose task" },
      { status: 500 },
    );
  }
}
