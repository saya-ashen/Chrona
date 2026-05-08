import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ensurePlanMainSession, appendMainSessionEvent } from "./plan-state-store";
import { OPENCLAW_RUNTIME_ADAPTER_KEY as DEFAULT_RUNTIME_ADAPTER_KEY } from "@chrona/openclaw";
import {
  createPlanGraphFromCompiledPlan,
  getPlanRun,
  savePlanRun,
} from "./plan-run-store";
import { getAcceptedCompiledPlan } from "./compiled-plan-store";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import type {
  CompiledPlan,
  EffectivePlanGraph,
  EffectivePlanNode,
  ExecutionActionInput,
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeResult,
  PlanGraph,
  PlanRun,
  WaitKind,
} from "@chrona/contracts/ai";
import type { NodeExecutor, NodeExecutionResult } from "./node-executors/types";
import { TaskNodeExecutor } from "./node-executors/task-executor";
import { CheckpointNodeExecutor } from "./node-executors/checkpoint-executor";
import { ConditionNodeExecutor } from "./node-executors/condition-executor";
import { WaitNodeExecutor } from "./node-executors/wait-executor";

type PlanExecutionStatus =
  | "started"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "completed"
  | "cancelled"
  | "no_plan";

type PlanExecutionResult = {
  taskId: string;
  planId: string | null;
  mainSessionId: string | null;
  status: PlanExecutionStatus;
  currentNodeId: string | null;
  executedNodeIds: string[];
  waitingNodeIds: string[];
  blockedNodeIds: string[];
  message: string;
};

type OrchestratorTrigger = "manual" | "scheduler" | "system" | "auto";

type ExecutionSessionRow = Awaited<ReturnType<typeof ensureExecutionSession>>;

const DEFAULT_MAX_STEPS = 10;

const executors: NodeExecutor[] = [
  new TaskNodeExecutor(),
  new CheckpointNodeExecutor(),
  new ConditionNodeExecutor(),
  new WaitNodeExecutor(),
];

function dispatchExecutor(node: EffectivePlanNode): NodeExecutor | null {
  return executors.find((executor) => executor.canExecute(node)) ?? null;
}

export function createPlanRunFromCompiledPlan(
  compiled: CompiledPlan,
): PlanRun {
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

function mapWaitKindToExecutionStatus(waitKind: WaitKind | undefined): PlanExecutionStatus {
  switch (waitKind) {
    case "user_input":
      return "waiting_for_user";
    case "approval":
    case "review":
      return "waiting_for_approval";
    default:
      return "blocked";
  }
}

function mapTerminalReasonToStatus(effective: EffectivePlanGraph): PlanExecutionStatus {
  if (effective.readyNodeIds.length > 0) return "running";
  if (effective.runningNodeIds.length > 0) return "running";
  if (effective.nodes.some((node) => node.status === "waiting_for_user")) {
    return "waiting_for_user";
  }
  if (effective.nodes.some((node) => node.status === "waiting_for_approval")) {
    return "waiting_for_approval";
  }
  if (effective.blockedNodeIds.length > 0 || effective.failedNodeIds.length > 0) {
    return "blocked";
  }
  if (effective.completedNodeIds.length === effective.nodes.length) return "completed";
  return "blocked";
}

function pickNextNodeId(
  effective: EffectivePlanGraph,
  forcedNodeId?: string,
): string | null {
  if (forcedNodeId) {
    const forced = effective.nodes.find((node) => node.id === forcedNodeId);
    if (forced && forced.reachable) {
      return forcedNodeId;
    }
  }
  return effective.readyNodeIds.length > 0 ? effective.readyNodeIds[0] : null;
}

function getCurrentResult(
  results: NodeResult[],
  nodeId: string,
  nodeLayerId?: string | null,
): NodeResult | null {
  return (
    [...results]
      .reverse()
      .find(
        (result) =>
          result.nodeId === nodeId &&
          result.status === "current" &&
          (nodeLayerId ? result.nodeLayerId === nodeLayerId : true),
      ) ?? null
  );
}

function markNodeResults(
  results: NodeResult[],
  nodeId: string,
  nextStatus: NonNullable<NodeResult["status"]>,
): NodeResult[] {
  return results.map((result) =>
    result.nodeId === nodeId && result.status === "current"
      ? { ...result, status: nextStatus }
      : result,
  );
}

function appendCurrentResult(input: {
  results: NodeResult[];
  result: NodeResult;
  replaceStatus?: NonNullable<NodeResult["status"]>;
}): NodeResult[] {
  const nextResults = markNodeResults(
    input.results,
    input.result.nodeId ?? "",
    input.replaceStatus ?? "obsolete",
  );
  nextResults.push(input.result);
  return nextResults;
}

function updateAttemptStatus(input: {
  attempts: NodeAttempt[];
  attemptId: string;
  status: NodeAttempt["status"];
  finishedAt?: string;
  error?: NodeAttempt["error"];
}): NodeAttempt[] {
  return input.attempts.map((attempt) =>
    attempt.id === input.attemptId
      ? {
          ...attempt,
          status: input.status,
          finishedAt: input.finishedAt ?? attempt.finishedAt,
          ...(input.error ? { error: input.error } : {}),
        }
      : attempt,
  );
}

function cancelActiveAttempt(
  attempts: NodeAttempt[],
  nodeId: string,
  reason: string,
): NodeAttempt[] {
  const finishedAt = new Date().toISOString();
  return attempts.map((attempt) =>
    attempt.nodeId === nodeId && attempt.status === "running"
      ? {
          ...attempt,
          status: "cancelled",
          finishedAt,
          error: {
            code: "EXECUTION_CANCELLED",
            message: reason,
          },
        }
      : attempt,
  );
}

function createExecutionContextSnapshot(input: {
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  graphVersion: number;
  runtimeName: string;
  userInput?: string;
}): ExecutionContextSnapshot {
  const createdAt = new Date().toISOString();
  return {
    id: `ctx_${input.graphId}_${input.nodeId}_${Date.now()}`,
    graphId: input.graphId,
    nodeId: input.nodeId,
    nodeLayerId: input.nodeLayerId,
    graphSignature: `${input.graphId}:${input.graphVersion}:${input.nodeLayerId}`,
    refs: input.userInput ? { userInput: input.userInput } : undefined,
    runtimeSnapshot: { runtimeName: input.runtimeName },
    createdAt,
  };
}

async function getRuntimeName(taskId: string): Promise<string> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { runtimeAdapterKey: true },
  });
  return task.runtimeAdapterKey ?? DEFAULT_RUNTIME_ADAPTER_KEY;
}

