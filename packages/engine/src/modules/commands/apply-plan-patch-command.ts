import { db } from "@/lib/db";
import { getLatestCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import {
  createPlanGraphFromCompiledPlan,
  getPlanRun,
  savePlanRun,
} from "@/modules/plan-execution/plan-run-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution/plan-runner";
import type {
  EditableCheckpointNode,
  EditableConditionNode,
  EditableNode,
  EditableTaskNode,
  EditableWaitNode,
  GraphMutationOperation,
  GraphMutationRequest,
  NodeDefinition,
  NodeResult,
  PlanEdge,
  PlanGraph,
} from "@chrona/contracts/ai";

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

function nodeDefinitionToEditablePatch(definition: NodeDefinition): Partial<EditableNode> {
  return {
    title: definition.title,
    description: definition.description,
    estimatedMinutes: definition.estimatedMinutes,
    ...(definition.semantics.type === "task"
      ? { expectedOutput: definition.objective }
      : {}),
  } as Partial<EditableNode>;
}

function collectDownstreamNodeIds(graph: PlanGraph, startNodeIds: string[]): string[] {
  const activeEdges = graph.edges.filter(
    (edge) => edge.active && (edge.type === "hard_dependency" || edge.type === "ordering"),
  );
  const queue = [...startNodeIds];
  const seen = new Set(startNodeIds);
  const descendants = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    for (const edge of activeEdges) {
      if (edge.fromNodeId !== nodeId || seen.has(edge.toNodeId)) {
        continue;
      }
      seen.add(edge.toNodeId);
      descendants.add(edge.toNodeId);
      queue.push(edge.toNodeId);
    }
  }

  return [...descendants];
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

function cancelRunningAttempts(attempts: Awaited<ReturnType<typeof getPlanRun>> extends infer T ? T extends { attempts: infer A } ? A : never : never, nodeIds: string[], reason: string) {
  const targetIds = new Set(nodeIds);
  const finishedAt = new Date().toISOString();
  return attempts.map((attempt) =>
    targetIds.has(attempt.nodeId) && attempt.status === "running"
      ? {
          ...attempt,
          status: "cancelled" as const,
          finishedAt,
          error: { code: "MUTATION_CANCELLED", message: reason },
        }
      : attempt,
  );
}

function pushInvalidationLayer(graph: PlanGraph, nodeId: string, reason: string, mutationId: string) {
  const timestamp = new Date().toISOString();
  graph.nodes = graph.nodes.map((node) =>
    node.id !== nodeId
      ? node
      : {
          ...node,
          updatedAt: timestamp,
          layers: [
            ...node.layers,
            {
              id: `invalidate_${mutationId}_${nodeId}`,
              nodeId,
              type: "invalidation",
              createdAt: timestamp,
              createdBy: "system",
              reason,
              invalidatedByMutationId: mutationId,
            },
          ],
        },
  );
}

function pushDefinitionLayer(graph: PlanGraph, nodeId: string, definition: NodeDefinition, reason: string) {
  const timestamp = new Date().toISOString();
  graph.nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }
    return {
      ...node,
      updatedAt: timestamp,
      layers: [
        ...node.layers,
        {
          id: `definition_${graph.id}_${nodeId}_${Date.now()}`,
          nodeId,
          type: "definition",
          createdAt: timestamp,
          createdBy: "user",
          reason,
          definition,
        },
      ],
    };
  });
}

function getActiveDefinition(node: PlanGraph["nodes"][number]): NodeDefinition {
  const layer = [...node.layers].reverse().find((candidate) => candidate.type === "definition");
  if (!layer || layer.type !== "definition") {
    throw new Error(`Node ${node.id} has no definition layer`);
  }
  return structuredClone(layer.definition);
}

