import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import {
  ensurePlanMainSession,
  appendMainSessionEvent,
} from "./plan-state-store";
import { OPENCLAW_EXECUTION_RUNTIME } from "@chrona/openclaw";
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
  PlanRun,
  WaitKind,
} from "@chrona/contracts/ai";
import type { NodeExecutor } from "./node-executors/types";
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
  errorDetails?: unknown;
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

async function getRuntimeName(taskId: string): Promise<string> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { executionRuntime: true },
  });
  return task.executionRuntime ?? OPENCLAW_EXECUTION_RUNTIME;
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

function errorDetailsFromOutcome(outcome: GraphDispatchOutcome): unknown {
  const failedAttempt = outcome.state.attempts.find((attempt) => attempt.status === "failed" && attempt.error?.details);
  return failedAttempt?.error?.details;
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
  errorDetails?: unknown;
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
    errorDetails: input.errorDetails,
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
      nodeId: string;
      summary?: string;
      output?: unknown;
    }
  | {
      type: "resume_with_approval";
      nodeId: string;
      approved: boolean;
      feedback?: string;
    }
  | { type: "retry_node"; nodeId: string; reason?: string; userInput?: string }
  | { type: "cancel_session"; reason?: string };

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
  return (
    outcome.currentNodeId ??
    outcome.effective.nodes.find(
      (node) =>
        node.status === "waiting_for_user" ||
        node.status === "waiting_for_approval" ||
        node.status === "blocked" ||
        node.status === "failed",
    )?.id ??
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
        }) as ReturnType<typeof executor.execute>;
      },
    },
  });
  const command = input.command;
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
                  nodeId: command.nodeId,
                  status: "done" as const,
                  summary:
                    command.summary ??
                    `Manual node ${command.nodeId} completed`,
                  output: command.output,
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
      mainSessionId: input.mainSession.id,
      effective: outcome.effective as unknown as EffectivePlanGraph,
      executedNodeIds: outcome.executedNodeIds,
      message: outcome.message,
    });
  }

  if (outcome.status === "running") {
    await setExecutionSessionState({
      sessionId: input.executionSession.id,
      status: "Active",
      currentNodeId: currentNodeFromOutcome(outcome),
      pauseReason: null,
      completedNodeIds: outcome.effective.completedNodeIds,
    });
    await db.task.update({
      where: { id: input.taskId },
      data: { status: TaskStatus.Running, blockReason: Prisma.DbNull },
    });
    await rebuildTaskProjection(input.taskId);
    return buildExecutionResponse({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSessionId: input.mainSession.id,
      status: "running",
      effective: outcome.effective as unknown as EffectivePlanGraph,
      currentNodeId: currentNodeFromOutcome(outcome),
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

async function continuePlanExecution(input: {
  taskId: string;
  reason: string;
  userInput?: string;
  sessionId?: string;
  nodeId?: string;
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

async function resumePlanExecutionWithApproval(input: {
  taskId: string;
  sessionId?: string;
  nodeId?: string;
  approved: boolean;
  feedback?: string;
}): Promise<PlanExecutionResult> {
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
  });
}

async function dispatchExecutionAction(input: {
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
        sessionId: input.action.sessionId,
        nodeId: input.action.nodeId,
      });
    case "resume_with_approval":
      return resumePlanExecutionWithApproval({
        taskId: input.taskId,
        sessionId: input.action.sessionId,
        nodeId: input.action.nodeId,
        approved: input.action.decision === "approve",
        feedback: input.action.feedback ?? input.action.editedContent,
      });
    case "resume_after_unblock":
      return continuePlanExecution({
        taskId: input.taskId,
        reason: "resume_after_unblock",
        userInput: input.action.note,
        sessionId: input.action.sessionId,
        nodeId: input.action.nodeId,
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
        },
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
    if (executionSession) {
      await setExecutionSessionState({
        sessionId: executionSession.id,
        status: "Active",
        currentNodeId: currentNodeFromOutcome(outcome),
        pauseReason: null,
        completedNodeIds: outcome.effective.completedNodeIds,
      });
    }
    await db.task.update({
      where: { id: input.taskId },
      data: { status: TaskStatus.Running, blockReason: Prisma.DbNull },
    });
    await rebuildTaskProjection(input.taskId);
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

  async syncRuntimeResult(input: Parameters<typeof syncPlanRunRuntimeResult>[0]) {
    return syncPlanRunRuntimeResult(input);
  }
}

export const taskPlanExecution = new TaskPlanExecution();
