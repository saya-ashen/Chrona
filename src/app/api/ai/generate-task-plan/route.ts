import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiGeneratePlan } from "@/modules/ai/ai-service";
import {
  getLatestTaskPlanGraph,
  saveTaskPlanGraph,
} from "@/modules/tasks/task-plan-graph-store";
import type { TaskPlanGraph } from "@/modules/ai/types";

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      taskId,
      title,
      description,
      priority: _priority,
      dueAt: _dueAt,
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
      if (savedPlan) {
        return NextResponse.json({
          source: "saved",
          planGraph: savedPlan.plan,
          savedPlan: buildSavedPlanSummary(savedPlan),
        });
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

    const planResult = await aiGeneratePlan({
      taskId: taskId ?? "",
      title: resolvedTitle,
      description: resolvedDescription,
      estimatedMinutes: resolvedEstimatedMinutes,
    });

    if (!planResult) {
      return NextResponse.json(
        { error: "AI planning unavailable" },
        { status: 503 },
      );
    }

    const now = new Date().toISOString();
    const plan: TaskPlanGraph = {
      id: `graph-${taskId ?? "adhoc"}-${Date.now()}`,
      taskId: taskId ?? "",
      status: "draft",
      revision: 1,
      source: "ai",
      generatedBy: planResult.source ?? "ai",
      prompt: planningPrompt ?? null,
      summary: planResult.summary,
      changeSummary: null,
      createdAt: now,
      updatedAt: now,
      nodes: planResult.nodes,
      edges: planResult.edges,
    };

    if (taskId && resolvedWorkspaceId) {
      const savedPlan = await saveTaskPlanGraph({
        workspaceId: resolvedWorkspaceId,
        taskId,
        plan,
        prompt: planningPrompt ?? null,
        status: "draft",
        source: "ai",
        generatedBy: planResult.source ?? "ai",
        summary: planResult.summary,
      });

      return NextResponse.json({
        source: planResult.source,
        planGraph: savedPlan.plan,
        savedPlan: buildSavedPlanSummary(savedPlan),
        reasoning: planResult.reasoning,
      });
    }

    return NextResponse.json({
      source: planResult.source,
      planGraph: plan,
      reasoning: planResult.reasoning,
    });
  } catch (error) {
    console.error("Error generating task plan:", error);
    return NextResponse.json(
      { error: "Failed to generate task plan" },
      { status: 500 },
    );
  }
}