async function activateWorkBlock(taskId: string, workBlockId?: string | null) {
  await db.workBlock.updateMany({
    where: workBlockId
      ? { id: workBlockId, taskId }
      : { taskId, status: "Scheduled" },
    data: { status: "Active", startedAt: new Date() },
  });
}

async function completeWorkBlock(taskId: string, workBlockId?: string | null) {
  await db.workBlock.updateMany({
    where: workBlockId
      ? { id: workBlockId, taskId }
      : { taskId, status: "Active" },
    data: { status: "Completed", completedAt: new Date() },
  });
}

async function cancelWorkBlock(taskId: string, workBlockId?: string | null) {
  await db.workBlock.updateMany({
    where: workBlockId
      ? { id: workBlockId, taskId }
      : { taskId, status: "Active" },
    data: { status: "Cancelled" },
  });
}

async function ensureExecutionSession(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  trigger: OrchestratorTrigger;
  workBlockId?: string | null;
  sessionId?: string;
}) {
  const existing = input.sessionId
    ? await db.executionSession.findUnique({ where: { id: input.sessionId } })
    : await db.executionSession.findFirst({
        where: {
          taskId: input.taskId,
          status: { in: ["Active", "Paused"] },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });

  if (existing) {
    return db.executionSession.update({
      where: { id: existing.id },
      data: {
        planId: input.planId,
        workBlockId: input.workBlockId ?? existing.workBlockId,
      },
    });
  }

  return db.executionSession.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      workBlockId: input.workBlockId ?? null,
      status: "Active",
      currentNodeId: null,
      pauseReason: null,
      completedNodeIds: "[]",
    },
  });
}

async function setExecutionSessionState(input: {
  sessionId: string;
  status: "Active" | "Paused" | "Completed" | "Abandoned";
  currentNodeId?: string | null;
  pauseReason?: string | null;
  completedNodeIds?: string[];
}) {
  return db.executionSession.update({
    where: { id: input.sessionId },
    data: {
      status: input.status,
      currentNodeId: input.currentNodeId,
      pauseReason: input.pauseReason,
      completedNodeIds: input.completedNodeIds
        ? JSON.stringify(input.completedNodeIds)
        : undefined,
      pausedAt: input.status === "Paused" ? new Date() : null,
      completedAt:
        input.status === "Completed" || input.status === "Abandoned"
          ? new Date()
          : null,
    },
  });
}

