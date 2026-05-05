import type {
  PlanPatch,
  PlanPatchOperation,
  StructuralLayer,
  StructuralOperation,
  RuntimeLayer,
  EditablePlan,
  EditableTaskNode,
  EffectivePlanNode,
  EffectivePlanGraph,
  NodeRuntimeStatus,
  NodeRuntimeState,
  PlanOverlayLayer,
} from "@chrona/contracts/ai";

import { applyPlanPatch as domainApplyPlanPatch } from "@chrona/domain/plan/patch";
import { compileEditablePlan, resolveEffectivePlanGraph } from "@chrona/domain";
import { getEditablePlan } from "./compiled-plan-store";
import type { SavedCompiledPlan } from "./compiled-plan-store";

export type ApplyPlanPatchResult = {
  newLayers: PlanOverlayLayer[];
};

function convertPatchOpToStructuralOp(
  op: PlanPatch["operations"][number],
): StructuralOperation {
  switch (op.op) {
    case "add_node": {
      const node = op.node as unknown as Record<string, unknown>;
      return {
        op: "add_node" as const,
        nodeId: `new_${typeof node.id === "string" ? node.id : ""}`,
        localId: typeof node.id === "string" ? node.id : "",
        type: (typeof node.type === "string" ? node.type : "task") as "task" | "checkpoint" | "condition" | "wait",
        title: typeof node.title === "string" ? node.title : "",
        config: (node as Record<string, unknown>).config as EffectivePlanNode["config"],
        executor: typeof node.executor === "string" ? node.executor as "system" | "user" | "ai" : undefined,
        mode: typeof node.mode === "string" ? node.mode as "manual" | "auto" | "assist" : undefined,
        estimatedMinutes: typeof node.estimatedMinutes === "number" ? node.estimatedMinutes : undefined,
      };
    }
    case "add_edge": {
      return {
        op: "add_edge" as const,
        from: op.edge.from,
        to: op.edge.to,
      };
    }
    case "delete_node": {
      return {
        op: "delete_node" as const,
        nodeId: op.nodeId,
      };
    }
    case "delete_edge": {
      return {
        op: "delete_edge" as const,
        from: op.from,
        to: op.to,
      };
    }
    case "update_node": {
      const patch = op.patch as Record<string, unknown>;
      return {
        op: "update_node" as const,
        nodeId: op.nodeId,
        patch,
      };
    }
    case "replace_subgraph": {
      const addNodes = op.addNodes.map((node) => {
        const n = node as unknown as Record<string, unknown>;
        return {
          op: "add_node" as const,
          nodeId: `new_${typeof n.id === "string" ? n.id : ""}`,
          localId: typeof n.id === "string" ? n.id : "",
          type: (typeof n.type === "string" ? n.type : "task") as "task" | "checkpoint" | "condition" | "wait",
          title: typeof n.title === "string" ? n.title : "",
          config: (n as Record<string, unknown>).config as EffectivePlanNode["config"],
          executor: typeof n.executor === "string" ? n.executor as "system" | "user" | "ai" : undefined,
          mode: typeof n.mode === "string" ? n.mode as "manual" | "auto" | "assist" : undefined,
          estimatedMinutes: typeof n.estimatedMinutes === "number" ? n.estimatedMinutes : undefined,
        };
      });
      return {
        op: "replace_subgraph" as const,
        removeNodeIds: op.removeNodeIds,
        addEdges: op.addEdges,
        addNodes,
      };
    }
    default:
      throw new Error(`Unknown patch operation: ${(op as { op: string }).op}`);
  }
}

function buildStatusCarryForward(
  effectiveGraph: EffectivePlanGraph,
  appliedOperationIds: Set<string>,
): Record<string, Pick<NodeRuntimeState, "status"> & Partial<Pick<NodeRuntimeState, "attempts" | "lastError" | "startedAt" | "completedAt">>> {
  const nodeStates: Record<string, Pick<NodeRuntimeState, "status"> & Partial<Pick<NodeRuntimeState, "attempts" | "lastError" | "startedAt" | "completedAt">>> = {};
  for (const node of effectiveGraph.nodes) {
    if (appliedOperationIds.has(node.id)) continue;
    if (appliedOperationIds.has(node.localId)) continue;
    nodeStates[node.id] = { status: node.status as NodeRuntimeStatus };
  }
  return nodeStates;
}

export async function applyPlanPatch(input: {
  taskId: string;
  effectiveGraph: EffectivePlanGraph;
  compiledPlanId: string;
  patch: PlanPatch;
  source: "user" | "ai" | "system";
}): Promise<ApplyPlanPatchResult> {
  const editablePlan = await getEditablePlan(input.taskId);
  if (!editablePlan) {
    throw new Error("No EditablePlan found for task");
  }

  const planId = input.effectiveGraph.planId;
  const appliedOperationIds = new Set(
    input.patch.operations
      .filter((op) => "nodeId" in op)
      .map((op) => (op as { nodeId: string }).nodeId),
  );

  const result = domainApplyPlanPatch(editablePlan, input.patch);
  if (!result.ok) {
    throw new Error(`Failed to apply plan patch: ${result.error}`);
  }

  const newCompiled = compileEditablePlan(result.plan!);

  const structuralLayer: StructuralLayer = {
    type: "structural",
    planId: newCompiled.editablePlanId,
    timestamp: new Date().toISOString(),
    layerId: `struct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    active: true,
    source: input.source,
    operations: input.patch.operations.map(convertPatchOpToStructuralOp),
  };

  const nodeStates = buildStatusCarryForward(input.effectiveGraph, appliedOperationIds);
  const statusLayer: RuntimeLayer = {
    type: "runtime",
    planId: newCompiled.editablePlanId,
    timestamp: new Date().toISOString(),
    layerId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    active: true,
    source: input.source,
    nodeStates,
  };

  return {
    newLayers: [structuralLayer, statusLayer],
  };
}
