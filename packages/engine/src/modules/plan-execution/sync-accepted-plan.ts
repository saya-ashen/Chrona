import { db } from "@/lib/db";
import { resolveSavedPlanEffectiveGraph } from "@/modules/queries/task-plan-read-model";
import type { NodeResult } from "@chrona/contracts/ai";
import { getAcceptedCompiledPlan } from "./compiled-plan-store";
import { createPlanGraphFromCompiledPlan, getPlanRun, savePlanRun } from "./plan-run-store";
import { createPlanRunFromCompiledPlan } from "./plan-runner";

function mapRunStatusToNodeUpdate(runStatus: string | null): {
  waitKind?: NodeResult["waitKind"];
  status: NonNullable<NodeResult["status"]>;
  error?: string;
} | null {
  if (!runStatus) return null;
  switch (runStatus) {
    case "Running":
      return null;
    case "WaitingForInput":
      return { status: "current", waitKind: "user_input" };
    case "WaitingForApproval":
      return { status: "current", waitKind: "approval" };
    case "Completed":
      return { status: "current" };
    case "Failed":
      return { status: "rejected", error: "Linked task failed" };
    case "Cancelled":
      return { status: "invalidated", error: "Linked task cancelled" };
    case "Pending":
      return null;
    default:
      return null;
  }
}

export async function syncAcceptedTaskPlanForTask(input: {
  taskId: string;
}): Promise<void> {
  const saved = await getAcceptedCompiledPlan(input.taskId);
  if (!saved) return;

  const planId = saved.compiledPlan.editablePlanId;
  const persisted = await getPlanRun(input.taskId, planId);
  const graph =
    persisted?.graph ??
    createPlanGraphFromCompiledPlan({
      taskId: input.taskId,
      compiledPlan: saved.compiledPlan,
    });

  const effective = await resolveSavedPlanEffectiveGraph(saved);
  const linkedNodeIds = effective.nodes
    .filter((node) => typeof node.linkedTaskId === "string" && node.linkedTaskId.length > 0)
    .map((node) => ({
      nodeId: node.id,
      linkedTaskId: node.linkedTaskId as string,
      activeLayerId: node.activeLayerId,
      title: node.title,
    }));

  const childRunStatuses = new Map<string, string | null>();
  if (linkedNodeIds.length > 0) {
    const linkedTaskIds = [...new Set(linkedNodeIds.map((node) => node.linkedTaskId))];
    const linkedTasks = await db.task.findMany({
      where: { id: { in: linkedTaskIds } },
      select: {
        id: true,
        runs: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      },
    });
    for (const task of linkedTasks) {
      childRunStatuses.set(task.id, task.runs[0]?.status ?? null);
    }
  }

  let results = persisted?.results ?? [];
  for (const node of linkedNodeIds) {
    const update = mapRunStatusToNodeUpdate(childRunStatuses.get(node.linkedTaskId) ?? null);
    if (!update || !node.activeLayerId) {
      continue;
    }
    results = results.map((result) =>
      result.nodeId === node.nodeId && result.status === "current"
        ? { ...result, status: "stale" }
        : result,
    );
    results.push({
      id: `result_${graph.id}_${node.nodeId}_${Date.now()}`,
      taskId: input.taskId,
      graphId: graph.id,
      nodeId: node.nodeId,
      nodeLayerId: node.activeLayerId,
      status: update.status,
      waitKind: update.waitKind,
      error: update.error,
      outputSummary: update.status === "current" && !update.waitKind ? `${node.title} completed` : undefined,
    });
  }

  await savePlanRun({
    workspaceId: saved.workspaceId,
    taskId: input.taskId,
    planId,
    run: persisted?.planRun ?? createPlanRunFromCompiledPlan(saved.compiledPlan),
    compiledPlan: saved.compiledPlan,
    graph,
    attempts: persisted?.attempts ?? [],
    results,
    executionContextSnapshots: persisted?.executionContextSnapshots ?? [],
  });
}