async function ensureNativePlanRun(taskId: string) {
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
      graph: createPlanGraphFromCompiledPlan({ taskId, compiledPlan }),
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

function buildExecutionResponse(input: {
  taskId: string;
  planId: string;
  mainSessionId: string;
  status: PlanExecutionStatus;
  effective: EffectivePlanGraph;
  currentNodeId: string | null;
  executedNodeIds: string[];
  message: string;
}): PlanExecutionResult {
  return {
    taskId: input.taskId,
    planId: input.planId,
    mainSessionId: input.mainSessionId,
    status: input.status,
    currentNodeId: input.currentNodeId,
    executedNodeIds: input.executedNodeIds,
    waitingNodeIds: input.effective.nodes
      .filter((node) => node.status === "waiting_for_user")
      .map((node) => node.id),
    blockedNodeIds: input.effective.blockedNodeIds,
    message: input.message,
  };
}

async function persistRuntimeState(input: {
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

async function pauseExecution(input: {
  taskId: string;
  planId: string;
  mainSessionId: string;
  session: ExecutionSessionRow;
  effective: EffectivePlanGraph;
  waitKind?: WaitKind;
  currentNodeId: string;
  executedNodeIds: string[];
  message: string;
}) {
  await setExecutionSessionState({
    sessionId: input.session.id,
    status: "Paused",
    currentNodeId: input.currentNodeId,
    pauseReason: input.waitKind ?? "manual_action",
    completedNodeIds: input.effective.completedNodeIds,
  });

  const taskStatus =
    input.waitKind === "user_input"
      ? TaskStatus.WaitingForInput
      : input.waitKind === "approval" || input.waitKind === "review"
        ? TaskStatus.WaitingForApproval
        : TaskStatus.Blocked;

  await db.task.update({
    where: { id: input.taskId },
    data: {
      status: taskStatus,
      blockReason: {
        blockType:
          input.waitKind === "user_input"
            ? "human_input_required"
            : input.waitKind === "approval" || input.waitKind === "review"
              ? "approval_required"
              : "node_blocked",
        scope: "plan_node",
        actionRequired: input.message,
        nodeId: input.currentNodeId,
      },
    },
  });

  await rebuildTaskProjection(input.taskId);

  return buildExecutionResponse({
    taskId: input.taskId,
    planId: input.planId,
    mainSessionId: input.mainSessionId,
    status: mapWaitKindToExecutionStatus(input.waitKind),
    effective: input.effective,
    currentNodeId: input.currentNodeId,
    executedNodeIds: input.executedNodeIds,
    message: input.message,
  });
}

async function completeExecution(input: {
  taskId: string;
  planId: string;
  session: ExecutionSessionRow;
  mainSessionId: string;
  effective: EffectivePlanGraph;
  executedNodeIds: string[];
  message: string;
}) {
  const status = mapTerminalReasonToStatus(input.effective);
  await setExecutionSessionState({
    sessionId: input.session.id,
    status: status === "completed" ? "Completed" : "Paused",
    currentNodeId: null,
    pauseReason:
      status === "waiting_for_user"
        ? "user_input"
        : status === "waiting_for_approval"
          ? "approval"
          : status === "blocked"
            ? "manual_action"
            : null,
    completedNodeIds: input.effective.completedNodeIds,
  });

  await db.task.update({
    where: { id: input.taskId },
    data: {
      status:
        status === "completed"
          ? TaskStatus.Completed
          : status === "waiting_for_user"
            ? TaskStatus.WaitingForInput
            : status === "waiting_for_approval"
              ? TaskStatus.WaitingForApproval
              : TaskStatus.Blocked,
      completedAt: status === "completed" ? new Date() : undefined,
      blockReason:
        status === "blocked"
          ? {
              blockType: "node_blocked",
              scope: "plan_execution",
              actionRequired: input.message,
            }
          : Prisma.DbNull,
    },
  });

  if (status === "completed") {
    await appendMainSessionEvent({
      taskId: input.taskId,
      planId: input.planId,
      sessionId: input.mainSessionId,
      eventType: "execution_completed",
      payload: { totalSteps: input.executedNodeIds.length },
    });
    await completeWorkBlock(input.taskId, input.session.workBlockId);
  }

  await rebuildTaskProjection(input.taskId);

  return buildExecutionResponse({
    taskId: input.taskId,
    planId: input.planId,
    mainSessionId: input.mainSessionId,
    status,
    effective: input.effective,
    currentNodeId: null,
    executedNodeIds: input.executedNodeIds,
    message: input.message,
  });
}

async function advancePlanExecution(input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  mainSession: { id: string; taskId: string; sessionKey: string };
  executionSession: ExecutionSessionRow;
  maxSteps?: number;
  forcedNodeId?: string;
  userInput?: string;
  forcedReplaceStatus?: NonNullable<NodeResult["status"]>;
}): Promise<PlanExecutionResult> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) {
    return {
      taskId: input.taskId,
      planId: null,
      mainSessionId: null,
      status: "no_plan",
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const runtimeName = await getRuntimeName(input.taskId);
  const executedNodeIds: string[] = [];
  let graph = structuredClone(runtime.persisted.graph!);
  let attempts = structuredClone(runtime.persisted.attempts);
  let results = structuredClone(runtime.persisted.results);
  let executionContextSnapshots = structuredClone(
    runtime.persisted.executionContextSnapshots,
  );
  let forcedNodeId = input.forcedNodeId;

  for (let step = 0; step < maxSteps; step++) {
    const effective = resolveEffectivePlanGraph({ graph, attempts, results });

    await appendMainSessionEvent({
      taskId: input.taskId,
      planId: runtime.planId,
      sessionId: input.mainSession.id,
      eventType: "executable_path_computed",
      payload: {
        readyCount: effective.readyNodeIds.length,
        blockedCount: effective.blockedNodeIds.length,
        completedCount: effective.completedNodeIds.length,
        runningCount: effective.runningNodeIds.length,
        failedCount: effective.failedNodeIds.length,
        pendingCount: effective.pendingNodeIds.length,
      },
    });

    if (effective.readyNodeIds.length === 0 && !forcedNodeId) {
      return completeExecution({
        taskId: input.taskId,
        planId: runtime.planId,
        session: input.executionSession,
        mainSessionId: input.mainSession.id,
        effective,
        executedNodeIds,
        message: `Execution ${mapTerminalReasonToStatus(effective)}: no ready nodes`,
      });
    }

    const nextNodeId = pickNextNodeId(effective, forcedNodeId);
    if (!nextNodeId) {
      return completeExecution({
        taskId: input.taskId,
        planId: runtime.planId,
        session: input.executionSession,
        mainSessionId: input.mainSession.id,
        effective,
        executedNodeIds,
        message: "Execution paused: no eligible node found",
      });
    }

    const effectiveNode = effective.nodes.find((node) => node.id === nextNodeId);
    if (!effectiveNode || !effectiveNode.activeLayerId) {
      throw new Error(`Effective node ${nextNodeId} is missing active layer`);
    }
    forcedNodeId = undefined;

    if (input.userInput) {
      results = markNodeResults(
        results,
        nextNodeId,
        input.forcedReplaceStatus ?? "obsolete",
      );
    }

    const executor = dispatchExecutor(effectiveNode);
    if (!executor) {
      results = appendCurrentResult({
        results,
        result: {
          id: `result_${graph.id}_${nextNodeId}_${Date.now()}`,
          taskId: input.taskId,
          graphId: graph.id,
          nodeId: nextNodeId,
          nodeLayerId: effectiveNode.activeLayerId,
          status: "current",
          waitKind: "capability_unavailable",
          error: `No executor for node type: ${effectiveNode.type}`,
        },
      });
      await persistRuntimeState({
        workspaceId: runtime.workspaceId,
        taskId: input.taskId,
        planId: runtime.planId,
        compiledPlan: runtime.compiledPlan,
        graph,
        attempts,
        results,
        executionContextSnapshots,
        existingRun: runtime.persisted.planRun,
      });
      const blockedEffective = resolveEffectivePlanGraph({ graph, attempts, results });
      return pauseExecution({
        taskId: input.taskId,
        planId: runtime.planId,
        mainSessionId: input.mainSession.id,
        session: input.executionSession,
        effective: blockedEffective,
        waitKind: "capability_unavailable",
        currentNodeId: nextNodeId,
        executedNodeIds,
        message: `No executor for node type: ${effectiveNode.type}`,
      });
    }

    const snapshot = createExecutionContextSnapshot({
      graphId: graph.id,
      nodeId: nextNodeId,
      nodeLayerId: effectiveNode.activeLayerId,
      graphVersion: graph.mutations.length,
      runtimeName,
      userInput: input.userInput,
    });
    executionContextSnapshots.push(snapshot);

    const runningAttempt: NodeAttempt = {
      id: `attempt_${graph.id}_${nextNodeId}_${Date.now()}`,
      taskId: input.taskId,
      graphId: graph.id,
      nodeId: nextNodeId,
      nodeLayerId: effectiveNode.activeLayerId,
      executionContextSnapshotId: snapshot.id,
      status: "running",
      idempotencyKey: `${graph.id}:${nextNodeId}:${Date.now()}`,
      attemptNumber:
        attempts.filter((attempt) => attempt.nodeId === nextNodeId).length + 1,
      startedAt: snapshot.createdAt,
    };
    attempts.push(runningAttempt);

    await setExecutionSessionState({
      sessionId: input.executionSession.id,
      status: "Active",
      currentNodeId: nextNodeId,
      pauseReason: null,
      completedNodeIds: effective.completedNodeIds,
    });

    await db.task.update({
      where: { id: input.taskId },
      data: { status: TaskStatus.Running, blockReason: Prisma.DbNull },
    });

    await appendMainSessionEvent({
      taskId: input.taskId,
      planId: runtime.planId,
      sessionId: input.mainSession.id,
      eventType: "node_started",
      payload: {
        nodeId: nextNodeId,
        nodeTitle: effectiveNode.title,
        nodeType: effectiveNode.type,
      },
    });

    await persistRuntimeState({
      workspaceId: runtime.workspaceId,
      taskId: input.taskId,
      planId: runtime.planId,
      compiledPlan: runtime.compiledPlan,
      graph,
      attempts,
      results,
      executionContextSnapshots,
      existingRun: runtime.persisted.planRun,
    });

    const result = await executor.execute({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSession: input.mainSession,
      node: effectiveNode,
      plan: effective,
      trigger: input.trigger,
      runtimeName,
      userInput: input.userInput,
    });

    const finishedAt = new Date().toISOString();
    switch (result.status) {
      case "done": {
        attempts = updateAttemptStatus({
          attempts,
          attemptId: runningAttempt.id,
          status: "succeeded",
          finishedAt,
        });
        results = appendCurrentResult({
          results,
          result: {
            id: `result_${graph.id}_${nextNodeId}_${Date.now()}`,
            taskId: input.taskId,
            graphId: graph.id,
            nodeId: nextNodeId,
            nodeLayerId: effectiveNode.activeLayerId,
            attemptId: runningAttempt.id,
            status: "current",
            outputSummary: result.summary,
            selectedBranch: result.selectedBranch,
          },
        });
        executedNodeIds.push(nextNodeId);
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: runtime.planId,
          sessionId: input.mainSession.id,
          eventType: "node_completed",
          payload: { nodeId: nextNodeId, summary: result.summary },
        });
        break;
      }
      case "waiting_for_user": {
        attempts = updateAttemptStatus({
          attempts,
          attemptId: runningAttempt.id,
          status: "succeeded",
          finishedAt,
        });
        results = appendCurrentResult({
          results,
          result: {
            id: `result_${graph.id}_${nextNodeId}_${Date.now()}`,
            taskId: input.taskId,
            graphId: graph.id,
            nodeId: nextNodeId,
            nodeLayerId: effectiveNode.activeLayerId,
            attemptId: runningAttempt.id,
            status: "current",
            waitKind: "user_input",
            error: result.reason,
          },
        });
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: runtime.planId,
          sessionId: input.mainSession.id,
          eventType: "node_waiting_for_user",
          payload: { nodeId: nextNodeId, prompt: result.prompt },
        });
        await persistRuntimeState({
          workspaceId: runtime.workspaceId,
          taskId: input.taskId,
          planId: runtime.planId,
          compiledPlan: runtime.compiledPlan,
          graph,
          attempts,
          results,
          executionContextSnapshots,
          existingRun: runtime.persisted.planRun,
        });
        return pauseExecution({
          taskId: input.taskId,
          planId: runtime.planId,
          mainSessionId: input.mainSession.id,
          session: input.executionSession,
          effective: resolveEffectivePlanGraph({ graph, attempts, results }),
          waitKind: "user_input",
          currentNodeId: nextNodeId,
          executedNodeIds,
          message: result.prompt,
        });
      }
      case "waiting_for_approval": {
        attempts = updateAttemptStatus({
          attempts,
          attemptId: runningAttempt.id,
          status: "succeeded",
          finishedAt,
        });
        results = appendCurrentResult({
          results,
          result: {
            id: `result_${graph.id}_${nextNodeId}_${Date.now()}`,
            taskId: input.taskId,
            graphId: graph.id,
            nodeId: nextNodeId,
            nodeLayerId: effectiveNode.activeLayerId,
            attemptId: runningAttempt.id,
            status: "current",
            waitKind: "approval",
            error: result.reason,
            review: {
              required: true,
              status: "pending",
            },
          },
        });
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: runtime.planId,
          sessionId: input.mainSession.id,
          eventType: "node_waiting_for_approval",
          payload: { nodeId: nextNodeId, prompt: result.prompt },
        });
        await persistRuntimeState({
          workspaceId: runtime.workspaceId,
          taskId: input.taskId,
          planId: runtime.planId,
          compiledPlan: runtime.compiledPlan,
          graph,
          attempts,
          results,
          executionContextSnapshots,
          existingRun: runtime.persisted.planRun,
        });
        return pauseExecution({
          taskId: input.taskId,
          planId: runtime.planId,
          mainSessionId: input.mainSession.id,
          session: input.executionSession,
          effective: resolveEffectivePlanGraph({ graph, attempts, results }),
          waitKind: "approval",
          currentNodeId: nextNodeId,
          executedNodeIds,
          message: result.prompt,
        });
      }
      case "child_running": {
        attempts = updateAttemptStatus({
          attempts,
          attemptId: runningAttempt.id,
          status: "succeeded",
          finishedAt,
        });
        results = appendCurrentResult({
          results,
          result: {
            id: `result_${graph.id}_${nextNodeId}_${Date.now()}`,
            taskId: input.taskId,
            graphId: graph.id,
            nodeId: nextNodeId,
            nodeLayerId: effectiveNode.activeLayerId,
            attemptId: runningAttempt.id,
            status: "current",
            waitKind: "external_dependency",
            outputSummary: result.summary,
          },
        });
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: runtime.planId,
          sessionId: input.mainSession.id,
          eventType: "child_run_started",
          payload: {
            nodeId: nextNodeId,
            childSessionId: result.evidence.childSessionId,
            childRunId: result.evidence.runId,
            childTaskId: result.evidence.childTaskId,
          },
        });
        await persistRuntimeState({
          workspaceId: runtime.workspaceId,
          taskId: input.taskId,
          planId: runtime.planId,
          compiledPlan: runtime.compiledPlan,
          graph,
          attempts,
          results,
          executionContextSnapshots,
          existingRun: runtime.persisted.planRun,
        });
        return pauseExecution({
          taskId: input.taskId,
          planId: runtime.planId,
          mainSessionId: input.mainSession.id,
          session: input.executionSession,
          effective: resolveEffectivePlanGraph({ graph, attempts, results }),
          waitKind: "external_dependency",
          currentNodeId: nextNodeId,
          executedNodeIds,
          message: result.summary,
        });
      }
      case "blocked": {
        attempts = updateAttemptStatus({
          attempts,
          attemptId: runningAttempt.id,
          status: "failed",
          finishedAt,
          error: { code: "NODE_BLOCKED", message: result.reason },
        });
        results = appendCurrentResult({
          results,
          result: {
            id: `result_${graph.id}_${nextNodeId}_${Date.now()}`,
            taskId: input.taskId,
            graphId: graph.id,
            nodeId: nextNodeId,
            nodeLayerId: effectiveNode.activeLayerId,
            attemptId: runningAttempt.id,
            status: "current",
            waitKind: "manual_action",
            error: result.reason,
          },
        });
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: runtime.planId,
          sessionId: input.mainSession.id,
          eventType: "node_blocked",
          payload: { nodeId: nextNodeId, reason: result.reason },
        });
        await persistRuntimeState({
          workspaceId: runtime.workspaceId,
          taskId: input.taskId,
          planId: runtime.planId,
          compiledPlan: runtime.compiledPlan,
          graph,
          attempts,
          results,
          executionContextSnapshots,
          existingRun: runtime.persisted.planRun,
        });
        return pauseExecution({
          taskId: input.taskId,
          planId: runtime.planId,
          mainSessionId: input.mainSession.id,
          session: input.executionSession,
          effective: resolveEffectivePlanGraph({ graph, attempts, results }),
          waitKind: "manual_action",
          currentNodeId: nextNodeId,
          executedNodeIds,
          message: result.reason,
        });
      }
      case "failed": {
        attempts = updateAttemptStatus({
          attempts,
          attemptId: runningAttempt.id,
          status: "failed",
          finishedAt,
          error: { code: "NODE_FAILED", message: result.error },
        });
        results = appendCurrentResult({
          results,
          result: {
            id: `result_${graph.id}_${nextNodeId}_${Date.now()}`,
            taskId: input.taskId,
            graphId: graph.id,
            nodeId: nextNodeId,
            nodeLayerId: effectiveNode.activeLayerId,
            attemptId: runningAttempt.id,
            status: "rejected",
            error: result.error,
          },
        });
        await persistRuntimeState({
          workspaceId: runtime.workspaceId,
          taskId: input.taskId,
          planId: runtime.planId,
          compiledPlan: runtime.compiledPlan,
          graph,
          attempts,
          results,
          executionContextSnapshots,
          existingRun: runtime.persisted.planRun,
        });
        await setExecutionSessionState({
          sessionId: input.executionSession.id,
          status: "Abandoned",
          currentNodeId: nextNodeId,
          pauseReason: "manual_action",
          completedNodeIds: resolveEffectivePlanGraph({ graph, attempts, results }).completedNodeIds,
        });
        await db.task.update({
          where: { id: input.taskId },
          data: {
            status: TaskStatus.Failed,
            blockReason: {
              blockType: "node_failed",
              scope: "plan_node",
              actionRequired: result.error,
              nodeId: nextNodeId,
            },
          },
        });
        await rebuildTaskProjection(input.taskId);
        return buildExecutionResponse({
          taskId: input.taskId,
          planId: runtime.planId,
          mainSessionId: input.mainSession.id,
          status: "blocked",
          effective: resolveEffectivePlanGraph({ graph, attempts, results }),
          currentNodeId: nextNodeId,
          executedNodeIds,
          message: result.error,
        });
      }
      case "replan_required": {
        attempts = updateAttemptStatus({
          attempts,
          attemptId: runningAttempt.id,
          status: "succeeded",
          finishedAt,
        });
        results = appendCurrentResult({
          results,
          result: {
            id: `result_${graph.id}_${nextNodeId}_${Date.now()}`,
            taskId: input.taskId,
            graphId: graph.id,
            nodeId: nextNodeId,
            nodeLayerId: effectiveNode.activeLayerId,
            attemptId: runningAttempt.id,
            status: "current",
            waitKind: "approval",
            error: result.reason,
            review: {
              required: true,
              status: "request_changes",
              feedback: result.reason,
            },
          },
        });
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: runtime.planId,
          sessionId: input.mainSession.id,
          eventType: "replan_proposed",
          payload: { nodeId: nextNodeId, reason: result.reason },
        });
        await persistRuntimeState({
          workspaceId: runtime.workspaceId,
          taskId: input.taskId,
          planId: runtime.planId,
          compiledPlan: runtime.compiledPlan,
          graph,
          attempts,
          results,
          executionContextSnapshots,
          existingRun: runtime.persisted.planRun,
        });
        return pauseExecution({
          taskId: input.taskId,
          planId: runtime.planId,
          mainSessionId: input.mainSession.id,
          session: input.executionSession,
          effective: resolveEffectivePlanGraph({ graph, attempts, results }),
          waitKind: "approval",
          currentNodeId: nextNodeId,
          executedNodeIds,
          message: result.reason,
        });
      }
    }

    await persistRuntimeState({
      workspaceId: runtime.workspaceId,
      taskId: input.taskId,
      planId: runtime.planId,
      compiledPlan: runtime.compiledPlan,
      graph,
      attempts,
      results,
      executionContextSnapshots,
      existingRun: runtime.persisted.planRun,
    });
    input.userInput = undefined;
  }

  await rebuildTaskProjection(input.taskId);
  const effective = resolveEffectivePlanGraph({ graph, attempts, results });
  return buildExecutionResponse({
    taskId: input.taskId,
    planId: runtime.planId,
    mainSessionId: input.mainSession.id,
    status: "running",
    effective,
    currentNodeId: input.executionSession.currentNodeId,
    executedNodeIds,
    message: "Max steps reached. Call advancePlanExecution again to continue.",
  });
}

