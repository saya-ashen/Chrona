import type { TaskPlanGraph, PlanUpdatePatch, PlanPatch, EditablePlan } from "@chrona/contracts/ai";
import { upgradeBlueprintToEditable } from "@chrona/contracts/ai";
import { saveTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import type { SavedTaskPlanGraph } from "@chrona/contracts/ai";
import { applyPlanPatch as applyDomainPlanPatch } from "@chrona/domain";

export type ApplyPlanPatchInput = {
  taskId: string;
  patch: PlanUpdatePatch;
  currentPlan: {
    saved: SavedTaskPlanGraph;
    graph: TaskPlanGraph;
  };
};

export type ApplyPlanPatchResult = {
  success: boolean;
  updatedPlan: TaskPlanGraph;
  warnings: string[];
};

export async function applyPlanPatch(
  input: ApplyPlanPatchInput,
): Promise<ApplyPlanPatchResult> {
  const { patch, currentPlan } = input;
  const warnings: string[] = [];
  const graph = currentPlan.graph;

  const doneNodeIds = new Set(
    graph.nodes
      .filter((n) => n.status === "done" || n.status === "skipped")
      .map((n) => n.id),
  );

  const updatedGraph = structuredClone(graph);
  const patchWarnings = patch.warnings ?? [];

  switch (patch.operation) {
    case "update_node": {
      if (patch.nodePatches) {
        for (const nodePatch of patch.nodePatches) {
          const node = updatedGraph.nodes.find((n) => n.id === nodePatch.nodeId);
          if (!node) {
            warnings.push(`Node ${nodePatch.nodeId} not found, skipping update`);
            continue;
          }
          if (doneNodeIds.has(nodePatch.nodeId)) {
            warnings.push(
              `Cannot auto-update done node ${nodePatch.nodeId} — requires manual confirmation`,
            );
            continue;
          }
          const patchData = nodePatch.patch;
          if (patchData.status && typeof patchData.status === "string") {
            node.status = patchData.status as typeof node.status;
          }
          if (typeof patchData.title === "string") {
            node.title = patchData.title;
          }
          if (typeof patchData.description === "string") {
            node.description = patchData.description;
          }
          if (typeof patchData.requiresHumanInput === "boolean") {
            node.requiresHumanInput = patchData.requiresHumanInput;
          }
          if (typeof patchData.requiresHumanApproval === "boolean") {
            node.requiresHumanApproval = patchData.requiresHumanApproval;
          }
          if (typeof patchData.estimatedDurationMinutes === "number") {
            node.estimatedMinutes = patchData.estimatedDurationMinutes;
          }
          if (patchData.metadata && typeof patchData.metadata === "object") {
            node.metadata = {
              ...((node.metadata as Record<string, unknown>) ?? {}),
              ...(patchData.metadata as Record<string, unknown>),
            };
          }
          if (Array.isArray(patchData.dependsOn)) {
            const nodeId = nodePatch.nodeId;
            updatedGraph.edges = updatedGraph.edges.filter(
              (e) => e.toNodeId !== nodeId || e.type === "depends_on" || e.type === "sequential",
            );
            for (const depId of patchData.dependsOn as string[]) {
              updatedGraph.edges.push({
                id: `e-${depId}-${nodeId}-auto`,
                fromNodeId: depId,
                toNodeId: nodeId,
                type: "depends_on",
                metadata: null,
              });
            }
          }
        }
      }
      break;
    }

    case "add_node": {
      if (patch.nodes) {
        for (const newNode of patch.nodes) {
          const nodeId = newNode.id ?? `node-${updatedGraph.nodes.length + 1}-auto`;
          if (updatedGraph.nodes.some((n) => n.id === nodeId)) {
            warnings.push(`Node ${nodeId} already exists, skipping`);
            continue;
          }
          updatedGraph.nodes.push({
            id: nodeId,
            type: "task",
            title: newNode.title,
            objective: newNode.title,
            description: newNode.description ?? null,
            status: "pending",
            phase: null,
            estimatedMinutes: newNode.estimatedDurationMinutes ?? null,
            priority: null,
            executionMode: "automatic",
            requiresHumanInput: false,
            requiresHumanApproval: false,
            autoRunnable: true,
            blockingReason: null,
            linkedTaskId: null,
            completionSummary: null,
            metadata: (newNode.metadata as Record<string, unknown>) ?? null,
          });
          if (Array.isArray(newNode.dependsOn)) {
            for (const depId of newNode.dependsOn) {
              updatedGraph.edges.push({
                id: `e-${depId}-${nodeId}-auto`,
                fromNodeId: depId,
                toNodeId: nodeId,
                type: "depends_on",
                metadata: null,
              });
            }
          }
        }
      }
      break;
    }

    case "delete_node": {
      if (patch.deletedNodeIds) {
        for (const nodeId of patch.deletedNodeIds) {
          if (doneNodeIds.has(nodeId)) {
            warnings.push(
              `Cannot auto-delete done node ${nodeId} — requires manual confirmation`,
            );
            continue;
          }
          updatedGraph.nodes = updatedGraph.nodes.filter((n) => n.id !== nodeId);
          updatedGraph.edges = updatedGraph.edges.filter(
            (e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId,
          );
        }
      }
      break;
    }

    case "update_dependencies": {
      if (patch.edges) {
        for (const edge of patch.edges) {
          const existing = updatedGraph.edges.find(
            (e) => e.fromNodeId === edge.from && e.toNodeId === edge.to,
          );
          if (existing) {
            existing.type = (edge.type === "depends_on" ? "depends_on" : "sequential") as typeof existing.type;
          } else {
            updatedGraph.edges.push({
              id: `edge-auto-${edge.from}-${edge.to}`,
              fromNodeId: edge.from,
              toNodeId: edge.to,
              type: edge.type === "depends_on" ? "depends_on" : "sequential",
              metadata: null,
            });
          }
        }
      }
      break;
    }

    case "update_plan_summary": {
      if (patch.summary) {
        updatedGraph.summary = patch.summary;
      }
      break;
    }

    case "reorder_nodes": {
      if (patch.reorder) {
        for (const item of patch.reorder) {
          const idx = updatedGraph.nodes.findIndex((n) => n.id === item.nodeId);
          if (idx === -1) {
            warnings.push(`Node ${item.nodeId} not found for reorder`);
            continue;
          }
          const [moved] = updatedGraph.nodes.splice(idx, 1);
          if (moved) {
            updatedGraph.nodes.splice(item.position, 0, moved);
          }
        }
      }
      break;
    }

    case "replace_plan": {
      if (patch.nodes) {
        const preservedDone = graph.nodes.filter(
          (n) => n.status === "done" || n.status === "skipped",
        );
        const newNodes = patch.nodes.map((n) => ({
          id: n.id ?? `node-${Math.random().toString(36).slice(2, 8)}`,
          type: "task" as const,
          title: n.title,
          objective: n.title,
          description: n.description ?? null,
          status: "pending" as const,
          phase: null,
          estimatedMinutes: n.estimatedDurationMinutes ?? null,
          priority: null as ("Low" | "Medium" | "High" | "Urgent" | null),
          executionMode: "automatic" as const,
          requiresHumanInput: false,
          requiresHumanApproval: false,
          autoRunnable: true,
          blockingReason: null,
          linkedTaskId: null,
          completionSummary: null,
          metadata: (n.metadata as Record<string, unknown>) ?? null,
        }));
        const doneNodeIdSet = new Set(preservedDone.map((n) => n.id));
        const filteredNew = newNodes.filter((n) => !doneNodeIdSet.has(n.id));
        updatedGraph.nodes = [...preservedDone, ...filteredNew];
        updatedGraph.edges = (patch.edges ?? []).map((e) => ({
          id: `edge-${e.from}-${e.to}`,
          fromNodeId: e.from,
          toNodeId: e.to,
          type: (e.type === "depends_on" ? e.type : "sequential") as "sequential" | "depends_on",
          metadata: null,
        }));
      }
      break;
    }

    case "custom":
    default: {
      warnings.push("Custom patch operations must be manually applied");
      return { success: false, updatedPlan: graph, warnings };
    }
  }

  await saveTaskPlanGraph({
    workspaceId: currentPlan.saved.workspaceId,
    taskId: input.taskId,
    plan: updatedGraph,
    status: currentPlan.saved.status,
    source: currentPlan.saved.source,
    generatedBy: currentPlan.saved.generatedBy,
    summary: patch.summary ?? currentPlan.saved.summary,
    changeSummary: `Auto-applied patch: ${patch.operation}`,
  });

  const combinedWarnings = [...warnings, ...patchWarnings];
  return {
    success: true,
    updatedPlan: updatedGraph,
    warnings: combinedWarnings,
  };
}

/**
 * Applies a PlanPatch (EditablePlan-level patch) to the blueprint stored
 * in a TaskPlanGraph. Uses the domain-layer applyPlanPatch underneath.
 *
 * This is the new-architecture patching path. The old applyPlanPatch above
 * works on TaskPlanGraph (runtime-level) nodes directly and is deprecated.
 */
export async function applyBlueprintPatch(input: {
  taskId: string;
  currentPlan: {
    saved: SavedTaskPlanGraph;
    graph: TaskPlanGraph;
  };
  patch: PlanPatch;
}): Promise<{
  success: boolean;
  updatedEditablePlan?: EditablePlan;
  error?: string;
  warnings: string[];
}> {
  const { currentPlan, patch } = input;
  const blueprint = currentPlan.graph.blueprint;

  if (!blueprint || blueprint.nodes.length === 0) {
    return {
      success: false,
      error: "No editable blueprint found in current plan graph",
      warnings: [],
    };
  }

  const editable = upgradeBlueprintToEditable(
    blueprint,
    patch.basePlanId,
    currentPlan.graph.revision,
  );

  const result = applyDomainPlanPatch(editable, patch);

  if (!result.ok) {
    return {
      success: false,
      error: result.error ?? "Patch application failed",
      warnings: result.validation?.warnings?.map((w) => w.message) ?? [],
    };
  }

  // Store the updated blueprint back into the graph
  const updatedGraph = structuredClone(currentPlan.graph);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  updatedGraph.blueprint = {
    title: result.plan!.title,
    goal: result.plan!.goal,
    assumptions: result.plan!.assumptions,
    nodes: result.plan!.nodes as unknown as NonNullable<typeof updatedGraph.blueprint>["nodes"],
    edges: result.plan!.edges as unknown as NonNullable<typeof updatedGraph.blueprint>["edges"],
  };
  updatedGraph.revision = result.plan!.version;
  updatedGraph.summary = result.plan!.title;
  updatedGraph.updatedAt = new Date().toISOString();

  await saveTaskPlanGraph({
    workspaceId: currentPlan.saved.workspaceId,
    taskId: input.taskId,
    plan: updatedGraph,
    status: currentPlan.saved.status,
    source: currentPlan.saved.source,
    generatedBy: currentPlan.saved.generatedBy,
    summary: updatedGraph.summary,
    changeSummary: `Blueprint patch: ${patch.rationale ?? "no rationale provided"}`,
  });

  return {
    success: true,
    updatedEditablePlan: result.plan,
    warnings: [],
  };
}
