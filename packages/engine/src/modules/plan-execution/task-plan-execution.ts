import { Prisma, RunStatus, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import {
  ensurePlanMainSession,
  appendMainSessionEvent,
} from "./plan-state-store";
import { HERMES_EXECUTION_RUNTIME } from "@chrona/hermes";
import {
  createPlanGraphFromCompiledPlan,
  getPlanRun,
  savePlanRun,
} from "./plan-run-store";
import { getAcceptedCompiledPlan } from "./compiled-plan-store";
import {
  resolveEffectivePlanGraph,
  createGraphRuntime,
} from "@chrona/graph-runtime";
import type {
  GraphDispatchOutcome,
  GraphExecutionEvent,
  GraphExecutionState,
} from "@chrona/graph-runtime";
import type {
  CompiledPlan,
  EffectivePlanGraph,
  EffectivePlanNode,
  ExecutionActionInput,
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeResult,
  PlanGraph,
  PlanExecutionResult,
  PlanExecutionStatus,
  PlanRun,
  WaitKind,
} from "@chrona/contracts/ai";
import type { ProviderRunEvent } from "@chrona/providers-foundation";
import type { NodeExecutor } from "./node-executors/types";
import { TaskNodeExecutor } from "./node-executors/task-executor";
import { CheckpointNodeExecutor } from "./node-executors/checkpoint-executor";
import { ConditionNodeExecutor } from "./node-executors/condition-executor";
import { WaitNodeExecutor } from "./node-executors/wait-executor";
import { AiRuntimeInvoker } from "./ai-runtime-invoker";
import { branchBindingForRef } from "./node-runtime-refs";
import { createLogger } from "@chrona/shared/logger";

type OrchestratorTrigger = "manual" | "scheduler" | "system" | "auto";

type PlanExecutionObserver = {
  onGraphEvent?: (event: GraphExecutionEvent) => Promise<void> | void;
  onRuntimeEvent?: (event: PlanExecutionRuntimeEvent) => Promise<void> | void;
  onStateChange?: (effectivePlan: EffectivePlanGraph) => Promise<void> | void;
};

export type PlanExecutionRuntimeEvent = {
  nodeId: string;
  nodeTitle: string;
  runtimeName: string;
  event: ProviderRunEvent;
};

type ExecutionSessionRow = Awaited<ReturnType<typeof ensureExecutionSession>>;

const DEFAULT_MAX_STEPS = 10;
const logger = createLogger("engine.plan-execution");
const ACTIVE_RUN_STATUSES = [
  RunStatus.Pending,
  RunStatus.Running,
  RunStatus.WaitingForApproval,
  RunStatus.WaitingForInput,
] as const;

function createNodeExecutors(input: {
  aiRuntimeInvoker: AiRuntimeInvoker;
}): NodeExecutor[] {
  return [
    new TaskNodeExecutor(input.aiRuntimeInvoker),
    new CheckpointNodeExecutor(input.aiRuntimeInvoker),
    new ConditionNodeExecutor(input.aiRuntimeInvoker),
    new WaitNodeExecutor(),
  ];
}

const executors = createNodeExecutors({
  aiRuntimeInvoker: new AiRuntimeInvoker(),
});

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

function mapWaitKindToExecutionStatus(
  waitKind: WaitKind | undefined,
): PlanExecutionStatus {
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

function mapTerminalReasonToStatus(
  effective: EffectivePlanGraph,
): PlanExecutionStatus {
  if (effective.readyNodeIds.length > 0) return "running";
  if (effective.runningNodeIds.length > 0) return "running";
  if (effective.nodes.some((node) => node.status === "waiting_for_user")) {
    return "waiting_for_user";
  }
  if (effective.nodes.some((node) => node.status === "waiting_for_approval")) {
    return "waiting_for_approval";
  }
  if (
    effective.blockedNodeIds.length > 0 ||
    effective.failedNodeIds.length > 0
  ) {
    return "blocked";
  }
  const reachableNodeIds = effective.nodes.filter((node) => node.reachable).map((node) => node.id);
  if (reachableNodeIds.every((nodeId) => effective.completedNodeIds.includes(nodeId)))
    return "completed";
  return "blocked";
}

function planRunStatusForExecutionStatus(status: PlanExecutionStatus): PlanRun["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "running":
      return "running";
    case "cancelled":
      return "cancelled";
    case "waiting_for_user":
    case "waiting_for_approval":
    case "blocked":
      return "paused";
    default:
      return "pending";
  }
}

function graphStatusForExecutionStatus(status: PlanExecutionStatus): PlanGraph["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "waiting_for_user":
    case "waiting_for_approval":
    case "blocked":
      return "paused";
    default:
      return "active";
  }
}