export async function startPlanExecution(input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  prompt?: string;
}): Promise<PlanExecutionResult> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) {
    return {
      taskId: input.taskId,
      planId: null,
      mainSessionId: null,
      status: "no_plan",
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const executionSession = await ensureExecutionSession({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    trigger: input.trigger,
  });
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
  });

  await activateWorkBlock(input.taskId, executionSession.workBlockId);
  await appendMainSessionEvent({
    taskId: input.taskId,
    planId: runtime.planId,
    sessionId: mainSession.id,
    eventType: "execution_started",
    payload: { trigger: input.trigger, prompt: input.prompt },
  });

  return advancePlanExecution({
    taskId: input.taskId,
    trigger: input.trigger,
    mainSession,
    executionSession,
  });
}

export async function continuePlanExecution(input: {
  taskId: string;
  reason: string;
  userInput?: string;
}): Promise<PlanExecutionResult> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) {
    return {
      taskId: input.taskId,
      planId: null,
      mainSessionId: null,
      status: "no_plan",
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const executionSession = await ensureExecutionSession({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    trigger: "manual",
  });
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
  });

  if (input.userInput) {
    await appendMainSessionEvent({
      taskId: input.taskId,
      planId: runtime.planId,
      sessionId: mainSession.id,
      eventType: "user_input_received",
      payload: { input: input.userInput, reason: input.reason },
    });
  }

  const effective = resolveEffectivePlanGraph({
      graph: runtime.persisted.graph!,
    attempts: runtime.persisted.attempts,
    results: runtime.persisted.results,
  });
  const waitingNode =
    effective.nodes.find((node) => node.id === executionSession.currentNodeId) ??
    effective.nodes.find(
      (node) =>
        node.status === "waiting_for_user" ||
        node.status === "waiting_for_approval" ||
        node.status === "blocked",
    ) ??
    null;

  return advancePlanExecution({
    taskId: input.taskId,
    trigger: "manual",
    mainSession,
    executionSession,
    userInput: input.userInput,
    forcedNodeId: waitingNode?.id,
    forcedReplaceStatus: "obsolete",
  });
}

