import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type {
  CheckpointConfig,
  CompiledNode,
  CompiledPlan,
  ConditionConfig,
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeDefinition,
  NodeResult,
  NodeRuntimeState,
  PlanGraph,
  PlanRun,
  PlanOverlayLayer,
  TaskConfig,
  WaitConfig,
} from "@chrona/contracts/ai";
import { loadLayers } from "./layer-store";

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

type MutablePlanRuntimeRecord = {
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
};

type PersistedPlanRunRecord = {
  planRun: PlanRun;
  mutableGraph?: MutablePlanRuntimeRecord;
};

export type SavedPlanRunState = {
  planRun: PlanRun;
  graph: PlanGraph | null;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
};

function createEmptyPlanRun(compiledPlan: CompiledPlan): PlanRun {
  const createdAt = new Date().toISOString();
  const nodeStates = Object.fromEntries(
    compiledPlan.nodes.map((node) => [
      node.id,
      {
        nodeId: node.id,
        status: "pending",
        attempts: 0,
      } satisfies NodeRuntimeState,
    ]),
  );

  return {
    id: `plan_run_${compiledPlan.editablePlanId}`,
    compiledPlanId: compiledPlan.id,
    editablePlanId: compiledPlan.editablePlanId,
    sourceVersion: compiledPlan.sourceVersion,
    status: "pending",
    nodeStates,
    checkpointResponses: [],
    artifactRefs: [],
    attempts: [],
    createdAt,
  };
}

function toNodeObjective(node: CompiledNode): string {
  switch (node.type) {
    case "task":
      return (node.config as TaskConfig).expectedOutput ?? node.description ?? node.title;
    case "checkpoint":
      return (node.config as CheckpointConfig).prompt ?? node.description ?? node.title;
    case "condition":
      return (node.config as ConditionConfig).condition ?? node.description ?? node.title;
    case "wait":
      return (node.config as WaitConfig).waitFor ?? node.description ?? node.title;
  }
}

function toNodeDefinition(node: CompiledNode, linkedTaskId?: string): NodeDefinition {
  return {
    title: node.title,
    objective: toNodeObjective(node),
    description: node.description,
    semantics: {
      type: node.type,
      priority: node.priority,
      mode: node.mode,
      linkedTaskId: linkedTaskId ?? node.linkedTaskId,
      metadata: structuredClone((node.config ?? {}) as Record<string, unknown>),
    },
    executor: node.executor,
    estimatedMinutes: node.estimatedMinutes,
    metadata: structuredClone((node.config ?? {}) as Record<string, unknown>),
  };
}