async function getRuntimeName(taskId: string): Promise<string> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { executionRuntime: true },
  });
  return task.executionRuntime ?? HERMES_EXECUTION_RUNTIME;
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
  const explicitSession = input.sessionId
    ? await db.executionSession.findFirst({
        where: { id: input.sessionId, taskId: input.taskId },
      })
    : null;
  const candidates = explicitSession
    ? []
    : await db.executionSession.findMany({
        where: {
          taskId: input.taskId,
          status: { in: ["Active", "Paused"] },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 10,
      });
  const existing = explicitSession ??
    candidates.find((candidate) => candidate.currentNodeId) ??
    candidates[0] ??
    null;

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

async function markExecutionNodeActive(input: {
  taskId: string;
  sessionId?: string | null;
  currentNodeId: string | null;
  completedNodeIds?: string[];
}) {
  const now = new Date();
  const sessionUpdate = input.sessionId
    ? await db.executionSession.updateMany({
        where: {
          id: input.sessionId,
          status: { notIn: ["Completed", "Abandoned"] },
        },
        data: {
          status: "Active",
          currentNodeId: input.currentNodeId,
          pauseReason: null,
          completedNodeIds: input.completedNodeIds
            ? JSON.stringify(input.completedNodeIds)
            : undefined,
          pausedAt: null,
          completedAt: null,
          updatedAt: now,
        },
      })
    : { count: 0 };
  const taskUpdate = await db.task.updateMany({
    where: {
      id: input.taskId,
      completedAt: null,
      status: { notIn: [TaskStatus.Completed, TaskStatus.Done, TaskStatus.Cancelled] },
    },
    data: { status: TaskStatus.Running, blockReason: Prisma.DbNull },
  });

  if (taskUpdate.count > 0 || sessionUpdate.count > 0) {
    await rebuildTaskProjection(input.taskId);
  }
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

function buildExecutionResponse(input: {
  taskId: string;
  planId: string;
  mainSessionId: string;
  status: PlanExecutionStatus;
  effective: EffectivePlanGraph;
  currentNodeId: string | null;
  executedNodeIds: string[];
  message: string;
  errorDetails?: unknown;
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
    ...(input.errorDetails ? { errorDetails: input.errorDetails } : {}),
  };
}

function completedExecutionNodeIds(effective: EffectivePlanGraph) {
  return effective.nodes.filter((node) => node.status === "completed").map((node) => node.id);
}

function errorDetailsFromOutcome(outcome: GraphDispatchOutcome): unknown {
  const failedAttempt = outcome.state.attempts.find((attempt) => attempt.status === "failed" && attempt.error?.details);
  return failedAttempt?.error?.details;
}

function toEffectivePlanGraph(input: {
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
}): EffectivePlanGraph {
  return resolveEffectivePlanGraph({
    graph: input.graph,
    attempts: input.attempts,
    results: input.results,
  }) as unknown as EffectivePlanGraph;
}

function hasCurrentNodeResult(input: {
  results: NodeResult[];
  nodeId: string;
}) {
  return input.results.some(
    (result) =>
      result.nodeId === input.nodeId &&
      (result.status === "current" || result.status === "rejected"),
  );
}

async function committedStateIfNodeAdvanced(input: {
  taskId: string;
  planId: string;
  nodeId: string | null;
  results: NodeResult[];
}) {
  if (!input.nodeId || hasCurrentNodeResult({ results: input.results, nodeId: input.nodeId })) {
    return null;
  }

  const committed = await getPlanRun(input.taskId, input.planId);
  if (!committed?.graph) return null;
  if (!hasCurrentNodeResult({ results: committed.results, nodeId: input.nodeId })) {
    return null;
  }

  return committed;
}

async function committedStateIfRunningNodeAdvanced(input: {
  taskId: string;
  planId: string;
  state: GraphExecutionState;
}) {
  const runningNodeId = [...(input.state.attempts as unknown as NodeAttempt[])]
    .reverse()
    .find((attempt) => attempt.status === "running")?.nodeId ?? null;

  return committedStateIfNodeAdvanced({
    taskId: input.taskId,
    planId: input.planId,
    nodeId: runningNodeId,
    results: input.state.results as unknown as NodeResult[],
  });
}

async function convergeExecutionToCommittedState(input: {
  taskId: string;
  planId: string;
  mainSessionId: string;
  session: ExecutionSessionRow;
  workspaceId: string;
  compiledPlan: CompiledPlan;
  committed: NonNullable<Awaited<ReturnType<typeof getPlanRun>>>;
  fallbackMessage: string;
}): Promise<PlanExecutionResult> {
  if (!input.committed.graph) {
    throw new Error("Plan runtime graph missing");
  }
  const effective = toEffectivePlanGraph({
    graph: input.committed.graph,
    attempts: input.committed.attempts,
    results: input.committed.results,
  });
  const status = mapTerminalReasonToStatus(effective);
  const currentNodeId =
    currentNodeFromEffective(effective)?.id ??
    input.committed.attempts.findLast((attempt) => attempt.status === "failed")?.nodeId ??
    "";

  if (status === "completed") {
    return completeExecution({
      taskId: input.taskId,
      planId: input.planId,
      session: input.session,
      workspaceId: input.workspaceId,
      compiledPlan: input.compiledPlan,
      persisted: input.committed,
      mainSessionId: input.mainSessionId,
      effective,
      executedNodeIds: effective.completedNodeIds,
      message: input.fallbackMessage,
    });
  }

  if (status === "running") {
    await markExecutionNodeActive({
      taskId: input.taskId,
      sessionId: input.session.id,
      currentNodeId: currentNodeId || null,
      completedNodeIds: effective.completedNodeIds,
    });
    return buildExecutionResponse({
      taskId: input.taskId,
      planId: input.planId,
      mainSessionId: input.mainSessionId,
      status,
      effective,
      currentNodeId: currentNodeId || null,
      executedNodeIds: effective.completedNodeIds,
      message: input.fallbackMessage,
    });
  }

  return pauseExecution({
    taskId: input.taskId,
    planId: input.planId,
    mainSessionId: input.mainSessionId,
    session: input.session,
    effective,
    waitKind:
      status === "waiting_for_user"
        ? "user_input"
        : status === "waiting_for_approval"
          ? "approval"
          : "manual_action",
    currentNodeId,
    executedNodeIds: effective.completedNodeIds,
    message: input.fallbackMessage,
  });
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

async function persistTerminalRuntimeState(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  compiledPlan: CompiledPlan;
  persisted: NonNullable<Awaited<ReturnType<typeof getPlanRun>>>;
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
  errorDetails?: unknown;
}) {
  await setExecutionSessionState({
    sessionId: input.session.id,
    status: "Paused",
    currentNodeId: input.currentNodeId,
    pauseReason: input.waitKind ?? "manual_action",
    completedNodeIds: completedExecutionNodeIds(input.effective),
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
    errorDetails: input.errorDetails,
  });
}

async function completeActiveRunsForTask(taskId: string) {
  const now = new Date();
  await db.run.updateMany({
    where: {
      taskId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    data: {
      status: RunStatus.Completed,
      endedAt: now,
      errorSummary: null,
      retryable: false,
      resumeSupported: false,
      pendingInputPrompt: null,
      lastSyncedAt: now,
      syncStatus: "healthy",
      mappingPartial: false,
    },
  });
}

async function completeExecution(input: {
  taskId: string;
  planId: string;
  session: ExecutionSessionRow;
  workspaceId?: string;
  compiledPlan?: CompiledPlan;
  persisted?: NonNullable<Awaited<ReturnType<typeof getPlanRun>>>;
  mainSessionId: string;
  effective: EffectivePlanGraph;
  executedNodeIds: string[];
  message: string;
}) {
  const status = mapTerminalReasonToStatus(input.effective);
  if (input.workspaceId && input.compiledPlan && input.persisted) {
    await persistTerminalRuntimeState({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      compiledPlan: input.compiledPlan,
      persisted: input.persisted,
      effective: input.effective,
      status,
    });
  }
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
    completedNodeIds: completedExecutionNodeIds(input.effective),
  });

  if (status === "completed") {
    await completeActiveRunsForTask(input.taskId);
  }

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

type EngineRuntimeContext = {
  taskId: string;
  planId: string;
  mainSession: { id: string; taskId: string; sessionKey: string };
};

export type SyncPlanRunRuntimeResultInput = {
  taskId: string;
  runtimeRunRef: string;
  status: "Completed" | "Failed" | "Cancelled";
  summary?: string | null;
  error?: string | null;
  output?: unknown;
};

type AdvanceRuntimeCommand =
  | { type: "start" }
  | {
      type: "resume_with_input";
      nodeId: string;
      value: string;
      replaceStatus?: NonNullable<NodeResult["status"]>;
    }
  | { type: "resume_after_unblock"; nodeId?: string }
  | {
      type: "complete_manual_node";
      nodeId?: string;
      summary?: string;
      output?: unknown;
      selectedBranch?: NodeResult["selectedBranch"];
      terminalKind?: "task" | "condition" | "checkpoint" | "wait";
      branchRef?: string;
      decision?: "approved" | "rejected" | "needs_input" | "completed";
      feedback?: string;
      prompt?: string;
      continueExecution?: boolean;
    }
  | { type: "block_current_node"; nodeId?: string; reason: string }
  | { type: "fail_current_node"; nodeId?: string; error: string }
  | {
      type: "resume_with_approval";
      nodeId: string;
      approved: boolean;
      feedback?: string;
    }
  | { type: "retry_node"; nodeId: string; reason?: string; userInput?: string }
  | { type: "cancel_session"; reason?: string };

type ExecutionActionWithContinuation =
  | Exclude<ExecutionActionInput, { action: "complete_manual_node" }>
  | (Extract<ExecutionActionInput, { action: "complete_manual_node" }> & {
      continueExecution?: boolean;
    });

function toGraphExecutionState(
  persisted: NonNullable<Awaited<ReturnType<typeof getPlanRun>>>,
): GraphExecutionState {
  if (!persisted.graph) {
    throw new Error("Plan runtime graph missing");
  }

  return {
    graph: structuredClone(persisted.graph),
    attempts: structuredClone(persisted.attempts),
    results: structuredClone(persisted.results),
    executionContextSnapshots: structuredClone(
      persisted.executionContextSnapshots,
    ),
  } as GraphExecutionState;
}

function waitKindFromOutcome(outcome: GraphDispatchOutcome): WaitKind {
  if (outcome.waitKind) return outcome.waitKind;
  if (outcome.status === "waiting_for_user") return "user_input";
  if (outcome.status === "waiting_for_approval") return "approval";
  return "manual_action";
}

function currentNodeFromOutcome(outcome: GraphDispatchOutcome): string | null {
  if (outcome.status === "running" && outcome.currentNodeId === null) {
    return null;
  }
  return (
    outcome.currentNodeId ??
    currentNodeFromEffective(outcome.effective as unknown as EffectivePlanGraph)?.id ??
    null
  );
}

function currentNodeFromEffective(effective: EffectivePlanGraph) {
  return (
    effective.nodes.find((node) => node.status === "running") ??
    effective.nodes.find(
      (node) =>
        node.status === "waiting_for_user" ||
        node.status === "waiting_for_approval" ||
        node.status === "blocked" ||
        node.status === "failed",
    ) ??
    null
  );
}

function summaryForTerminalCommand(input: {
  command: Extract<AdvanceRuntimeCommand, { type: "complete_manual_node" }>;
  node: EffectivePlanNode;
}): string {
  const summary = input.command.summary?.trim();
  if (summary) return summary;
  if (input.command.terminalKind === "checkpoint") {
    return `Checkpoint ${input.command.decision ?? "completed"}: ${input.node.title}`;
  }
  return `Manual node ${input.node.id} completed`;
}

function selectedBranchForTerminalCommand(input: {
  plan: EffectivePlanGraph;
  node: EffectivePlanNode;
  command: Extract<AdvanceRuntimeCommand, { type: "complete_manual_node" }>;
}): NodeResult["selectedBranch"] | undefined {
  if (input.command.terminalKind !== "condition") {
    return input.command.selectedBranch;
  }
  if (!input.command.branchRef) {
    throw new Error("condition branchRef is required");
  }
  const binding = branchBindingForRef({
    plan: input.plan,
    node: input.node,
    branchRef: input.command.branchRef,
  });
  return {
    ref: binding.ref,
    key: binding.branchKey,
    label: binding.label,
    nextNodeId: binding.nextNodeId!,
    resolvedNextNodeId: binding.nextNodeId,
    resolvedNextNodeLayerId: binding.nextNodeLayerId ?? null,
    refVersion: binding.version,
    source: "ai",
  };
}

function validateTerminalCommand(input: {
  plan: EffectivePlanGraph;
  node: EffectivePlanNode;
  command: Extract<AdvanceRuntimeCommand, { type: "complete_manual_node" }>;
}) {
  const kind = input.command.terminalKind;
  if (!kind) return;
  if (input.node.type !== kind) {
    throw new Error(`chrona ${kind} terminal tool cannot complete current ${input.node.type} node`);
  }
  if (kind === "condition") {
    selectedBranchForTerminalCommand(input);
  }
  if (kind === "checkpoint") {
    const decision = input.command.decision;
    if (!decision) throw new Error("checkpoint decision is required");
    if (decision === "needs_input" && !input.command.feedback && !input.command.prompt) {
      throw new Error("checkpoint needs_input requires feedback or prompt");
    }
    if (decision === "completed" && !input.command.summary) {
      throw new Error("checkpoint completed requires summary");
    }
  }
}

function latestStartedNodeId(events: GraphExecutionEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "node_started") {
      return event.node.id;
    }
  }
  return null;
}

