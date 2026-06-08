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
  id: string;
  planRun: PlanRun;
  graph: PlanGraph | null;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
  executionOwnerId: string | null;
  executionOwnerScope: string | null;
  executionLeaseUntil: Date | null;
  executionEpoch: number;
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

async function loadCompiledPlanForRun(taskId: string, planId: string, workBlockId?: string | null) {
  const row = await db.taskPlan.findFirst({
    where: { taskId, planId, workBlockId: workBlockId ?? null },
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
  workBlockId?: string | null;
  run?: PlanRun;
  compiledPlan?: CompiledPlan;
  graph?: PlanGraph;
  attempts?: NodeAttempt[];
  results?: NodeResult[];
  executionContextSnapshots?: ExecutionContextSnapshot[];
}): Promise<PlanRun> {
  const existingRow = await db.taskPlanRun.findFirst({
    where: {
      taskId: input.taskId,
      planId: input.planId,
      workBlockId: input.workBlockId ?? null,
    },
  });

  const compiledPlan =
    input.compiledPlan ?? (await loadCompiledPlanForRun(input.taskId, input.planId, input.workBlockId));
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

  const runData = {
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    workBlockId: input.workBlockId ?? null,
    planId: input.planId,
    planRun: asJsonValue(persistedRecord),
  };

  if (existingRow) {
    await db.taskPlanRun.update({
      where: { id: existingRow.id },
      data: {
        workspaceId: input.workspaceId,
        workBlockId: input.workBlockId ?? null,
        planRun: asJsonValue(persistedRecord),
      },
    });
  } else {
    await db.taskPlanRun.create({
      data: runData,
    });
  }

  return persistedRecord.planRun;
}

/**
 * Optimistic-concurrency write for the single-writer kernel. Persists the
 * mutable runtime record only if the row's executionEpoch still matches the
 * value read at the start of the command, then bumps the epoch. Returns
 * committed=false on conflict (a concurrent writer advanced first) so the
 * caller can reload and retry.
 */
export async function savePlanRunGuarded(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  workBlockId?: string | null;
  expectedEpoch: number;
  run?: PlanRun;
  compiledPlan?: CompiledPlan;
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
}): Promise<{ committed: boolean; planRun: PlanRun }> {
  const existingRow = await db.taskPlanRun.findFirst({
    where: {
      taskId: input.taskId,
      planId: input.planId,
      workBlockId: input.workBlockId ?? null,
    },
  });
  if (!existingRow) {
    const planRun = await savePlanRun(input);
    return { committed: true, planRun };
  }

  const compiledPlan =
    input.compiledPlan ??
    (await loadCompiledPlanForRun(input.taskId, input.planId, input.workBlockId));
  const existingRecord =
    (existingRow.planRun as unknown as PersistedPlanRunRecord | undefined) ?? null;
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

  const updated = await db.taskPlanRun.updateMany({
    where: { id: existingRow.id, executionEpoch: input.expectedEpoch },
    data: {
      workspaceId: input.workspaceId,
      workBlockId: input.workBlockId ?? null,
      planRun: asJsonValue(persistedRecord),
      executionEpoch: input.expectedEpoch + 1,
    },
  });

  return { committed: updated.count > 0, planRun: persistedRecord.planRun };
}

export async function getPlanRun(
  taskId: string,
  planId: string,
  workBlockId?: string | null,
): Promise<SavedPlanRunState | null> {
  const row = await db.taskPlanRun.findFirst({
    where: {
      taskId,
      planId,
      workBlockId: workBlockId ?? null,
    },
  });



  if (!row) {
    return null;
  }

  const record = row.planRun as unknown as PersistedPlanRunRecord;
  if (record.mutableGraph) {
    return {
      id: row.id,
      planRun: record.planRun,
      graph: record.mutableGraph.graph,
      attempts: record.mutableGraph.attempts,
      results: record.mutableGraph.results,
      executionContextSnapshots: record.mutableGraph.executionContextSnapshots,
      executionOwnerId: row.executionOwnerId,
      executionOwnerScope: row.executionOwnerScope,
      executionLeaseUntil: row.executionLeaseUntil,
      executionEpoch: row.executionEpoch,
    };
  }

  const compiledPlan = await loadCompiledPlanForRun(taskId, planId, workBlockId);
  if (!compiledPlan) {
    return {
      id: row.id,
      planRun: record.planRun,
      graph: null,
      attempts: [],
      results: [],
      executionContextSnapshots: [],
      executionOwnerId: row.executionOwnerId,
      executionOwnerScope: row.executionOwnerScope,
      executionLeaseUntil: row.executionLeaseUntil,
      executionEpoch: row.executionEpoch,
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
    workBlockId,
    run: record.planRun,
    compiledPlan,
    graph: migrated.graph,
    attempts: migrated.attempts,
    results: migrated.results,
    executionContextSnapshots: migrated.executionContextSnapshots,
  });

  return {
    id: row.id,
    planRun: record.planRun,
    graph: migrated.graph,
    attempts: migrated.attempts,
    results: migrated.results,
    executionContextSnapshots: migrated.executionContextSnapshots,
    executionOwnerId: row.executionOwnerId,
    executionOwnerScope: row.executionOwnerScope,
    executionLeaseUntil: row.executionLeaseUntil,
    executionEpoch: row.executionEpoch,
  };
}