export function createPlanGraphFromCompiledPlan(input: {
  taskId: string;
  compiledPlan: CompiledPlan;
  existingGraph?: PlanGraph;
}): PlanGraph {
  const timestamp = new Date().toISOString();

  return {
    id: input.existingGraph?.id ?? input.compiledPlan.editablePlanId,
    taskId: input.taskId,
    status: input.existingGraph?.status ?? "active",
    nodes: input.compiledPlan.nodes.map((node) => ({
      id: node.id,
      semanticKey: node.localId,
      layers: [
        {
          id: `node_layer_${input.compiledPlan.editablePlanId}_${node.id}_v${input.compiledPlan.sourceVersion}`,
          nodeId: node.id,
          type: "definition",
          createdAt: input.existingGraph?.createdAt ?? timestamp,
          createdBy: "system",
          definition: toNodeDefinition(node),
        },
      ],
      createdAt: input.existingGraph?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })),
    edges: input.compiledPlan.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      type: edge.label ? "branch" : "hard_dependency",
      active: true,
      label: edge.label,
      createdAt: input.existingGraph?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })),
    mutations: input.existingGraph?.mutations ?? [],
    createdAt: input.existingGraph?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function buildMutableGraphRecordFromLegacy(input: {
  taskId: string;
  compiledPlan: CompiledPlan;
  layers: PlanOverlayLayer[];
  existingGraph?: PlanGraph;
}): MutablePlanRuntimeRecord {
  const timestamp = new Date().toISOString();
  const latestRuntimeStateByNodeId = new Map<string, NodeRuntimeState & { linkedTaskId?: string }>();
  const latestResultByNodeId = new Map<string, NodeResult>();

  for (const layer of input.layers) {
    if (!layer.active) {
      continue;
    }

    if (layer.type === "runtime") {
      for (const [nodeId, state] of Object.entries(layer.nodeStates)) {
        latestRuntimeStateByNodeId.set(
          nodeId,
          state as NodeRuntimeState & { linkedTaskId?: string },
        );
      }
      continue;
    }

    if (layer.type === "result") {
      for (const [nodeId, result] of Object.entries(layer.nodeResults)) {
        latestResultByNodeId.set(nodeId, structuredClone(result));
      }
    }
  }

  const graph = createPlanGraphFromCompiledPlan({
    taskId: input.taskId,
    compiledPlan: input.compiledPlan,
    existingGraph: input.existingGraph,
  });
  const attempts: NodeAttempt[] = [];
  const results: NodeResult[] = [];

  for (const node of graph.nodes) {
    const runtimeState = latestRuntimeStateByNodeId.get(node.id);
    const activeDefinitionLayer = node.layers.find(
      (layer): layer is Extract<(typeof node.layers)[number], { type: "definition" }> =>
        layer.type === "definition",
    );
    const nodeLayerId = activeDefinitionLayer?.id;
    if (!nodeLayerId || !activeDefinitionLayer) {
      continue;
    }

    if (runtimeState?.linkedTaskId) {
      activeDefinitionLayer.definition.semantics.linkedTaskId = runtimeState.linkedTaskId;
    }

    const latestResult = latestResultByNodeId.get(node.id);
    const normalizedResult = latestResult
      ? {
          ...latestResult,
          id: latestResult.id ?? `result_${graph.id}_${node.id}`,
          taskId: latestResult.taskId ?? input.taskId,
          graphId: latestResult.graphId ?? graph.id,
          nodeId: latestResult.nodeId ?? node.id,
          nodeLayerId: latestResult.nodeLayerId ?? nodeLayerId,
          status: latestResult.status ?? "current",
        }
      : null;

    if (runtimeState?.status === "running") {
      attempts.push({
        id: `attempt_${graph.id}_${node.id}`,
        taskId: input.taskId,
        graphId: graph.id,
        nodeId: node.id,
        nodeLayerId,
        executionContextSnapshotId: `ctx_${graph.id}_${node.id}`,
        status: "running",
        idempotencyKey: `legacy:${graph.id}:${node.id}`,
        attemptNumber: Math.max(runtimeState.attempts ?? 0, 1),
        startedAt: runtimeState.startedAt ?? timestamp,
      });
    }

    if (normalizedResult) {
      results.push(normalizedResult);
      continue;
    }

    switch (runtimeState?.status) {
      case "completed":
        results.push({
          id: `result_${graph.id}_${node.id}`,
          taskId: input.taskId,
          graphId: graph.id,
          nodeId: node.id,
          nodeLayerId,
          status: "current",
          outputSummary: `${activeDefinitionLayer.definition.title} completed`,
        });
        break;
      case "waiting_for_user":
        results.push({
          id: `result_${graph.id}_${node.id}`,
          taskId: input.taskId,
          graphId: graph.id,
          nodeId: node.id,
          nodeLayerId,
          status: "current",
          waitKind: "user_input",
        });
        break;
      case "waiting_for_approval":
        results.push({
          id: `result_${graph.id}_${node.id}`,
          taskId: input.taskId,
          graphId: graph.id,
          nodeId: node.id,
          nodeLayerId,
          status: "current",
          waitKind: "approval",
        });
        break;
      case "waiting":
      case "blocked":
        results.push({
          id: `result_${graph.id}_${node.id}`,
          taskId: input.taskId,
          graphId: graph.id,
          nodeId: node.id,
          nodeLayerId,
          status: "current",
          waitKind: "manual_action",
          error: runtimeState.lastError,
        });
        break;
      case "failed":
        results.push({
          id: `result_${graph.id}_${node.id}`,
          taskId: input.taskId,
          graphId: graph.id,
          nodeId: node.id,
          nodeLayerId,
          status: "rejected",
          error: runtimeState.lastError ?? `${activeDefinitionLayer.definition.title} failed`,
        });
        break;
      case "invalidated":
        results.push({
          id: `result_${graph.id}_${node.id}`,
          taskId: input.taskId,
          graphId: graph.id,
          nodeId: node.id,
          nodeLayerId,
          status: "invalidated",
        });
        break;
      default:
        break;
    }
  }

  return {
    graph,
    attempts,
    results,
    executionContextSnapshots: [],
  };
}

async function loadCompiledPlanForRun(taskId: string, planId: string) {
  const row = await db.taskPlan.findFirst({
    where: { taskId, planId },
    select: { compiledPlan: true },
  });

  return (row?.compiledPlan as CompiledPlan | undefined) ?? null;
}