function updateEdge(graph: PlanGraph, edgeId: string, patch: Partial<Pick<PlanEdge, "active" | "label" | "type">>) {
  const timestamp = new Date().toISOString();
  let found = false;
  graph.edges = graph.edges.map((edge) => {
    if (edge.id !== edgeId) {
      return edge;
    }
    found = true;
    return { ...edge, ...patch, updatedAt: timestamp };
  });
  if (!found) {
    throw new Error(`Unknown edge id: ${edgeId}`);
  }
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
  const { graph } = state;
  const mutationId = `mutation_${graph.id}_${Date.now()}`;
  const affectedNodeIds = new Set<string>();
  const invalidationRoots = new Set<string>();

  if (input.mutation.expectedGraphId && input.mutation.expectedGraphId !== graph.id) {
    throw new Error(`Graph mismatch: expected ${input.mutation.expectedGraphId}, got ${graph.id}`);
  }
  if (
    input.mutation.expectedRevision !== undefined &&
    input.mutation.expectedRevision !== graph.mutations.length
  ) {
    throw new Error(`Graph revision mismatch: expected ${input.mutation.expectedRevision}, got ${graph.mutations.length}`);
  }

  for (const operation of input.mutation.operations) {
    switch (operation.type) {
      case "add_node": {
        if (graph.nodes.some((node) => node.id === operation.nodeId)) {
          throw new Error(`Node ${operation.nodeId} already exists`);
        }
        graph.nodes.push({
          id: operation.nodeId,
          semanticKey: operation.semanticKey,
          layers: [structuredClone(operation.definitionLayer)],
          createdAt: operation.definitionLayer.createdAt,
          updatedAt: operation.definitionLayer.createdAt,
        });
        affectedNodeIds.add(operation.nodeId);
        break;
      }
      case "push_node_layer": {
        const node = graph.nodes.find((candidate) => candidate.id === operation.nodeId);
        if (!node) {
          throw new Error(`Unknown node id: ${operation.nodeId}`);
        }
        node.layers.push(structuredClone(operation.layer));
        node.updatedAt = new Date().toISOString();
        affectedNodeIds.add(operation.nodeId);
        if (operation.layer.type === "definition") {
          invalidationRoots.add(operation.nodeId);
        }
        break;
      }
      case "add_edge":
        graph.edges.push(structuredClone(operation.edge));
        affectedNodeIds.add(operation.edge.fromNodeId);
        affectedNodeIds.add(operation.edge.toNodeId);
        invalidationRoots.add(operation.edge.fromNodeId);
        break;
      case "remove_edge": {
        const edge = graph.edges.find((candidate) => candidate.id === operation.edgeId);
        if (!edge) {
          throw new Error(`Unknown edge id: ${operation.edgeId}`);
        }
        updateEdge(graph, operation.edgeId, { active: false });
        affectedNodeIds.add(edge.fromNodeId);
        affectedNodeIds.add(edge.toNodeId);
        invalidationRoots.add(edge.fromNodeId);
        break;
      }
      case "update_edge": {
        const edge = graph.edges.find((candidate) => candidate.id === operation.edgeId);
        if (!edge) {
          throw new Error(`Unknown edge id: ${operation.edgeId}`);
        }
        updateEdge(graph, operation.edgeId, operation.patch);
        affectedNodeIds.add(edge.fromNodeId);
        affectedNodeIds.add(edge.toNodeId);
        invalidationRoots.add(edge.fromNodeId);
        break;
      }
      case "delete_node": {
        if (!graph.nodes.some((node) => node.id === operation.nodeId)) {
          throw new Error(`Unknown node id: ${operation.nodeId}`);
        }
        graph.edges = graph.edges.map((edge) =>
          edge.fromNodeId === operation.nodeId || edge.toNodeId === operation.nodeId
            ? { ...edge, active: false, updatedAt: new Date().toISOString() }
            : edge,
        );
        graph.nodes = graph.nodes.filter((node) => node.id !== operation.nodeId);
        affectedNodeIds.add(operation.nodeId);
        invalidationRoots.add(operation.nodeId);
        break;
      }
    }
  }

  const invalidatedNodeIds = collectDownstreamNodeIds(graph, [...invalidationRoots]);
  state.attempts = cancelRunningAttempts(
    state.attempts,
    [...new Set([...affectedNodeIds, ...invalidatedNodeIds])],
    input.mutation.reason,
  );
  state.results = markCurrentResults(state.results, [...affectedNodeIds], "obsolete");
  state.results = markCurrentResults(state.results, invalidatedNodeIds, "invalidated");

  for (const nodeId of invalidatedNodeIds) {
    pushInvalidationLayer(graph, nodeId, input.mutation.reason, mutationId);
  }

  graph.updatedAt = new Date().toISOString();
  graph.mutations.push({
    id: mutationId,
    graphId: graph.id,
    createdAt: new Date().toISOString(),
    createdBy: "user",
    reason: input.mutation.reason,
    operations: input.mutation.operations,
    affectedNodeIds: [...affectedNodeIds],
    invalidatedNodeIds,
  });

  await savePlanRun({
    workspaceId: state.task.workspaceId,
    taskId: input.taskId,
    planId: state.saved.compiledPlan.editablePlanId,
    run: state.persisted?.planRun ?? createPlanRunFromCompiledPlan(state.saved.compiledPlan),
    compiledPlan: state.saved.compiledPlan,
    graph,
    attempts: state.attempts,
    results: state.results,
    executionContextSnapshots: state.executionContextSnapshots,
  });

  return {
    taskId: input.taskId,
    graphId: graph.id,
    revision: graph.mutations.length,
    affectedNodeIds: [...affectedNodeIds],
    invalidatedNodeIds,
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
