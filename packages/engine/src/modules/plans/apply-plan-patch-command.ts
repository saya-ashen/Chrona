import { db } from "@/lib/db";
import { getLatestCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import {
  createPlanGraphFromCompiledPlan,
  getPlanRun,
  savePlanRun,
} from "@/modules/plan-execution/plan-run-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution";
import {
  analyzeStructuralChangeImpact,
  applyDownstreamInvalidation,
  applyGraphMutation,
} from "@chrona/graph-runtime";
import type {
  EditableNode,
  EditableTaskNode,
  GraphMutationOperation,
  GraphMutationRequest,
  NodeDefinition,
  NodeResult,
  PlanGraph,
} from "@chrona/contracts/ai";
import type { GraphExecutionState, GraphMutationOperation as RuntimeGraphMutationOperation } from "@chrona/graph-runtime";

type PlanPatchInput = {
  taskId: string;
  operation: string;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  nodePatches?: Array<{ id: string } & Record<string, unknown>>;
  deletedNodeIds?: string[];
  reorder?: string[];
  summary?: string;
};

function rawToTaskNode(raw: Record<string, unknown>, id: string): EditableTaskNode {
  return {
    id,
    type: "task",
    title: (typeof raw.title === "string" ? raw.title : id) as string,
    executor: (typeof raw.executionMode === "string" && raw.executionMode === "manual" ? "user" : "ai") as "ai" | "user",
    mode: (typeof raw.executionMode === "string" && raw.executionMode === "manual"
      ? "manual"
      : typeof raw.executionMode === "string" && raw.executionMode === "hybrid"
        ? "assist"
        : "auto") as "auto" | "assist" | "manual",
    ...(typeof raw.estimatedMinutes === "number" ? { estimatedMinutes: raw.estimatedMinutes } : {}),
    ...(typeof raw.objective === "string" ? { expectedOutput: raw.objective } : {}),
  };
}

function editableNodeToDefinition(node: EditableNode): NodeDefinition {
  switch (node.type) {
    case "checkpoint":
      return {
        title: node.title,
        objective: node.prompt,
        semantics: {
          type: "checkpoint",
          metadata: {
            checkpointType: node.checkpointType,
            required: node.required,
            options: node.options,
            inputFields: node.inputFields,
          },
        },
      };
    case "condition":
      return {
        title: node.title,
        objective: node.condition,
        semantics: {
          type: "condition",
          metadata: {
            evaluationBy: node.evaluationBy,
            branches: node.branches,
            defaultNextNodeId: node.defaultNextNodeId,
          },
        },
      };
    case "wait":
      return {
        title: node.title,
        objective: node.waitFor,
        estimatedMinutes: node.estimatedMinutes,
        semantics: {
          type: "wait",
          metadata: {
            timeout: node.timeout,
          },
        },
      };
    case "task":
    default:
      return {
        title: node.title,
        objective: node.expectedOutput ?? node.title,
        estimatedMinutes: node.estimatedMinutes,
        executor: node.executor,
        semantics: {
          type: "task",
          mode: node.mode,
          metadata: {
            completionCriteria: node.completionCriteria,
          },
        },
      };
  }
}

function markCurrentResults(
  results: NodeResult[],
  nodeIds: string[],
  nextStatus: NonNullable<NodeResult["status"]>,
): NodeResult[] {
  const targetIds = new Set(nodeIds);
  return results.map((result) =>
    result.nodeId && targetIds.has(result.nodeId) && result.status === "current"
      ? { ...result, status: nextStatus }
      : result,
  );
}

async function ensureGraphRuntime(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error("Task not found");
  }
  const saved = await getLatestCompiledPlan(taskId);
  if (!saved) {
    throw new Error("No plan found for this task");
  }
  const persisted = await getPlanRun(taskId, saved.compiledPlan.editablePlanId);
  return {
    task,
    saved,
    persisted,
    graph:
      structuredClone(
        persisted?.graph ??
          createPlanGraphFromCompiledPlan({ taskId, compiledPlan: saved.compiledPlan }),
      ),
    attempts: structuredClone(persisted?.attempts ?? []),
    results: structuredClone(persisted?.results ?? []),
    executionContextSnapshots: structuredClone(persisted?.executionContextSnapshots ?? []),
  };
}