function toPersistedPlanRunRecord(input: {
  existing?: PersistedPlanRunRecord | null;
  compiledPlan: CompiledPlan | null;
  taskId: string;
  graph?: PlanGraph;
  attempts?: NodeAttempt[];
  results?: NodeResult[];
  executionContextSnapshots?: ExecutionContextSnapshot[];
  planRun?: PlanRun;
  legacyLayers?: PlanOverlayLayer[];
}): PersistedPlanRunRecord {
  const existing = input.existing ?? null;
  const existingMutable = existing?.mutableGraph;
  const planRun =
    input.planRun ??
    existing?.planRun ??
    (input.compiledPlan ? createEmptyPlanRun(input.compiledPlan) : null);

  if (!planRun) {
    throw new Error("Cannot persist plan run without compiledPlan or existing planRun");
  }

  let mutableGraph = existingMutable;

  if (input.graph) {
    mutableGraph = {
      graph: input.graph,
      attempts: input.attempts ?? existingMutable?.attempts ?? [],
      results: input.results ?? existingMutable?.results ?? [],
      executionContextSnapshots:
        input.executionContextSnapshots ?? existingMutable?.executionContextSnapshots ?? [],
    };
  } else if (!mutableGraph && input.compiledPlan) {
    mutableGraph = input.legacyLayers
      ? buildMutableGraphRecordFromLegacy({
          taskId: input.taskId,
          compiledPlan: input.compiledPlan,
          layers: input.legacyLayers,
        })
      : {
          graph: createPlanGraphFromCompiledPlan({
            taskId: input.taskId,
            compiledPlan: input.compiledPlan,
          }),
          attempts: [],
          results: [],
          executionContextSnapshots: [],
        };
  }

  return {
    planRun,
    ...(mutableGraph ? { mutableGraph } : {}),
  };
}

export async function savePlanRun(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  run?: PlanRun;
  layers?: PlanOverlayLayer[];
  compiledPlan?: CompiledPlan;
  graph?: PlanGraph;
  attempts?: NodeAttempt[];
  results?: NodeResult[];
  executionContextSnapshots?: ExecutionContextSnapshot[];
}): Promise<PlanRun> {
  const existingRow = await db.taskPlanRun.findUnique({
    where: {
      taskId_planId: {
        taskId: input.taskId,
        planId: input.planId,
      },
    },
  });

  const compiledPlan =
    input.compiledPlan ?? (await loadCompiledPlanForRun(input.taskId, input.planId));
  const existingRecord = (existingRow?.planRun as PersistedPlanRunRecord | undefined) ?? null;
  const persistedRecord = toPersistedPlanRunRecord({
    existing: existingRecord,
    compiledPlan,
    taskId: input.taskId,
    graph: input.graph,
    attempts: input.attempts,
    results: input.results,
    executionContextSnapshots: input.executionContextSnapshots,
    planRun: input.run,
    legacyLayers: input.layers,
  });

  await db.taskPlanRun.upsert({
    where: {
      taskId_planId: {
        taskId: input.taskId,
        planId: input.planId,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      planRun: asJsonValue(persistedRecord),
    },
    update: {
      workspaceId: input.workspaceId,
      planRun: asJsonValue(persistedRecord),
    },
  });

  return persistedRecord.planRun;
}

export async function getPlanRun(
  taskId: string,
  planId: string,
): Promise<SavedPlanRunState | null> {
  const row = await db.taskPlanRun.findUnique({
    where: {
      taskId_planId: {
        taskId,
        planId,
      },
    },
  });

  if (!row) {
    return null;
  }

  const record = row.planRun as unknown as PersistedPlanRunRecord;
  if (record.mutableGraph) {
    return {
      planRun: record.planRun,
      graph: record.mutableGraph.graph,
      attempts: record.mutableGraph.attempts,
      results: record.mutableGraph.results,
      executionContextSnapshots: record.mutableGraph.executionContextSnapshots,
    };
  }

  const compiledPlan = await loadCompiledPlanForRun(taskId, planId);
  if (!compiledPlan) {
    return {
      planRun: record.planRun,
      graph: null,
      attempts: [],
      results: [],
      executionContextSnapshots: [],
    };
  }

  const migrated = buildMutableGraphRecordFromLegacy({
    taskId,
    compiledPlan,
    layers: await loadLayers(taskId, planId),
  });

  await savePlanRun({
    workspaceId: row.workspaceId,
    taskId,
    planId,
    run: record.planRun,
    compiledPlan,
    graph: migrated.graph,
    attempts: migrated.attempts,
    results: migrated.results,
    executionContextSnapshots: migrated.executionContextSnapshots,
  });

  return {
    planRun: record.planRun,
    graph: migrated.graph,
    attempts: migrated.attempts,
    results: migrated.results,
    executionContextSnapshots: migrated.executionContextSnapshots,
  };
}

export async function getLatestPlanRun(taskId: string): Promise<SavedPlanRunState | null> {
  const row = await db.taskPlanRun.findFirst({
    where: { taskId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  if (!row) {
    return null;
  }

  return getPlanRun(taskId, row.planId);
}