export async function dispatchExecutionAction(input: {
  taskId: string;
  action: ExecutionActionInput;
}): Promise<PlanExecutionResult> {
  switch (input.action.action) {
    case "start_manual":
      return startPlanExecution({
        taskId: input.taskId,
        trigger: "manual",
        prompt: input.action.prompt,
      });
    case "start_scheduled":
      return startPlanExecution({
        taskId: input.taskId,
        trigger: "scheduler",
      });
    case "resume_with_input":
      return continuePlanExecution({
        taskId: input.taskId,
        reason: "user_input",
        userInput: input.action.inputText,
      });
    case "resume_with_approval":
      return continuePlanExecution({
        taskId: input.taskId,
        reason: `approval:${input.action.decision}`,
        userInput: input.action.feedback ?? input.action.editedContent,
      });
    case "resume_after_unblock":
      return continuePlanExecution({
        taskId: input.taskId,
        reason: "resume_after_unblock",
        userInput: input.action.note,
      });
    case "retry_node": {
      const runtime = await ensureNativePlanRun(input.taskId);
      if (!runtime) {
        return {
          taskId: input.taskId,
          planId: null,
          mainSessionId: null,
          status: "no_plan",
          currentNodeId: null,
          executedNodeIds: [],
          waitingNodeIds: [],
          blockedNodeIds: [],
          message: "No accepted plan. Create or accept a plan before execution.",
        };
      }

      const executionSession = await ensureExecutionSession({
        workspaceId: runtime.workspaceId,
        taskId: input.taskId,
        planId: runtime.planId,
        trigger: "manual",
        sessionId: input.action.sessionId,
      });
      const mainSession = await ensurePlanMainSession({
        taskId: input.taskId,
        planId: runtime.planId,
      });
      const attempts = cancelActiveAttempt(
        runtime.persisted.attempts,
        input.action.nodeId,
        input.action.prompt ?? "Node retry requested",
      );
      const results = markNodeResults(runtime.persisted.results, input.action.nodeId, "obsolete");
      await persistRuntimeState({
        workspaceId: runtime.workspaceId,
        taskId: input.taskId,
        planId: runtime.planId,
        compiledPlan: runtime.compiledPlan,
        graph: runtime.persisted.graph!,
        attempts,
        results,
        executionContextSnapshots: runtime.persisted.executionContextSnapshots,
        existingRun: runtime.persisted.planRun,
      });

      return advancePlanExecution({
        taskId: input.taskId,
        trigger: "manual",
        mainSession,
        executionSession,
        userInput: input.action.prompt,
        forcedNodeId: input.action.nodeId,
        forcedReplaceStatus: "obsolete",
      });
    }
    case "cancel_session": {
      const runtime = await ensureNativePlanRun(input.taskId);
      if (!runtime) {
        return {
          taskId: input.taskId,
          planId: null,
          mainSessionId: input.action.sessionId ?? null,
          status: "no_plan",
          currentNodeId: null,
          executedNodeIds: [],
          waitingNodeIds: [],
          blockedNodeIds: [],
          message: "No accepted plan. Create or accept a plan before execution.",
        };
      }

      const executionSession = await ensureExecutionSession({
        workspaceId: runtime.workspaceId,
        taskId: input.taskId,
        planId: runtime.planId,
        trigger: "manual",
        sessionId: input.action.sessionId,
      });
      const attempts = cancelActiveAttempt(
        runtime.persisted.attempts,
        executionSession.currentNodeId ?? "",
        input.action.reason ?? "Execution cancelled",
      );
      await persistRuntimeState({
        workspaceId: runtime.workspaceId,
        taskId: input.taskId,
        planId: runtime.planId,
        compiledPlan: runtime.compiledPlan,
        graph: runtime.persisted.graph!,
        attempts,
        results: runtime.persisted.results,
        executionContextSnapshots: runtime.persisted.executionContextSnapshots,
        existingRun: runtime.persisted.planRun,
      });
      await setExecutionSessionState({
        sessionId: executionSession.id,
        status: "Abandoned",
        currentNodeId: null,
        pauseReason: input.action.reason ?? "cancelled",
        completedNodeIds: resolveEffectivePlanGraph({
          graph: runtime.persisted.graph!,
          attempts,
          results: runtime.persisted.results,
        }).completedNodeIds,
      });
      await cancelWorkBlock(input.taskId, executionSession.workBlockId);
      await db.task.update({
        where: { id: input.taskId },
        data: {
          status: TaskStatus.Cancelled,
          blockReason: {
            blockType: "execution_cancelled",
            scope: "plan_execution",
            actionRequired: input.action.reason ?? "Execution cancelled",
          },
        },
      });
      await rebuildTaskProjection(input.taskId);
      return {
        taskId: input.taskId,
        planId: runtime.planId,
        mainSessionId: executionSession.id,
        status: "cancelled",
        currentNodeId: null,
        executedNodeIds: [],
        waitingNodeIds: [],
        blockedNodeIds: [],
        message: input.action.reason ?? "Execution cancelled",
      };
    }
    default: {
      const exhaustiveCheck: never = input.action;
      throw new Error(`Unsupported execution action: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
