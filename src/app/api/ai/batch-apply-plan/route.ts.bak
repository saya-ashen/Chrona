import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { materializeTaskPlan } from "@/modules/commands/materialize-task-plan";
import { saveTaskPlanGraph, getLatestTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import type { TaskPlanGraph, TaskPlanNode, TaskPlanEdge } from "@/modules/ai/types";

/**
 * POST /api/ai/batch-apply-plan — Accept and materialize a task plan graph.
 * Body: { taskId, nodes?, edges? }
 *
 * If `nodes`/`edges` are provided, saves them as the new graph.
 * Otherwise uses the latest saved graph.
 * Then materializes executable nodes into real child tasks.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, nodes: providedNodes, edges: providedEdges } = body as {
      taskId?: string;
      nodes?: TaskPlanNode[];
      edges?: TaskPlanEdge[];
    };

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    let graphPlan;

    if (providedNodes && Array.isArray(providedNodes) && providedNodes.length > 0) {
      const now = new Date().toISOString();
      const plan: TaskPlanGraph = {
        id: `graph-${taskId}-${Date.now()}`,
        taskId,
        status: "draft",
        revision: 1,
        source: "ai",
        generatedBy: "batch-apply",
        prompt: null,
        summary: `${providedNodes.length} planned step${providedNodes.length === 1 ? "" : "s"}`,
        changeSummary: null,
        createdAt: now,
        updatedAt: now,
        nodes: providedNodes,
        edges: providedEdges ?? [],
      };

      graphPlan = await saveTaskPlanGraph({
        workspaceId: task.workspaceId,
        taskId: task.id,
        plan,
        status: "draft",
        source: "ai",
        generatedBy: "batch-apply",
        summary: plan.summary,
      });
    } else {
      graphPlan = await getLatestTaskPlanGraph(taskId);
      if (!graphPlan) {
        return NextResponse.json({ error: "No plan found for task" }, { status: 404 });
      }
    }

    const materialized = await materializeTaskPlan({ taskId: task.id });
    const createdTasks = await db.task.findMany({
      where: { id: { in: materialized.createdTaskIds } },
      include: { projection: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(
      {
        parentTaskId: taskId,
        childTasks: createdTasks,
        planGraph: graphPlan.plan,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply task plan";
    console.error("POST /api/ai/batch-apply-plan error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
