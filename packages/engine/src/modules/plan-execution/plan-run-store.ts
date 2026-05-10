import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createPlanGraphFromCompiledPlan as createRuntimePlanGraphFromCompiledPlan } from "@chrona/graph-runtime";
import type {
  CompiledPlan,
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeResult,
  NodeRuntimeState,
  PlanGraph,
  PlanRun,
} from "@chrona/contracts/ai";

export function createPlanGraphFromCompiledPlan(input: {
  taskId: string;
  compiledPlan: CompiledPlan;
  existingGraph?: PlanGraph;
  now?: string;
}): PlanGraph {
  return createRuntimePlanGraphFromCompiledPlan(input as Parameters<typeof createRuntimePlanGraphFromCompiledPlan>[0]) as unknown as PlanGraph;
}

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

type SavedPlanRunState = {
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
    mutableGraph = {
      graph: createPlanGraphFromCompiledPlan({
        taskId: input.taskId,
        compiledPlan: input.compiledPlan,
      }) as PlanGraph,
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

  const migrated: MutablePlanRuntimeRecord = {
    graph: createPlanGraphFromCompiledPlan({ taskId, compiledPlan }) as PlanGraph,
    attempts: [],
    results: [],
    executionContextSnapshots: [],
  };

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

async function getLatestPlanRun(taskId: string): Promise<SavedPlanRunState | null> {
  const row = await db.taskPlanRun.findFirst({
    where: { taskId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  if (!row) {
    return null;
  }

  return getPlanRun(taskId, row.planId);
}
