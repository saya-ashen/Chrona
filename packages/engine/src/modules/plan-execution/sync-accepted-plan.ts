import type { RuntimeLayer } from "@chrona/contracts/ai";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import { getAcceptedCompiledPlan } from "./compiled-plan-store";
import { getLayers, getPlanRun, savePlanRun } from "./plan-run-store";
import { createPlanRunFromCompiledPlan } from "./plan-runner";
import { db } from "@/lib/db";

function mapRunStatusToNodeStatus(runStatus: string | null): string | null {
  if (!runStatus) return null;
  switch (runStatus) {
    case "Running":
      return "running";
    case "WaitingForInput":
      return "waiting_for_user";
    case "WaitingForApproval":
      return "waiting_for_approval";
    case "Completed":
      return "completed";
    case "Failed":
      return "failed";
    case "Cancelled":
      return "skipped";
    case "Pending":
      return "pending";
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
  const layers = await getLayers(input.taskId, planId);
  const planRun = await getPlanRun(input.taskId, planId);

  const effective = resolveEffectivePlanGraph(saved.compiledPlan, layers);

  const linkedNodeIds = effective.nodes
    .filter((n) => typeof n.linkedTaskId === "string" && n.linkedTaskId.length > 0)
    .map((n) => ({ nodeId: n.id, linkedTaskId: n.linkedTaskId as string }));

  const childRunStatuses = new Map<string, string | null>();
  if (linkedNodeIds.length > 0) {
    const linkedTaskIds = [...new Set(linkedNodeIds.map((n) => n.linkedTaskId))];
    const linkedTasks = await db.task.findMany({
      where: { id: { in: linkedTaskIds } },
      select: {
        id: true,
        latestRunId: true,
        runs: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      },
    });
    for (const task of linkedTasks) {
      const latestRun = task.runs[0];
      childRunStatuses.set(task.id, latestRun?.status ?? null);
    }
  }

  const nodeStatuses: Record<string, { status: string }> = {};
  for (const node of effective.nodes) {
    if (typeof node.linkedTaskId === "string" && node.linkedTaskId.length > 0) {
      const childRunStatus = childRunStatuses.get(node.linkedTaskId);
      const mappedStatus = mapRunStatusToNodeStatus(childRunStatus ?? null);
      if (mappedStatus) {
        nodeStatuses[node.id] = { status: mappedStatus };
        continue;
      }
    }
    nodeStatuses[node.id] = { status: node.status };
  }

  const syncLayer: RuntimeLayer = {
    type: "runtime",
    planId,
    timestamp: new Date().toISOString(),
    layerId: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: layers.length + 1,
    active: true,
    source: "system",
    nodeStates: nodeStatuses as RuntimeLayer["nodeStates"],
  };

  const updatedLayers = [...layers, syncLayer];

  if (planRun) {
    await savePlanRun({
      workspaceId: saved.workspaceId,
      taskId: input.taskId,
      planId,
      run: planRun.planRun,
      layers: updatedLayers,
    });
  } else {
    await savePlanRun({
      workspaceId: saved.workspaceId,
      taskId: input.taskId,
      planId,
      run: createPlanRunFromCompiledPlan(saved.compiledPlan, updatedLayers),
      layers: updatedLayers,
    });
  }
}
