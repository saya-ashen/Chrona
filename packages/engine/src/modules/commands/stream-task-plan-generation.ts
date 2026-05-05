import { db } from "@/lib/db";
import { aiGeneratePlanStream } from "@/modules/ai/ai-service";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import { resolveRuntimeAdapterKey } from "@/modules/task-execution/registry";
import { getLatestCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { getLayers } from "@/modules/plan-execution/plan-run-store";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import type { TaskPlanGraphResponse } from "@chrona/contracts";

type TaskPlanGenerationStreamEvent =
  | { type: "status"; message: string }
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; result: unknown }
  | { type: "partial"; text: string }
  | { type: "result"; response: TaskPlanGraphResponse & Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "done" };

function buildSavedPlanSummary(savedPlan: {
  memoryId: string;
  compiledPlan: { editablePlanId: string; sourceVersion: number };
  status: string;
  prompt: string | null;
  summary: string | null;
  updatedAt?: string;
}) {
  return {
    id: savedPlan.compiledPlan.editablePlanId || savedPlan.memoryId,
    status: savedPlan.status,
    prompt: savedPlan.prompt,
    revision: savedPlan.compiledPlan.sourceVersion ?? 1,
    summary: savedPlan.summary,
    updatedAt: savedPlan.updatedAt,
  };
}

export async function* streamTaskPlanGeneration(input: {
  taskId: string;
  forceRefresh?: boolean;
}): AsyncGenerator<TaskPlanGenerationStreamEvent> {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    include: {
      workBlocks: {
        where: { status: { in: ["Scheduled", "Active"] } },
        orderBy: { scheduledStartAt: "asc" },
        take: 1,
      },
    },
  });

  if (!task) {
    throw new Error("Task not found");
  }

  const taskSessionKey = (
    await ensureDefaultTaskSession({
      taskId: task.id,
      taskTitle: task.title,
      runtimeName: resolveRuntimeAdapterKey({ runtimeAdapterKey: task.runtimeAdapterKey }),
      defaultSessionId: task.defaultSessionId,
    })
  ).sessionKey;

  if (!input.forceRefresh) {
    const savedCompiled = await getLatestCompiledPlan(task.id);
    if (savedCompiled) {
      const layers = await getLayers(task.id, savedCompiled.compiledPlan.editablePlanId);
      const effectivePlanGraph = resolveEffectivePlanGraph(savedCompiled.compiledPlan, layers);
      yield {
        type: "result",
        response: {
          plan: {
            title: savedCompiled.summary ?? task.title,
            goal: task.description ?? task.title,
            nodes: [],
            edges: [],
          },
          compiledPlan: savedCompiled.compiledPlan,
          planGraph: effectivePlanGraph,
          savedPlan: buildSavedPlanSummary(savedCompiled),
          source: "saved",
          taskSessionKey,
        },
      };
      yield { type: "done" };
      return;
    }
  }

  const currentWorkBlock = task.workBlocks[0] ?? null;
  const estimatedMinutes = currentWorkBlock?.scheduledStartAt && currentWorkBlock.scheduledEndAt
    ? Math.round((currentWorkBlock.scheduledEndAt.getTime() - currentWorkBlock.scheduledStartAt.getTime()) / 60000)
    : undefined;

  for await (const event of aiGeneratePlanStream({
    taskId: task.id,
    title: task.title,
    description: task.description ?? undefined,
    estimatedMinutes,
    sessionKey: taskSessionKey,
    workspaceId: task.workspaceId,
  })) {
    switch (event.type) {
      case "status":
        yield { type: "status", message: event.message };
        break;
      case "tool_call":
        yield { type: "tool_call", tool: event.tool, input: event.input };
        break;
      case "tool_result":
        yield { type: "tool_result", tool: event.tool, result: event.result };
        break;
      case "partial":
        yield { type: "partial", text: event.text };
        break;
      case "result":
        if ("plan" in event) {
          yield {
            type: "result",
            response: {
              plan: event.plan.blueprint,
              compiledPlan: event.compiledPlan as TaskPlanGraphResponse["compiledPlan"],
              planGraph: event.compiledPlan,
              savedPlan: event.savedPlan,
              source: event.source,
              taskSessionKey: event.taskSessionKey,
            },
          };
        }
        break;
      case "error":
        yield { type: "error", message: event.message };
        return;
      case "done":
        yield { type: "done" };
        return;
    }
  }
}
