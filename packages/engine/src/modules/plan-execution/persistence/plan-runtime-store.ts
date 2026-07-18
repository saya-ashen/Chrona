import {
  createPlanGraphFromCompiledPlan,
  getPlanRun,
  savePlanRun,
} from "./plan-run-store";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getAcceptedCompiledPlanForTask } from "./execution-scope";
import { graphStatusForExecutionStatus, planRunStatusForExecutionStatus } from "../execution-state-machine";
import type {
  CompiledPlan,
  EffectivePlanGraph,
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeExecutionAttempt,
  NodeResult,
  NodeRuntimeState,
  PlanExecutionStatus,
  PlanGraph,
  PlanRun,
} from "@chrona/contracts/ai";
import { toEffectivePlanGraph } from "../projection/execution-graph-selectors";

export type PersistedPlanRun = NonNullable<Awaited<ReturnType<typeof getPlanRun>>>;

export function createPlanRunFromCompiledPlan(compiled: CompiledPlan): PlanRun {
  const createdAt = new Date().toISOString();
  return {
    id: `plan_run_${compiled.editablePlanId}`,
    compiledPlanId: compiled.id,
    editablePlanId: compiled.editablePlanId,
    sourceVersion: compiled.sourceVersion,
    status: "pending",
    nodeStates: Object.fromEntries(
      compiled.nodes.map((node) => [
        node.id,
        {
          nodeId: node.id,
          status: "pending",
          attempts: 0,
        },
      ]),
    ),
    checkpointResponses: [],
    artifactRefs: [],
    attempts: [],
    createdAt,
  };
}

function toLegacyNodeExecutionAttempt(attempt: NodeAttempt): NodeExecutionAttempt {
  return {
    id: attempt.id,
    planRunId: attempt.graphId,
    nodeId: attempt.nodeId,
    nodeLayerId: attempt.nodeLayerId,
    executionContextSnapshotId: attempt.executionContextSnapshotId,
    idempotencyKey: attempt.idempotencyKey,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    error: attempt.error,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
  };
}

export function derivePlanRunFromRuntime(input: {
  existingRun?: PlanRun;
  compiledPlan: CompiledPlan;
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
  status?: PlanExecutionStatus;
}): PlanRun {
  const effective = toEffectivePlanGraph({
    graph: input.graph,
    attempts: input.attempts,
    results: input.results,
  });
  const existingRun = input.existingRun ?? createPlanRunFromCompiledPlan(input.compiledPlan);
  const now = new Date().toISOString();
  const nodeStates = Object.fromEntries(
    effective.nodes.map((node) => [
      node.id,
      {
        nodeId: node.id,
        status: node.status,
        attempts: node.attempts,
        ...(node.lastError ? { lastError: node.lastError } : {}),
        ...(node.startedAt ? { startedAt: node.startedAt } : {}),
        ...(node.completedAt ? { completedAt: node.completedAt } : {}),
      } satisfies NodeRuntimeState,
    ]),
  );

  const checkpointResponses = effective.nodes.flatMap((node) => {
    if (node.type !== "checkpoint" || !node.result?.inputFields) return [];
    const attempt = input.attempts.findLast((candidate) => candidate.id === node.result?.attemptId);
    return [{
      id: `checkpoint_response_${input.compiledPlan.id}_${node.id}_${node.result.attemptId ?? "current"}`,
      planRunId: existingRun.id,
      nodeId: node.id,
      response: node.result.inputFields,
      submittedAt: attempt?.finishedAt ?? attempt?.startedAt ?? now,
    }];
  });

  return {
    ...existingRun,
    status: input.status
      ? planRunStatusForExecutionStatus(input.status)
      : existingRun.status,
    nodeStates,
    checkpointResponses,
    attempts: input.attempts.map(toLegacyNodeExecutionAttempt),
    startedAt:
      existingRun.startedAt ??
      (input.attempts.length > 0 || effective.runningNodeIds.length > 0 ? now : undefined),
    completedAt:
      input.status === "completed"
        ? (existingRun.completedAt ?? now)
        : existingRun.completedAt,
  };
}

export async function ensureNativePlanRun(taskId: string, workBlockId?: string | null) {
  const savedCompiled = await getAcceptedCompiledPlanForTask(taskId, { workBlockId });
  if (!savedCompiled) {
    return null;
  }

  const { compiledPlan, workspaceId } = savedCompiled;
  const planId = compiledPlan.editablePlanId;
  // The runtime row is keyed to the accepted plan's own work block, which is the
  // authoritative scope that getAcceptedCompiledPlan just matched on.
  const planWorkBlockId = savedCompiled.workBlockId;
  let persisted = await getPlanRun(taskId, planId, planWorkBlockId);

  if (!persisted?.graph) {
    await savePlanRun({
      workspaceId,
      taskId,
      planId,
      workBlockId: planWorkBlockId,
      run: persisted?.planRun ?? createPlanRunFromCompiledPlan(compiledPlan),
      compiledPlan,
      graph: createPlanGraphFromCompiledPlan({
        taskId,
        compiledPlan,
      }) as unknown as PlanGraph,
      attempts: persisted?.attempts ?? [],
      results: persisted?.results ?? [],
      executionContextSnapshots: persisted?.executionContextSnapshots ?? [],
    });
    persisted = await getPlanRun(taskId, planId, planWorkBlockId);
  }

  if (!persisted?.graph) {
    throw new Error(`Plan runtime graph missing for task ${taskId}`);
  }

  return {
    workBlockId: planWorkBlockId,
    taskId,
    workspaceId,
    planId,
    compiledPlan,
    persisted,
    planPrompt: savedCompiled.prompt,
    planSummary: savedCompiled.summary,
  };
}

