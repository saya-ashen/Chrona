import {
  createPlanGraphFromCompiledPlan,
  getPlanRun,
  savePlanRun,
} from "../plan-run-store";
import { getAcceptedCompiledPlan } from "../compiled-plan-store";
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

function derivePlanRunFromRuntime(input: {
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

  return {
    ...existingRun,
    status: input.status
      ? planRunStatusForExecutionStatus(input.status)
      : existingRun.status,
    nodeStates,
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

export async function ensureNativePlanRun(taskId: string) {
  const savedCompiled = await getAcceptedCompiledPlan(taskId);
  if (!savedCompiled) {
    return null;
  }

  const { compiledPlan, workspaceId } = savedCompiled;
  const planId = compiledPlan.editablePlanId;
  let persisted = await getPlanRun(taskId, planId);

  if (!persisted?.graph) {
    await savePlanRun({
      workspaceId,
      taskId,
      planId,
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
    persisted = await getPlanRun(taskId, planId);
  }

  if (!persisted?.graph) {
    throw new Error(`Plan runtime graph missing for task ${taskId}`);
  }

  return {
    taskId,
    workspaceId,
    planId,
    compiledPlan,
    persisted,
  };
}

export async function persistRuntimeState(input: {
  workspaceId: string;
  taskId: string;
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
    planId: input.planId,
    run: derivePlanRunFromRuntime(input),
    compiledPlan: input.compiledPlan,
    graph: input.graph,
    attempts: input.attempts,
    results: input.results,
    executionContextSnapshots: input.executionContextSnapshots,
  });
}

export async function persistTerminalRuntimeState(input: {
  workspaceId: string;
  taskId: string;
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
}