export async function applyPlanMutationCommand(input: {
  taskId: string;
  mutation: GraphMutationRequest;
}) {
  const state = await ensureGraphRuntime(input.taskId);
  const graph = state.graph as unknown as GraphExecutionState["graph"];
  const operations = input.mutation.operations as unknown as RuntimeGraphMutationOperation[];
  const mutationId = `mutation_${graph.id}_${Date.now()}`;

  if (input.mutation.expectedGraphId && input.mutation.expectedGraphId !== graph.id) {
    throw new Error(`Graph mismatch: expected ${input.mutation.expectedGraphId}, got ${graph.id}`);
  }
  if (
    input.mutation.expectedRevision !== undefined &&
    input.mutation.expectedRevision !== graph.mutations.length
  ) {
    throw new Error(`Graph revision mismatch: expected ${input.mutation.expectedRevision}, got ${graph.mutations.length}`);
  }

  const impact = analyzeStructuralChangeImpact({ graph, operations });
  const mutationResult = applyGraphMutation({
    graph,
    operations,
    reason: input.mutation.reason,
    createdBy: "user",
    mutationId,
  });
  const invalidationPlan = {
    rootNodeIds: impact.affectedNodeIds,
    invalidatedNodeIds: impact.invalidatedNodeIds,
    reason: input.mutation.reason,
  };
  let runtimeState: GraphExecutionState = {
    graph: mutationResult.graph,
    attempts: state.attempts as unknown as GraphExecutionState["attempts"],
    results: markCurrentResults(state.results, impact.affectedNodeIds, "obsolete") as unknown as GraphExecutionState["results"],
    executionContextSnapshots: state.executionContextSnapshots as unknown as GraphExecutionState["executionContextSnapshots"],
  };
  runtimeState = applyDownstreamInvalidation({
    state: runtimeState,
    plan: invalidationPlan,
    mutationId,
    now: mutationResult.mutation.createdAt,
  });

  const graphWithInvalidation = {
    ...runtimeState.graph,
    mutations: runtimeState.graph.mutations.map((mutation) =>
      mutation.id === mutationId
        ? { ...mutation, invalidatedNodeIds: invalidationPlan.invalidatedNodeIds }
        : mutation,
    ),
  };

  await savePlanRun({
    workspaceId: state.task.workspaceId,
    taskId: input.taskId,
    planId: state.saved.compiledPlan.editablePlanId,
    run: state.persisted?.planRun ?? createPlanRunFromCompiledPlan(state.saved.compiledPlan),
    compiledPlan: state.saved.compiledPlan,
    graph: graphWithInvalidation as unknown as PlanGraph,
    attempts: runtimeState.attempts as unknown as typeof state.attempts,
    results: runtimeState.results as unknown as typeof state.results,
    executionContextSnapshots: runtimeState.executionContextSnapshots as unknown as typeof state.executionContextSnapshots,
  });

  return {
    taskId: input.taskId,
    graphId: graph.id,
    revision: graphWithInvalidation.mutations.length,
    affectedNodeIds: impact.affectedNodeIds,
    invalidatedNodeIds: invalidationPlan.invalidatedNodeIds,
  };
}

function toGraphMutationOperation(input: {
  operation: PlanPatchInput["operation"];
  taskId: string;
  nodes?: PlanPatchInput["nodes"];
  edges?: PlanPatchInput["edges"];
  nodePatches?: PlanPatchInput["nodePatches"];
  deletedNodeIds?: PlanPatchInput["deletedNodeIds"];
}): GraphMutationOperation[] {
  switch (input.operation) {
    case "add_node":
      return (input.nodes ?? []).map((raw, index) => {
        const nodeId = typeof raw.id === "string" && raw.id.trim() ? raw.id : `node-${Date.now()}-${index}`;
        const editableNode = rawToTaskNode(raw, nodeId);
        return {
          type: "add_node",
          nodeId,
          semanticKey: nodeId,
          definitionLayer: {
            id: `definition_${nodeId}_${Date.now()}`,
            nodeId,
            type: "definition",
            createdAt: new Date().toISOString(),
            createdBy: "user",
            definition: editableNodeToDefinition(editableNode),
          },
        } satisfies GraphMutationOperation;
      });
    case "update_node":
      return (input.nodePatches ?? []).map((patch) => ({
        type: "push_node_layer",
        nodeId: patch.id,
        layer: {
          id: `definition_${patch.id}_${Date.now()}`,
          nodeId: patch.id,
          type: "definition",
          createdAt: new Date().toISOString(),
          createdBy: "user",
          definition: {
            title: typeof patch.title === "string" ? patch.title : patch.id,
            objective: typeof patch.objective === "string" ? patch.objective : patch.id,
            description: typeof patch.description === "string" ? patch.description : undefined,
            estimatedMinutes: typeof patch.estimatedMinutes === "number" ? patch.estimatedMinutes : undefined,
            semantics: {
              type: "task",
            },
          },
        },
      }));
    case "delete_node":
      return (input.deletedNodeIds ?? []).map((nodeId) => ({ type: "delete_node", nodeId }));
    case "update_dependencies":
      return (input.edges ?? []).map((edge, index) => ({
        type: "add_edge",
        edge: {
          id: `edge_${Date.now()}_${index}`,
          fromNodeId: edge.fromNodeId as string,
          toNodeId: edge.toNodeId as string,
          type: "hard_dependency",
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }));
    default:
      return [];
  }
}

export async function applyPlanPatchCommand(input: PlanPatchInput) {
  const operations = toGraphMutationOperation({
    operation: input.operation,
    taskId: input.taskId,
    nodes: input.nodes,
    edges: input.edges,
    nodePatches: input.nodePatches,
    deletedNodeIds: input.deletedNodeIds,
  });

  if (operations.length === 0 && input.operation !== "update_plan_summary") {
    throw new Error(`Unsupported plan operation: ${input.operation}`);
  }

  const result = await applyPlanMutationCommand({
    taskId: input.taskId,
    mutation: {
      reason: input.summary ?? `Applied plan operation: ${input.operation}`,
      operations,
      scope: "future_only",
    },
  });

  return {
    operation: input.operation,
    ...result,
  };
}
