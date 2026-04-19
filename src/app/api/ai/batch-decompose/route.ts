import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decomposeTaskSmart } from "@/modules/ai/task-decomposer";
import { materializeTaskPlan } from "@/modules/commands/materialize-task-plan";
import { saveTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import type { TaskDecompositionInput } from "@/modules/ai/types";

/**
 * POST /api/ai/batch-decompose — Decompose a task and materialize executable graph nodes.
 * Body: { taskId, subtasks? }
 *
 * If `subtasks` array is provided, uses those directly instead of calling AI.
 * The produced decomposition is saved as a task_plan_graph_v1 draft and then
 * child_task nodes are materialized into real child tasks.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, subtasks: providedSubtasks } = body as {
      taskId?: string;
      subtasks?: Array<{
        title: string;
        description?: string;
        priority?: string;
        estimatedMinutes?: number;
        order?: number;
        dependsOnPrevious?: boolean;
      }>;
    };

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    let decompositionResult;
    if (providedSubtasks && Array.isArray(providedSubtasks) && providedSubtasks.length > 0) {
      const orderedSubtasks = [...providedSubtasks]
        .map((subtask, index) => ({
          ...subtask,
          order: subtask.order ?? index + 1,
          dependsOnPrevious: subtask.dependsOnPrevious ?? index > 0,
        }))
        .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER));

      decompositionResult = {
        subtasks: orderedSubtasks,
        totalEstimatedMinutes: orderedSubtasks.reduce(
          (sum, subtask) => sum + (subtask.estimatedMinutes ?? 0),
          0,
        ),
        feasibilityScore: 80,
        warnings: [],
      };
    } else {
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

      decompositionResult = await decomposeTaskSmart(input);
    }

    const graphPlan = await saveTaskPlanGraph({
      workspaceId: task.workspaceId,
      taskId: task.id,
      decompositionResult: {
        ...decompositionResult,
        subtasks: decompositionResult.subtasks.map((subtask, index) => ({
          ...subtask,
          order: subtask.order ?? index + 1,
          dependsOnPrevious: subtask.dependsOnPrevious ?? index > 0,
        })),
      },
      status: "draft",
      source: "ai",
      generatedBy: "batch-decompose",
      summary: `${decompositionResult.subtasks.length} executable plan node${decompositionResult.subtasks.length === 1 ? "" : "s"}`,
    });

    const childTaskNodes = graphPlan.plan.nodes.map((node, index) => ({
      ...node,
      executionMode: "child_task" as const,
      metadata: {
        ...(node.metadata ?? {}),
        order: typeof node.metadata?.order === "number" ? node.metadata.order : index + 1,
      },
    }));

    await saveTaskPlanGraph({
      workspaceId: graphPlan.workspaceId,
      taskId: graphPlan.taskId!,
      plan: {
        ...graphPlan.plan,
        nodes: childTaskNodes,
      },
      prompt: graphPlan.prompt,
      status: graphPlan.status,
      source: graphPlan.source,
      generatedBy: graphPlan.generatedBy,
      summary: graphPlan.summary,
      changeSummary: graphPlan.changeSummary,
    });

    const materialized = await materializeTaskPlan({ taskId: task.id });
    const createdSubtasks = await db.task.findMany({
      where: { id: { in: materialized.createdTaskIds } },
      include: { projection: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(
      {
        parentTaskId: taskId,
        subtasks: createdSubtasks,
        decomposition: {
          totalEstimatedMinutes: decompositionResult.totalEstimatedMinutes,
          feasibilityScore: decompositionResult.feasibilityScore,
          warnings: decompositionResult.warnings,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to batch decompose task";
    console.error("POST /api/ai/batch-decompose error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
