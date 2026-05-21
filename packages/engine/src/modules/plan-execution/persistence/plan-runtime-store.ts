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
  NodeResult,
  PlanExecutionStatus,
  PlanGraph,
  PlanRun,
} from "@chrona/contracts/ai";

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
    run: input.existingRun ?? createPlanRunFromCompiledPlan(input.compiledPlan),
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
  const now = new Date().toISOString();
  const graph = input.persisted.graph
    ? {
        ...input.persisted.graph,
        status: graphStatusForExecutionStatus(input.status),
        updatedAt: now,
      }
    : null;
  if (!graph) return;

  await savePlanRun({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    planId: input.planId,
    run: {
      ...input.persisted.planRun,
      status: planRunStatusForExecutionStatus(input.status),
      nodeStates: Object.fromEntries(
        input.effective.nodes.map((node) => {
          const existing = input.persisted.planRun.nodeStates[node.id];
          const attempts = input.persisted.attempts.filter(
            (attempt) => attempt.nodeId === node.id,
          );
          return [
            node.id,
            {
              ...existing,
              nodeId: node.id,
              status: node.status,
              attempts: attempts.length,
              ...(node.status === "completed" ? { completedAt: now } : {}),
              ...(node.status === "running" ? { startedAt: now } : {}),
            },
          ];
        }),
      ),
      startedAt: input.persisted.planRun.startedAt ?? now,
      completedAt: input.status === "completed" ? now : input.persisted.planRun.completedAt,
    },
    compiledPlan: input.compiledPlan,
    graph,
    attempts: input.persisted.attempts,
    results: input.persisted.results,
    executionContextSnapshots: input.persisted.executionContextSnapshots,
  });
}
