import {
  createPlanGraphFromCompiledPlan,
  getPlanRun,
  savePlanRun,
} from "./plan-run-store";
import { Prisma } from "@/generated/prisma/client";
import { getAcceptedCompiledPlan } from "./compiled-plan-store";
import { getAcceptedCompiledPlanForTask, resolveScopeWorkBlockId } from "./execution-scope";
import { withPlanExecutionDurability } from "./scheduler-durability";
import { planRunStatusForExecutionStatus } from "../execution-state-machine";
import type {
  CompiledPlan,
  ExecutionContextSnapshot,
  CheckpointInputFields,
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

export class PlanRuntimeStateChangedError extends Error {
  constructor() {
    super("Plan runtime state changed before intermediate persistence");
    this.name = "PlanRuntimeStateChangedError";
  }
}

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

function canonicalCheckpointInputFields(value: unknown): CheckpointInputFields | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields: CheckpointInputFields = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === "string" || typeof field === "boolean") {
      fields[key] = field;
      continue;
    }
    if (Array.isArray(field) && field.every((item): item is string => typeof item === "string")) {
      fields[key] = field;
      continue;
    }
    return null;
  }
  return fields;
}

export function derivePlanRunFromRuntime(input: {
  existingRun?: PlanRun;
  compiledPlan: CompiledPlan;
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots?: ExecutionContextSnapshot[];
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
    if (!node.result?.inputFields) return [];
    const attempt = input.attempts.findLast((candidate) => candidate.id === node.result?.attemptId);
    return [{
      id: `checkpoint_response_${input.compiledPlan.id}_${node.id}_${node.result.attemptId ?? "current"}`,
      planRunId: existingRun.id,
      nodeId: node.id,
      response: node.result.inputFields,
      submittedAt: attempt?.finishedAt ?? attempt?.startedAt ?? now,
    }];
  });
  const currentNodeResponses = (input.executionContextSnapshots ?? []).flatMap((snapshot) => {
    const fields = canonicalCheckpointInputFields(snapshot.refs?.inputFields);
    if (!fields) return [];
    const attempt = input.attempts.findLast(
      (candidate) => candidate.executionContextSnapshotId === snapshot.id,
    );
    return [{
      id: `checkpoint_response_${input.compiledPlan.id}_${snapshot.nodeId}_${attempt?.id ?? snapshot.id}`,
      planRunId: existingRun.id,
      nodeId: snapshot.nodeId,
      response: fields,
      submittedAt: attempt?.startedAt ?? snapshot.createdAt,
    }];
  });
  const allCheckpointResponses = [...checkpointResponses, ...currentNodeResponses].filter(
    (response, index, responses) => responses.findIndex((candidate) => candidate.id === response.id) === index,
  );

  return {
    ...existingRun,
    status: input.status
      ? planRunStatusForExecutionStatus(input.status)
      : existingRun.status,
    nodeStates,
    checkpointResponses: allCheckpointResponses,
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

export type NativePlanRuntime = {
  workBlockId: string | null;
  taskId: string;
  workspaceId: string;
  planId: string;
  compiledPlan: CompiledPlan;
  persisted: NonNullable<Awaited<ReturnType<typeof getPlanRun>>>;
  planPrompt: string | null;
  planSummary: string | null;
};

export async function ensureNativePlanRun(
  taskId: string,
  workBlockId?: string | null,
  options?: { resolveScope?: boolean },
): Promise<NativePlanRuntime | null> {
  const executionWorkBlockId = options?.resolveScope === false
    ? workBlockId ?? null
    : await resolveScopeWorkBlockId(taskId, { workBlockId });
  const savedCompiled = options?.resolveScope === false
    ? await getAcceptedCompiledPlan(taskId, executionWorkBlockId)
    : await getAcceptedCompiledPlanForTask(taskId, { workBlockId: executionWorkBlockId });
  if (!savedCompiled) {
    return null;
  }

  const { compiledPlan, workspaceId } = savedCompiled;
  const planId = compiledPlan.editablePlanId;
  const planWorkBlockId = executionWorkBlockId;
  let persisted = await getPlanRun(taskId, planId, planWorkBlockId);

  if (!persisted?.graph) {
    await withPlanExecutionDurability((tx) => savePlanRun({
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
    }, tx));
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
  executionSessionId?: string;
  planId: string;
  compiledPlan: CompiledPlan;
  graph: PlanGraph;
  expectedExecutionEpoch: number;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
  existingRun?: PlanRun;
}, suppliedTx?: Prisma.TransactionClient) {
  return withPlanExecutionDurability(async (tx) => {
    const claimed = await tx.taskPlanRun.updateMany({
      where: {
        taskId: input.taskId,
        planId: input.planId,
        workBlockScopeKey: input.workBlockId ?? "",
        executionEpoch: input.expectedExecutionEpoch,
      },
      data: { executionEpoch: input.expectedExecutionEpoch },
    });
    if (claimed.count !== 1) {
      throw new PlanRuntimeStateChangedError();
    }
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
    }, tx);
    await syncNormalizedRuntimeStateInTransaction(input, tx);
    if (input.executionSessionId) {
      const currentAttempt = [...input.attempts].reverse().find((attempt) => attempt.status === "running");
      if (currentAttempt) {
        const sessionClaim = await tx.executionSession.updateMany({
          where: {
            id: input.executionSessionId,
            taskId: input.taskId,
            planId: input.planId,
            workBlockId: input.workBlockId ?? null,
            currentNodeId: currentAttempt.nodeId,
            status: "Active",
          },
          data: { currentNodeAttemptId: currentAttempt.id },
        });
        if (sessionClaim.count !== 1) throw new PlanRuntimeStateChangedError();
      }
    }
  }, suppliedTx);
}