export async function persistRuntimeState(input: {
  workspaceId: string;
  taskId: string;
  workBlockId?: string | null;
  planId: string;
  compiledPlan: CompiledPlan;
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
  existingRun?: PlanRun;
}) {
  await savePlanRun({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    workBlockId: input.workBlockId,
    planId: input.planId,
    run: derivePlanRunFromRuntime(input),
    compiledPlan: input.compiledPlan,
    graph: input.graph,
    attempts: input.attempts,
    results: input.results,
    executionContextSnapshots: input.executionContextSnapshots,
  });
  await syncNormalizedRuntimeState({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    planId: input.planId,
    attempts: input.attempts,
    results: input.results,
  });
}

export async function persistTerminalRuntimeState(input: {
  workspaceId: string;
  taskId: string;
  workBlockId?: string | null;
  planId: string;
  compiledPlan: CompiledPlan;
  persisted: PersistedPlanRun;
  effective: EffectivePlanGraph;
  status: PlanExecutionStatus;
}) {
  const graph = input.persisted.graph
    ? {
        ...input.persisted.graph,
        status: graphStatusForExecutionStatus(input.status),
        updatedAt: new Date().toISOString(),
      }
    : null;
  if (!graph) return;

  await savePlanRun({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    workBlockId: input.workBlockId,
    planId: input.planId,
    run: derivePlanRunFromRuntime({
      existingRun: input.persisted.planRun,
      compiledPlan: input.compiledPlan,
      graph,
      attempts: input.persisted.attempts,
      results: input.persisted.results,
      status: input.status,
    }),
    compiledPlan: input.compiledPlan,
    graph,
    attempts: input.persisted.attempts,
    results: input.persisted.results,
    executionContextSnapshots: input.persisted.executionContextSnapshots,
  });
  await syncNormalizedRuntimeState({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    planId: input.planId,
    attempts: input.persisted.attempts,
    results: input.persisted.results,
  });
}

export async function syncNormalizedRuntimeState(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  attempts: NodeAttempt[];
  results: NodeResult[];
}) {
  if (input.attempts.length === 0) return;
  const planRun = await db.taskPlanRun.findFirst({
    where: { taskId: input.taskId, planId: input.planId },
    select: { id: true, executionEpoch: true },
  });
  if (!planRun) return;

  const currentResultsByNodeId = new Map(
    input.results
      .filter((result) => result.status === "current")
      .map((result) => [result.nodeId, result]),
  );

  for (const attempt of input.attempts) {
    await syncNormalizedAttempt({
      ...input,
      planRunId: planRun.id,
      executionEpoch: planRun.executionEpoch,
      attempt,
      result: currentResultsByNodeId.get(attempt.nodeId),
    });
    await syncProviderRunsForAttempt(attempt);
  }
}

async function syncNormalizedAttempt(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  planRunId: string;
  executionEpoch: number;
  attempt: NodeAttempt;
  result?: NodeResult;
}) {
  const mutableFields = {
    status: input.attempt.status,
    finishedAt: dateOrNull(input.attempt.finishedAt),
    error: toJsonInput(input.attempt.error),
    runtimeSnapshot: toJsonInput(input.attempt.runtimeSnapshot),
    selectedBranchRef: input.result?.selectedBranch?.ref ?? null,
    selectedNextNodeId: input.result?.selectedBranch?.nextNodeId ?? null,
  };
  await db.taskPlanNodeAttempt.upsert({
    where: { idempotencyKey: input.attempt.idempotencyKey },
    update: mutableFields,
    create: {
      id: input.attempt.id,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      planRunId: input.planRunId,
      nodeId: input.attempt.nodeId,
      nodeLayerId: input.attempt.nodeLayerId,
      executionContextSnapshotId: input.attempt.executionContextSnapshotId,
      idempotencyKey: input.attempt.idempotencyKey,
      attemptNumber: input.attempt.attemptNumber,
      executionEpoch: input.executionEpoch,
      startedAt: new Date(input.attempt.startedAt),
      ...mutableFields,
    },
    select: { id: true },
  });
}

async function syncProviderRunsForAttempt(attempt: NodeAttempt) {
  if (attempt.status === "running") return;
  await db.taskPlanProviderRun.updateMany({
    where: { nodeAttemptId: attempt.id, status: "running" },
    data: {
      status: providerRunStatusForAttempt(attempt.status),
      finishedAt: dateOrNull(attempt.finishedAt) ?? new Date(),
    },
  });
}

function providerRunStatusForAttempt(status: NodeAttempt["status"]) {
  if (status === "succeeded") return "completed";
  return status;
}

function toJsonInput(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function dateOrNull(value?: string) {
  return value ? new Date(value) : null;
}