function currentNodeFromState(input: {
  effective: EffectivePlanGraph;
  executionSession: ExecutionSessionRow;
  nodeId?: string;
}) {
  return (
    (input.nodeId
      ? input.effective.nodes.find((node) => node.id === input.nodeId)
      : null) ??
    input.effective.nodes.find(
      (node) => node.id === input.executionSession.currentNodeId,
    ) ??
    input.effective.nodes.find((node) => node.status === "running") ??
    input.effective.nodes.find(
      (node) =>
        node.status === "waiting_for_user" ||
        node.status === "waiting_for_approval" ||
        node.status === "blocked" ||
        node.status === "failed",
    ) ??
    null
  );
}

async function appendGraphRuntimeEvents(input: {
  taskId: string;
  planId: string;
  sessionId: string;
  events: GraphExecutionEvent[];
}) {
  for (const event of input.events) {
    switch (event.type) {
      case "command_received":
      case "command_unsupported":
      case "command_validation_failed":
        break;
      case "executable_path_computed":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "executable_path_computed",
          payload: {
            readyCount: event.effective.readyNodeIds.length,
            blockedCount: event.effective.blockedNodeIds.length,
            completedCount: event.effective.completedNodeIds.length,
            runningCount: event.effective.runningNodeIds.length,
            failedCount: event.effective.failedNodeIds.length,
            pendingCount: event.effective.pendingNodeIds.length,
          },
        });
        break;
      case "node_started":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "node_started",
          payload: {
            nodeId: event.node.id,
            nodeTitle: event.node.title,
            nodeType: event.node.type,
          },
        });
        break;
      case "node_completed":
        if (event.result.status !== "done") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "node_completed",
          payload: { nodeId: event.node.id, summary: event.result.summary },
        });
        break;
      case "node_waiting_for_user":
        if (event.result.status !== "waiting_for_user") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "node_waiting_for_user",
          payload: { nodeId: event.node.id, prompt: event.result.prompt },
        });
        break;
      case "node_waiting_for_approval":
        if (event.result.status !== "waiting_for_approval") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "node_waiting_for_approval",
          payload: { nodeId: event.node.id, prompt: event.result.prompt },
        });
        break;
      case "node_blocked":
        if (event.result.status !== "blocked") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "node_blocked",
          payload: { nodeId: event.node.id, reason: event.result.reason },
        });
        break;
      case "replan_proposed":
        if (event.result.status !== "replan_required") break;
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "replan_proposed",
          payload: { nodeId: event.node.id, reason: event.result.reason },
        });
        break;
      case "graph_mutation_applied":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "graph_mutation_applied",
          payload: {
            mutationId: event.mutationId,
            affectedNodeIds: event.affectedNodeIds,
          },
        });
        break;
      case "external_result_synced":
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId: input.planId,
          sessionId: input.sessionId,
          eventType: "external_result_synced",
          payload: { nodeId: event.nodeId, status: event.status },
        });
        break;
    }
  }
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
  command?: AdvanceRuntimeCommand;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
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

  const runtimeName = await getRuntimeName(input.taskId);
  const state = toGraphExecutionState(runtime.persisted);
  const context: EngineRuntimeContext = {
    taskId: input.taskId,
    planId: runtime.planId,
    mainSession: input.mainSession,
  };
  const graphRuntime = createGraphRuntime<EngineRuntimeContext>({
    taskId: input.taskId,
    runtimeName,
    policies: { maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS },
    callbacks: {
      onEvent: async (event) => {
        if (event.type === "node_started") {
          await markExecutionNodeActive({
            taskId: input.taskId,
            sessionId: input.executionSession.id,
            currentNodeId: event.node.id,
          });
        }
        await input.onGraphEvent?.(event);
      },
      onStateChange: async (state) => {
        const committed = await committedStateIfRunningNodeAdvanced({
          taskId: input.taskId,
          planId: runtime.planId,
          state,
        });
        if (committed?.graph) {
          await input.onStateChange?.(toEffectivePlanGraph({
            graph: committed.graph,
            attempts: committed.attempts,
            results: committed.results,
          }));
          return;
        }
        await persistRuntimeState({
          workspaceId: runtime.workspaceId,
          taskId: input.taskId,
          planId: runtime.planId,
          compiledPlan: runtime.compiledPlan,
          graph: state.graph as unknown as PlanGraph,
          attempts: state.attempts as unknown as NodeAttempt[],
          results: state.results as unknown as NodeResult[],
          executionContextSnapshots: state.executionContextSnapshots as unknown as ExecutionContextSnapshot[],
          existingRun: runtime.persisted.planRun,
        });
        await input.onStateChange?.(resolveEffectivePlanGraph(state));
      },
      executeNode: async (executorInput) => {
        const engineNode = executorInput.node as unknown as EffectivePlanNode;
        const enginePlan = executorInput.plan as unknown as EffectivePlanGraph;
        const executor = executors.find((candidate) =>
          candidate.canExecute(engineNode),
        );
        if (!executor) return null;
        return executor.execute({
          taskId: input.taskId,
          planId: runtime.planId,
          mainSession: input.mainSession,
          node: engineNode,
          plan: enginePlan,
          trigger: executorInput.trigger,
          runtimeName,
          userInput: executorInput.userInput,
          onRuntimeEvent: input.onRuntimeEvent
            ? (event) => input.onRuntimeEvent?.({
                nodeId: engineNode.id,
                nodeTitle: engineNode.title,
                runtimeName,
                event,
              })
            : undefined,
        }) as ReturnType<typeof executor.execute>;
      },
    },
  });
  const command = input.command;
  const effectiveBeforeCommand = command && (
    command.type === "complete_manual_node" ||
    command.type === "block_current_node" ||
    command.type === "fail_current_node"
  )
    ? resolveEffectivePlanGraph(state)
    : null;
  if (command && effectiveBeforeCommand && mapTerminalReasonToStatus(effectiveBeforeCommand) === "completed") {
    return buildExecutionResponse({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSessionId: input.mainSession.id,
      status: "completed",
      effective: effectiveBeforeCommand,
      currentNodeId: null,
      executedNodeIds: effectiveBeforeCommand.completedNodeIds,
      message: "Execution already completed; node result ignored.",
    });
  }
  const commandNode = command && (
    command.type === "complete_manual_node" ||
    command.type === "block_current_node" ||
    command.type === "fail_current_node"
  )
    ? currentNodeFromState({
        effective: effectiveBeforeCommand!,
        executionSession: input.executionSession,
        nodeId: command.nodeId,
      })
    : null;
  if (command && (
    command.type === "complete_manual_node" ||
    command.type === "block_current_node" ||
    command.type === "fail_current_node"
  ) && !commandNode) {
    throw new Error("No current execution node found for node result tool.");
  }
  if (command?.type === "complete_manual_node" && commandNode && effectiveBeforeCommand) {
    validateTerminalCommand({
      plan: effectiveBeforeCommand,
      node: commandNode,
      command,
    });
  }
  const dispatchCommand = command
    ? command.type === "resume_with_input"
      ? {
          type: "resume_with_input" as const,
          state,
          trigger: input.trigger,
          context,
          input: {
            nodeId: command.nodeId,
            value: command.value,
            replaceStatus: command.replaceStatus,
          },
        }
      : command.type === "resume_after_unblock"
        ? {
            type: "resume_after_unblock" as const,
            state,
            trigger: input.trigger,
            context,
            nodeId: command.nodeId,
          }
      : command.type === "resume_with_approval"
        ? {
            type: "resume_with_approval" as const,
              state,
              trigger: input.trigger,
              context,
              input: {
                nodeId: command.nodeId,
                approved: command.approved,
                feedback: command.feedback,
                userInput: command.feedback,
              },
            }
          : command.type === "complete_manual_node"
            ? {
                type: "sync_external_result" as const,
                state,
                trigger: input.trigger,
                context,
                  externalResult: {
                    nodeId: commandNode!.id,
                    status: "done" as const,
                    summary: summaryForTerminalCommand({
                      command,
                      node: commandNode!,
                    }),
                    output: command.output,
                    selectedBranch: selectedBranchForTerminalCommand({
                      plan: effectiveBeforeCommand!,
                      node: commandNode!,
                      command,
                    }),
                  },
                  continueExecution: command.continueExecution,
                }
            : command.type === "block_current_node"
              ? {
                  type: "sync_external_result" as const,
                  state,
                  trigger: input.trigger,
                  context,
                  externalResult: {
                    nodeId: commandNode!.id,
                    status: "blocked" as const,
                    reason: command.reason,
                  },
                }
              : command.type === "fail_current_node"
                ? {
                    type: "sync_external_result" as const,
                    state,
                    trigger: input.trigger,
                    context,
                    externalResult: {
                      nodeId: commandNode!.id,
                      status: "failed" as const,
                      error: command.error,
                    },
                  }
            : command.type === "retry_node"
            ? {
                type: "retry_node" as const,
                state,
                trigger: input.trigger,
                context,
                nodeId: command.nodeId,
                reason: command.reason,
                userInput: command.reason,
              }
            : command.type === "cancel_session"
              ? {
                  type: "cancel_session" as const,
                  state,
                  trigger: input.trigger,
                  context,
                  reason: command.reason,
                }
              : {
                  type: "start" as const,
                  state,
                  trigger: input.trigger,
                  context,
                }
    : input.forcedNodeId && input.userInput
      ? {
          type: "resume_with_input" as const,
          state,
          trigger: input.trigger,
          context,
          input: {
            nodeId: input.forcedNodeId,
            value: input.userInput,
            replaceStatus: input.forcedReplaceStatus ?? "obsolete",
          },
        }
      : input.forcedNodeId
        ? {
            type: "resume_after_unblock" as const,
            state,
            trigger: input.trigger,
            context,
            nodeId: input.forcedNodeId,
          }
        : { type: "start" as const, state, trigger: input.trigger, context };
  const outcome = await graphRuntime.dispatch(dispatchCommand);
  const staleRunningNodeId =
    outcome.status === "running"
      ? currentNodeFromOutcome(outcome) ?? latestStartedNodeId(outcome.events)
      : null;
  const committed = outcome.status === "running"
    ? await committedStateIfNodeAdvanced({
        taskId: input.taskId,
        planId: runtime.planId,
        nodeId: staleRunningNodeId,
        results: outcome.state.results as unknown as NodeResult[],
      })
    : null;

  if (committed) {
    return convergeExecutionToCommittedState({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSessionId: input.mainSession.id,
      session: input.executionSession,
      workspaceId: runtime.workspaceId,
      compiledPlan: runtime.compiledPlan,
      committed,
      fallbackMessage: outcome.message,
    });
  }

  await persistRuntimeState({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    compiledPlan: runtime.compiledPlan,
    graph: outcome.state.graph as unknown as PlanGraph,
    attempts: outcome.state.attempts as unknown as NodeAttempt[],
    results: outcome.state.results as unknown as NodeResult[],
    executionContextSnapshots: outcome.state
      .executionContextSnapshots as unknown as ExecutionContextSnapshot[],
    existingRun: runtime.persisted.planRun,
  });
  await appendGraphRuntimeEvents({
    taskId: input.taskId,
    planId: runtime.planId,
    sessionId: input.mainSession.id,
    events: outcome.events,
  });

  if (outcome.status === "cancelled") {
    await setExecutionSessionState({
      sessionId: input.executionSession.id,
      status: "Abandoned",
      currentNodeId: null,
      pauseReason: outcome.message,
      completedNodeIds: outcome.effective.completedNodeIds,
    });
    await cancelWorkBlock(input.taskId, input.executionSession.workBlockId);
    await db.task.update({
      where: { id: input.taskId },
      data: { status: TaskStatus.Cancelled, blockReason: Prisma.DbNull },
    });
    await rebuildTaskProjection(input.taskId);
    return buildExecutionResponse({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSessionId: input.executionSession.id,
      status: "cancelled",
      effective: outcome.effective as unknown as EffectivePlanGraph,
      currentNodeId: null,
      executedNodeIds: outcome.executedNodeIds,
      message: outcome.message,
    });
  }

  if (outcome.status === "completed") {
    return completeExecution({
      taskId: input.taskId,
      planId: runtime.planId,
      session: input.executionSession,
      workspaceId: runtime.workspaceId,
      compiledPlan: runtime.compiledPlan,
      persisted: await getPlanRun(input.taskId, runtime.planId) ?? runtime.persisted,
      mainSessionId: input.mainSession.id,
      effective: outcome.effective as unknown as EffectivePlanGraph,
      executedNodeIds: outcome.executedNodeIds,
      message: outcome.message,
    });
  }

  if (outcome.status === "running") {
    const currentNodeId = currentNodeFromOutcome(outcome) ?? latestStartedNodeId(outcome.events);
    await markExecutionNodeActive({
      taskId: input.taskId,
      sessionId: input.executionSession.id,
      currentNodeId,
      completedNodeIds: outcome.effective.completedNodeIds,
    });
    return buildExecutionResponse({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSessionId: input.mainSession.id,
      status: "running",
      effective: outcome.effective as unknown as EffectivePlanGraph,
      currentNodeId,
      executedNodeIds: outcome.executedNodeIds,
      message: outcome.message,
    });
  }

  return pauseExecution({
    taskId: input.taskId,
    planId: runtime.planId,
    mainSessionId: input.mainSession.id,
    session: input.executionSession,
    effective: outcome.effective as unknown as EffectivePlanGraph,
    waitKind: waitKindFromOutcome(outcome),
    currentNodeId:
      currentNodeFromOutcome(outcome) ??
      input.executionSession.currentNodeId ??
      "",
    executedNodeIds: outcome.executedNodeIds,
    message: outcome.message,
    errorDetails: errorDetailsFromOutcome(outcome),
  });
}