export async function syncNormalizedRuntimeState(input: {
  workBlockId?: string | null;
  workspaceId: string;
  taskId: string;
  planId: string;
  attempts: NodeAttempt[];
  results: NodeResult[];
}, suppliedTx?: Prisma.TransactionClient) {
  return withPlanExecutionDurability((tx) => syncNormalizedRuntimeStateInTransaction(input, tx), suppliedTx);
}

async function syncNormalizedRuntimeStateInTransaction(input: {
  workBlockId?: string | null;
  workspaceId: string;
  taskId: string;
  planId: string;
  attempts: NodeAttempt[];
  results: NodeResult[];
}, tx: Prisma.TransactionClient) {
  if (input.attempts.length === 0) return;
  const planRun = await tx.taskPlanRun.findUnique({
    where: {
      taskId_planId_workBlockScopeKey: {
        taskId: input.taskId,
        planId: input.planId,
        workBlockScopeKey: input.workBlockId ?? "",
      },
    },
    select: { id: true, executionEpoch: true },
  });
  if (!planRun) return;
  const currentResultsByNodeId = new Map(
    input.results.filter((result) => result.status === "current").map((result) => [result.nodeId, result]),
  );
  for (const attempt of input.attempts) {
    await syncNormalizedAttempt({
      ...input,
      planRunId: planRun.id,
      executionEpoch: planRun.executionEpoch,
      attempt,
      result: currentResultsByNodeId.get(attempt.nodeId),
    }, tx);
    await syncProviderRunsForAttempt(attempt, tx);
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
}, tx: Prisma.TransactionClient) {
  const mutableFields = {
    status: input.attempt.status,
    finishedAt: dateOrNull(input.attempt.finishedAt),
    error: toJsonInput(input.attempt.error),
    runtimeSnapshot: toJsonInput(input.attempt.runtimeSnapshot),
    selectedBranchRef: input.result?.selectedBranch?.ref ?? null,
    selectedNextNodeId: input.result?.selectedBranch?.nextNodeId ?? null,
  };
  const existing = await tx.taskPlanNodeAttempt.findUnique({
    where: { idempotencyKey: input.attempt.idempotencyKey },
    select: {
      id: true,
      taskId: true,
      planId: true,
      planRunId: true,
      nodeId: true,
      nodeLayerId: true,
      executionContextSnapshotId: true,
      attemptNumber: true,
      executionEpoch: true,
      status: true,
      startedAt: true,
    },
  });
  if (existing) {
    if (
      existing.id !== input.attempt.id
      || existing.taskId !== input.taskId
      || existing.planId !== input.planId
      || existing.planRunId !== input.planRunId
      || existing.nodeId !== input.attempt.nodeId
      || existing.nodeLayerId !== input.attempt.nodeLayerId
      || existing.executionContextSnapshotId !== input.attempt.executionContextSnapshotId
      || existing.attemptNumber !== input.attempt.attemptNumber
      || existing.startedAt.getTime() !== new Date(input.attempt.startedAt).getTime()
      || existing.executionEpoch > input.executionEpoch
    ) {
      throw new Error("Node attempt idempotency key belongs to another execution scope");
    }
    if (["succeeded", "failed", "cancelled"].includes(existing.status) && existing.status !== input.attempt.status) {
      throw new Error("Terminal node attempt cannot be reopened");
    }
    await tx.taskPlanNodeAttempt.update({ where: { id: existing.id }, data: mutableFields });
    return;
  }
  await tx.taskPlanNodeAttempt.create({
    data: {
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

async function syncProviderRunsForAttempt(attempt: NodeAttempt, tx: Prisma.TransactionClient) {
  if (attempt.status === "running") return;
  await tx.taskPlanProviderRun.updateMany({
    where: { nodeAttemptId: attempt.id, status: "running" },
    data: { status: providerRunStatusForAttempt(attempt.status), finishedAt: dateOrNull(attempt.finishedAt) ?? new Date() },
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
