import { db } from "@/lib/db";
import type { TaskPlanNodeType, TaskPlanNodeStatus, TaskPlanNodeExecutionMode } from "@chrona/contracts/ai";
import { getLatestTaskPlanGraph, saveTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

export type PlanPatchInput = {
  taskId: string;
  operation: string;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  nodePatches?: Array<{ id: string } & Record<string, unknown>>;
  deletedNodeIds?: string[];
  reorder?: string[];
  summary?: string;
};

export async function applyPlanPatchCommand(input: PlanPatchInput) {
  const { taskId, operation } = input;

  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error("Task not found");
  }

  const currentPlanGraph = await getLatestTaskPlanGraph(taskId);
  if (!currentPlanGraph) {
    throw new Error("No plan found for this task");
  }

  const plan = {
    ...currentPlanGraph.plan,
    nodes: currentPlanGraph.plan.nodes.map((n: Record<string, unknown>) => ({ ...n })) as typeof currentPlanGraph.plan.nodes,
    edges: currentPlanGraph.plan.edges.map((e: Record<string, unknown>) => ({ ...e })) as typeof currentPlanGraph.plan.edges,
  } as typeof currentPlanGraph.plan;

  switch (operation) {
    case "add_node": {
      const nodes = input.nodes;
      if (!nodes || nodes.length === 0) {
        throw new Error("add_node requires nodes[]");
      }
      const newNodes = nodes.map((n, i) => ({
        id: typeof n.id === "string" && n.id.trim() ? n.id : `node-${Date.now()}-${i}`,
        type: (typeof n.type === "string" ? n.type : "step") as TaskPlanNodeType,
        title: typeof n.title === "string" && n.title.trim() ? n.title : `Step ${plan.nodes.length + i + 1}`,
        objective: typeof n.objective === "string" && n.objective.trim() ? n.objective : (typeof n.title === "string" && n.title.trim() ? n.title : `Step ${plan.nodes.length + i + 1}`),
        description: typeof n.description === "string" && n.description.trim() ? n.description : null,
        status: "pending" as TaskPlanNodeStatus,
        phase: null as string | null,
        estimatedMinutes: typeof n.estimatedMinutes === "number" ? n.estimatedMinutes : null,
        priority: typeof n.priority === "string" ? n.priority as "Low" | "Medium" | "High" | "Urgent" | null : null,
        executionMode: (n.executionMode === "manual" || n.executionMode === "hybrid" ? n.executionMode : "automatic") as TaskPlanNodeExecutionMode,
        requiresHumanInput: Boolean(n.requiresHumanInput),
        requiresHumanApproval: Boolean(n.requiresHumanApproval),
        autoRunnable: !n.requiresHumanInput && !n.requiresHumanApproval,
        blockingReason: null,
        linkedTaskId: null as string | null,
        completionSummary: null as string | null,
        metadata: null as Record<string, unknown> | null,
      }));
      plan.nodes = [...plan.nodes, ...newNodes] as typeof plan.nodes;
      if (input.edges && input.edges.length > 0) {
        plan.edges = [...plan.edges, ...input.edges.map((e, i) => ({
          id: typeof e.id === "string" && e.id.trim() ? e.id : `edge-${Date.now()}-${i}`,
          fromNodeId: e.fromNodeId as string,
          toNodeId: e.toNodeId as string,
          type: (e.type === "depends_on" ? e.type : "sequential") as import("@chrona/contracts/ai").TaskPlanEdgeType,
          metadata: null as Record<string, unknown> | null,
        }))] as typeof plan.edges;
      }
      break;
    }
    case "update_node": {
      const nodePatches = input.nodePatches;
      if (!nodePatches || nodePatches.length === 0) {
        throw new Error("update_node requires nodePatches[]");
      }
      const existingIds = new Set(plan.nodes.map((n) => n.id));
      const unknownIds = nodePatches.map((p) => p.id).filter((id) => !existingIds.has(id));
      if (unknownIds.length > 0) {
        throw new Error(`Unknown node id(s): ${unknownIds.join(", ")}`);
      }
      const patchMap = new Map(nodePatches.map((p) => [p.id, p]));
      plan.nodes = plan.nodes.map((node) => {
        const patch = patchMap.get(node.id);
        if (!patch) return node;
        return {
          ...node,
          ...(typeof patch.title === "string" ? { title: patch.title } : {}),
          ...(typeof patch.objective === "string" ? { objective: patch.objective } : {}),
          ...(typeof patch.description === "string" ? { description: patch.description } : {}),
          ...(typeof patch.estimatedMinutes === "number" ? { estimatedMinutes: patch.estimatedMinutes } : {}),
          ...(typeof patch.status === "string" ? { status: patch.status as TaskPlanNodeStatus } : {}),
          ...(typeof patch.priority === "string" ? { priority: patch.priority as typeof node.priority } : {}),
          ...(typeof patch.executionMode === "string" ? { executionMode: patch.executionMode as TaskPlanNodeExecutionMode } : {}),
          ...(patch.requiresHumanInput !== undefined ? { requiresHumanInput: patch.requiresHumanInput as boolean, autoRunnable: !(patch.requiresHumanInput as boolean) && !(node.requiresHumanApproval ?? false) } : {}),
          ...(patch.requiresHumanApproval !== undefined ? { requiresHumanApproval: patch.requiresHumanApproval as boolean, autoRunnable: !(node.requiresHumanInput ?? false) && !(patch.requiresHumanApproval as boolean) } : {}),
        };
      }) as typeof plan.nodes;
      break;
    }
    case "delete_node": {
      const deletedNodeIds = input.deletedNodeIds;
      if (!deletedNodeIds || deletedNodeIds.length === 0) {
        throw new Error("delete_node requires deletedNodeIds[]");
      }
      const deleteSet = new Set(deletedNodeIds);
      plan.nodes = plan.nodes.filter((n) => !deleteSet.has(n.id));
      plan.edges = plan.edges.filter(
        (e) => !deleteSet.has(e.fromNodeId) && !deleteSet.has(e.toNodeId),
      );
      break;
    }
    case "update_dependencies": {
      const edges = input.edges;
      if (!edges || edges.length === 0) {
        throw new Error("update_dependencies requires edges[]");
      }
      const existingIds = new Set(plan.nodes.map((n) => n.id));
      const missingFrom = edges.filter((e) => !existingIds.has(e.fromNodeId as string));
      const missingTo = edges.filter((e) => !existingIds.has(e.toNodeId as string));
      if (missingFrom.length > 0) {
        throw new Error(`Unknown fromNodeId(s): ${missingFrom.map((e) => e.fromNodeId).join(", ")}`);
      }
      if (missingTo.length > 0) {
        throw new Error(`Unknown toNodeId(s): ${missingTo.map((e) => e.toNodeId).join(", ")}`);
      }
      const newEdgeIds = new Set(edges.map((e) => `${e.fromNodeId}->${e.toNodeId}`));
      plan.edges = [
        ...plan.edges.filter((e) => !newEdgeIds.has(`${e.fromNodeId}->${e.toNodeId}`)),
        ...edges.map((e, i) => ({
          id: typeof e.id === "string" && e.id.trim() ? e.id : `edge-${Date.now()}-${i}`,
          fromNodeId: e.fromNodeId as string,
          toNodeId: e.toNodeId as string,
          type: (e.type === "depends_on" ? e.type : "sequential") as import("@chrona/contracts/ai").TaskPlanEdgeType,
          metadata: null as Record<string, unknown> | null,
        })),
      ] as typeof plan.edges;
      break;
    }
    case "reorder_nodes": {
      const reorder = input.reorder;
      if (!reorder || reorder.length === 0) {
        throw new Error("reorder_nodes requires reorder[]");
      }
      const orderMap = new Map(reorder.map((id, i) => [id, i]));
      const reordered = plan.nodes
        .filter((n) => orderMap.has(n.id))
        .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
      const firstIndex = plan.nodes.findIndex((n) => orderMap.has(n.id));
      const insertAt = firstIndex >= 0 ? firstIndex : plan.nodes.length;
      const kept = plan.nodes.filter((n) => !orderMap.has(n.id));
      plan.nodes = [...kept.slice(0, insertAt), ...reordered, ...kept.slice(insertAt)];
      break;
    }
    case "update_plan_summary": {
      if (input.summary !== undefined) {
        plan.summary = input.summary;
      }
      break;
    }
    default:
      throw new Error(`Unsupported plan operation: ${operation}`);
  }

  const savedPlan = await saveTaskPlanGraph({
    workspaceId: task.workspaceId,
    taskId,
    plan,
    prompt: currentPlanGraph.prompt,
    status: currentPlanGraph.status,
    source: "mixed",
    generatedBy: currentPlanGraph.generatedBy,
    summary: plan.summary ?? currentPlanGraph.summary,
    changeSummary: `Applied plan patch: ${operation}`,
  });

  return {
    taskId,
    operation,
    planGraph: savedPlan.plan,
  };
}