async function startPlanExecution(input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  prompt?: string;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
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
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

async function continuePlanExecution(input: {
  taskId: string;
  reason: string;
  userInput?: string;
  sessionId?: string;
  nodeId?: string;
  resumeReadyNode?: boolean;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
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
    sessionId: input.sessionId,
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
    (input.nodeId
      ? effective.nodes.find((node) => node.id === input.nodeId)
      : null) ??
    effective.nodes.find(
      (node) => node.id === executionSession.currentNodeId,
    ) ??
    effective.nodes.find(
      (node) =>
        node.status === "waiting_for_user" ||
        node.status === "waiting_for_approval" ||
        node.status === "blocked",
    ) ??
    null;
  const readyNode = input.resumeReadyNode
    ? effective.nodes.find((node) => node.ready)
    : null;

  return advancePlanExecution({
    taskId: input.taskId,
    trigger: "manual",
    mainSession,
    executionSession,
    userInput: input.userInput,
    forcedNodeId: readyNode?.id ?? waitingNode?.id,
    forcedReplaceStatus: "obsolete",
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

async function resumePlanExecutionWithApproval(input: {
  taskId: string;
  sessionId?: string;
  nodeId?: string;
  approved: boolean;
  feedback?: string;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) {
    return {
      taskId: input.taskId,
      planId: null,
      mainSessionId: input.sessionId ?? null,
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
    sessionId: input.sessionId,
  });
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
  });

  const effective = resolveEffectivePlanGraph({
    graph: runtime.persisted.graph!,
    attempts: runtime.persisted.attempts,
    results: runtime.persisted.results,
  });
  const waitingNode =
    (input.nodeId
      ? effective.nodes.find((node) => node.id === input.nodeId)
      : null) ??
    effective.nodes.find((node) => node.id === executionSession.currentNodeId) ??
    effective.nodes.find((node) => node.status === "waiting_for_approval") ??
    null;

  if (!waitingNode) {
    return buildExecutionResponse({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSessionId: mainSession.id,
      status: mapTerminalReasonToStatus(effective),
      effective,
      currentNodeId: null,
      executedNodeIds: [],
      message: "No approval-waiting node found.",
    });
  }

  await appendMainSessionEvent({
    taskId: input.taskId,
    planId: runtime.planId,
    sessionId: mainSession.id,
    eventType: "user_input_received",
    payload: {
      reason: input.approved ? "approval:approve" : "approval:reject",
      feedback: input.feedback,
      nodeId: waitingNode.id,
    },
  });

  return advancePlanExecution({
    taskId: input.taskId,
    trigger: "manual",
    mainSession,
    executionSession,
    command: {
      type: "resume_with_approval",
      nodeId: waitingNode.id,
      approved: input.approved,
      feedback: input.feedback,
    },
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

async function dispatchExecutionAction(input: {
  taskId: string;
  action: ExecutionActionWithContinuation;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
  switch (input.action.action) {
    case "start_manual":
      return startPlanExecution({
        taskId: input.taskId,
        trigger: "manual",
        prompt: input.action.prompt,
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    case "start_scheduled":
      return startPlanExecution({
        taskId: input.taskId,
        trigger: "scheduler",
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    case "resume_with_input":
      return continuePlanExecution({
        taskId: input.taskId,
        reason: "user_input",
        userInput: input.action.inputText,
        sessionId: input.action.sessionId,
        nodeId: input.action.nodeId,
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    case "resume_with_approval":
      return resumePlanExecutionWithApproval({
        taskId: input.taskId,
        sessionId: input.action.sessionId,
        nodeId: input.action.nodeId,
        approved: input.action.decision === "approve",
        feedback: input.action.feedback ?? input.action.editedContent,
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    case "resume_after_unblock":
      return continuePlanExecution({
        taskId: input.taskId,
        reason: "resume_after_unblock",
        userInput: input.action.note,
        sessionId: input.action.sessionId,
        nodeId: input.action.nodeId,
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    case "complete_manual_node": {
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
          message:
            "No accepted plan. Create or accept a plan before execution.",
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
      return advancePlanExecution({
        taskId: input.taskId,
        trigger: "manual",
        mainSession,
        executionSession,
        command: {
          type: "complete_manual_node",
          nodeId: input.action.nodeId,
          summary: input.action.summary,
          output: input.action.output,
          selectedBranch: input.action.selectedBranch,
          terminalKind: input.action.terminalKind,
          branchRef: input.action.branchRef,
          decision: input.action.decision,
          feedback: input.action.feedback,
          prompt: input.action.prompt,
          continueExecution: input.action.continueExecution,
        },
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    }
    case "block_current_node": {
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
          message:
            "No accepted plan. Create or accept a plan before execution.",
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
      return advancePlanExecution({
        taskId: input.taskId,
        trigger: "manual",
        mainSession,
        executionSession,
        command: {
          type: "block_current_node",
          nodeId: input.action.nodeId,
          reason: input.action.reason,
        },
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    }
    case "fail_current_node": {
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
          message:
            "No accepted plan. Create or accept a plan before execution.",
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
      return advancePlanExecution({
        taskId: input.taskId,
        trigger: "manual",
        mainSession,
        executionSession,
        command: {
          type: "fail_current_node",
          nodeId: input.action.nodeId,
          error: input.action.error,
        },
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    }
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
          message:
            "No accepted plan. Create or accept a plan before execution.",
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
      return advancePlanExecution({
        taskId: input.taskId,
        trigger: "manual",
        mainSession,
        executionSession,
        command: {
          type: "retry_node",
          nodeId: input.action.nodeId,
          reason: input.action.prompt ?? "Node retry requested",
          userInput: input.action.prompt,
        },
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
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
          message:
            "No accepted plan. Create or accept a plan before execution.",
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
      return advancePlanExecution({
        taskId: input.taskId,
        trigger: "manual",
        mainSession,
        executionSession,
        command: {
          type: "cancel_session",
          reason: input.action.reason ?? "Execution cancelled",
        },
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    }
    default: {
      const exhaustiveCheck: never = input.action;
      throw new Error(
        `Unsupported execution action: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

async function submitTerminalNodeResult(input: {
  taskId: string;
  action: Extract<ExecutionActionInput, {
    action: "complete_manual_node" | "block_current_node" | "fail_current_node";
  }>;
}): Promise<PlanExecutionResult> {
  const result = await dispatchExecutionAction({
    taskId: input.taskId,
    action: input.action.action === "complete_manual_node"
      ? { ...input.action, continueExecution: false }
      : input.action,
  });

  if (input.action.action === "complete_manual_node" && result.status === "running") {
    const sessionId = input.action.sessionId;
    queueMicrotask(() => {
      void continuePlanExecution({
        taskId: input.taskId,
        reason: "terminal_result_continuation",
        sessionId,
        resumeReadyNode: true,
      }).catch((cause) => {
        logger.error("terminal_result.continuation_failed", {
          taskId: input.taskId,
          sessionId: sessionId ?? null,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
    });
  }

  return result;
}

async function syncPlanRunRuntimeResult(
  input: SyncPlanRunRuntimeResultInput,
): Promise<void> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) return;

  const state = toGraphExecutionState(runtime.persisted);
  const attempt = state.attempts.find((candidate) => {
    if (candidate.status !== "running") return false;
    const output = candidate.runtimeSnapshot?.output;
    if (!output || typeof output !== "object") return false;
    const record = output as Record<string, unknown>;
    return record.runtimeRunRef === input.runtimeRunRef;
  });

  if (!attempt) return;

  const runtimeName = await getRuntimeName(input.taskId);
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
    runtimeName,
  });
  const executionSession = await db.executionSession.findFirst({
    where: { taskId: input.taskId, planId: runtime.planId },
    orderBy: { updatedAt: "desc" },
  });
  const graphRuntime = createGraphRuntime<EngineRuntimeContext>({
    taskId: input.taskId,
    runtimeName,
    policies: { maxSteps: DEFAULT_MAX_STEPS },
    callbacks: {
      executeNode: async () => null,
    },
  });
  const context: EngineRuntimeContext = {
    taskId: input.taskId,
    planId: runtime.planId,
    mainSession,
  };
  const externalResult =
    input.status === "Completed"
      ? {
          nodeId: attempt.nodeId,
          status: "done" as const,
          summary:
            input.summary?.trim() ||
            `Runtime run ${input.runtimeRunRef} completed`,
          evidence: {
            sessionId: mainSession.id,
            runId: input.runtimeRunRef,
          },
          output: input.output,
        }
      : input.status === "Cancelled"
        ? {
            nodeId: attempt.nodeId,
            status: "cancelled" as const,
            reason:
              input.error?.trim() ||
              `Runtime run ${input.runtimeRunRef} was cancelled`,
            evidence: {
              sessionId: mainSession.id,
              runId: input.runtimeRunRef,
            },
          }
        : {
            nodeId: attempt.nodeId,
            status: "failed" as const,
            error:
              input.error?.trim() ||
              `Runtime run ${input.runtimeRunRef} failed`,
            evidence: {
              sessionId: mainSession.id,
              runId: input.runtimeRunRef,
            },
          };
  const outcome = await graphRuntime.dispatch({
    type: "sync_external_result",
    state,
    trigger: "system",
    context,
    externalResult,
  });

  await persistRuntimeState({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    compiledPlan: runtime.compiledPlan,
    graph: outcome.state.graph as unknown as PlanGraph,
    attempts: outcome.state.attempts as unknown as NodeAttempt[],
    results: outcome.state.results as unknown as NodeResult[],
    executionContextSnapshots: outcome.state
      .executionContextSnapshots as unknown as ExecutionContextSnapshot[],
    existingRun: runtime.persisted.planRun,
  });
  await appendGraphRuntimeEvents({
    taskId: input.taskId,
    planId: runtime.planId,
    sessionId: mainSession.id,
    events: outcome.events,
  });

  if (outcome.status === "completed") {
    if (executionSession) {
      await completeExecution({
        taskId: input.taskId,
        planId: runtime.planId,
        session: executionSession,
        workspaceId: runtime.workspaceId,
        compiledPlan: runtime.compiledPlan,
        persisted: await getPlanRun(input.taskId, runtime.planId) ?? runtime.persisted,
        mainSessionId: mainSession.id,
        effective: outcome.effective as unknown as EffectivePlanGraph,
        executedNodeIds: outcome.executedNodeIds,
        message: outcome.message,
      });
      return;
    }

    await db.task.update({
      where: { id: input.taskId },
      data: {
        status: TaskStatus.Completed,
        completedAt: new Date(),
        blockReason: Prisma.DbNull,
      },
    });
    await rebuildTaskProjection(input.taskId);
    return;
  }

  if (outcome.status === "running") {
    await markExecutionNodeActive({
      taskId: input.taskId,
      sessionId: executionSession?.id,
      currentNodeId: currentNodeFromOutcome(outcome),
      completedNodeIds: outcome.effective.completedNodeIds,
    });
    return;
  }

  if (outcome.status === "blocked") {
    if (executionSession) {
      await setExecutionSessionState({
        sessionId: executionSession.id,
        status: "Paused",
        currentNodeId: outcome.currentNodeId ?? attempt.nodeId,
        pauseReason: outcome.message,
        completedNodeIds: outcome.effective.completedNodeIds,
      });
    }
    await db.task.update({
      where: { id: input.taskId },
      data: {
        status: TaskStatus.Blocked,
        blockReason: {
          blockType: "node_blocked",
          scope: "plan_node",
          actionRequired: outcome.message,
          nodeId: outcome.currentNodeId ?? attempt.nodeId,
        },
      },
    });
    await rebuildTaskProjection(input.taskId);
  }
}

export class TaskPlanExecution {
  async start(input: Parameters<typeof startPlanExecution>[0]) {
    return startPlanExecution(input);
  }

  async dispatch(input: Parameters<typeof dispatchExecutionAction>[0]) {
    return dispatchExecutionAction(input);
  }

  async submitNodeResult(input: Parameters<typeof submitTerminalNodeResult>[0]) {
    return submitTerminalNodeResult(input);
  }

  async syncRuntimeResult(input: Parameters<typeof syncPlanRunRuntimeResult>[0]) {
    return syncPlanRunRuntimeResult(input);
  }
}

export const taskPlanExecution = new TaskPlanExecution();
