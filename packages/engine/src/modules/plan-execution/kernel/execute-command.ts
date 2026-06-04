import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import {
  createGraphRuntime,
  resolveEffectivePlanGraph,
  type GraphDispatchOutcome,
  type GraphExecutionState,
  type GraphRuntimeCommand,
  type GraphSubmittedNodeResult,
} from "@chrona/graph-runtime";
import type {
  EffectivePlanGraph,
  ExecutionCommand,
  ExecutionCommandContext,
  ExecutionCommandEnvelope,
  ExecutionTrigger,
  PlanExecutionResult,
  SubmittedNodeResult,
  WaitKind,
} from "@chrona/contracts/ai";
import {
  executionStatusFromEffectiveGraph,
  executionTransition,
} from "../execution-state-machine";
import { ensureNativePlanRun } from "../persistence/plan-runtime-store";
import { savePlanRunGuarded } from "../plan-run-store";
import {
  ensureExecutionSession,
  getActiveExecutionWorkBlockId,
  setExecutionSessionState,
  type ExecutionSessionRow,
} from "../persistence/execution-session-store";
import { ensurePlanMainSession, appendMainSessionEvent } from "../plan-state-store";
import { getRuntimeName } from "../persistence/task-runtime-store";
import {
  activateWorkBlock,
  completeWorkBlock,
  releaseWorkBlock,
} from "../persistence/work-block-store";
import { completeActiveRunsForTask } from "../persistence/task-execution-store";
import { toGraphExecutionState } from "../runtime/graph-state";
import { buildExecutionResponse } from "../projection/execution-response";
import {
  currentNodeFromOutcome,
  latestStartedNodeId,
} from "../projection/execution-graph-selectors";
import {
  errorDetailsFromOutcome,
  waitKindFromOutcome,
} from "../runtime/runtime-outcome";
import { appendGraphRuntimeEvents } from "../persistence/runtime-event-store";
import { createKernelGraphCallbacks } from "./graph-callbacks";
import {
  ExecutionConflictError,
  type EngineRuntimeContext,
  type PlanExecutionObserver,
} from "./kernel-types";

const DEFAULT_MAX_STEPS = 10;

type NativePlanRuntime = NonNullable<Awaited<ReturnType<typeof ensureNativePlanRun>>>;

function noPlanResponse(taskId: string, sessionId?: string | null): PlanExecutionResult {
  return {
    taskId,
    planId: null,
    mainSessionId: sessionId ?? null,
    status: "no_plan",
    currentNodeId: null,
    executedNodeIds: [],
    waitingNodeIds: [],
    blockedNodeIds: [],
    checkpoint: null,
    message: "No accepted plan. Create or accept a plan before execution.",
  };
}

function formatInputFields(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function waitingNode(effective: EffectivePlanGraph) {
  return effective.nodes.find(
    (node) =>
      node.status === "waiting_for_user" ||
      node.status === "waiting_for_approval" ||
      node.status === "blocked",
  );
}

function currentNode(effective: EffectivePlanGraph) {
  return (
    effective.nodes.find((node) => node.status === "running") ??
    effective.nodes.find(
      (node) =>
        node.status === "waiting_for_user" ||
        node.status === "waiting_for_approval" ||
        node.status === "blocked" ||
        node.status === "failed",
    )
  );
}

function resolveSubmitNodeId(
  command: Extract<ExecutionCommand, { type: "submit_node_result" }>,
  state: GraphExecutionState,
  effective: EffectivePlanGraph,
): string | null {
  if (command.nodeId) return command.nodeId;
  if (command.runtimeRunRef) {
    const byResult = state.results.find(
      (result) => result.evidence?.runtimeRunRef === command.runtimeRunRef,
    );
    if (byResult?.nodeId) return byResult.nodeId;
    const running = [...state.attempts]
      .reverse()
      .find((attempt) => attempt.status === "running");
    return running?.nodeId ?? null;
  }
  return (
    effective.nodes.find((node) => node.status === "running")?.id ??
    effective.readyNodeIds[0] ??
    null
  );
}

function toSubmittedNodeResult(
  nodeId: string,
  result: SubmittedNodeResult,
): GraphSubmittedNodeResult {
  switch (result.kind) {
    case "done":
      return {
        nodeId,
        status: "done",
        summary: result.summary ?? "",
        output: result.output ?? result.outputs,
        selectedBranch: result.selectedBranch,
      };
    case "failed":
      return { nodeId, status: "failed", error: result.error };
    case "blocked":
      return {
        nodeId,
        status: "blocked",
        reason: result.reason,
        actionForm: result.actionForm,
      };
    case "cancelled":
      return { nodeId, status: "cancelled", reason: result.reason };
  }
}

function buildGraphCommand(input: {
  command: ExecutionCommand;
  state: GraphExecutionState;
  effective: EffectivePlanGraph;
  session: ExecutionSessionRow;
  engineContext: EngineRuntimeContext;
  trigger: ExecutionTrigger;
}): GraphRuntimeCommand {
  const { command, state, effective, session, engineContext, trigger } = input;
  const base = { state, trigger, context: engineContext } as const;

  switch (command.type) {
    case "start":
      return { type: "start", ...base };
    case "resume_with_input": {
      const nodeId =
        command.nodeId ?? session.currentNodeId ?? waitingNode(effective)?.id;
      if (!nodeId) throw new Error("No node is awaiting input");
      return {
        type: "resume_with_input",
        ...base,
        input: {
          nodeId,
          value: formatInputFields(command.inputFields),
          fields: command.inputFields,
          replaceStatus: "obsolete",
        },
      };
    }
    case "resume_with_approval": {
      const nodeId =
        command.nodeId ??
        session.currentNodeId ??
        effective.nodes.find((node) => node.status === "waiting_for_approval")?.id;
      if (!nodeId) throw new Error("No node is awaiting approval");
      return {
        type: "resume_with_approval",
        ...base,
        input: { nodeId, approved: command.approved, feedback: command.feedback },
      };
    }
    case "resume_after_unblock": {
      const nodeId =
        command.nodeId ??
        effective.nodes.find((node) => node.ready)?.id ??
        waitingNode(effective)?.id;
      return { type: "resume_after_unblock", ...base, nodeId };
    }
    case "submit_node_result": {
      const nodeId = resolveSubmitNodeId(command, state, effective);
      if (!nodeId) throw new Error("No node available for result submission");
      return {
        type: "submit_node_result",
        ...base,
        nodeResult: toSubmittedNodeResult(nodeId, command.result),
        continueExecution: true,
      };
    }
    case "fail_node": {
      const nodeId = command.nodeId ?? currentNode(effective)?.id;
      if (!nodeId) throw new Error("No node to fail");
      return {
        type: "submit_node_result",
        ...base,
        nodeResult: { nodeId, status: "failed", error: command.error },
      };
    }
    case "block_node": {
      const nodeId = command.nodeId ?? currentNode(effective)?.id;
      if (!nodeId) throw new Error("No node to block");
      return {
        type: "submit_node_result",
        ...base,
        nodeResult: {
          nodeId,
          status: "blocked",
          reason: command.reason,
          actionForm: command.actionForm,
        },
      };
    }
    case "retry_node":
      return {
        type: "retry_node",
        ...base,
        nodeId: command.nodeId,
        reason: command.reason,
        userInput: command.userInput,
      };
    case "pause":
      return { type: "pause_session", ...base, reason: command.reason };
    case "cancel":
      return { type: "cancel_session", ...base, reason: command.reason };
    case "apply_mutation":
      return {
        type: "apply_mutation",
        ...base,
        mutation: {
          operations: command.operations,
          reason: command.reason,
          invalidateDownstream: command.invalidateDownstream,
        },
      };
  }
}

async function finalizeOutcome(input: {
  taskId: string;
  runtime: NativePlanRuntime;
  session: ExecutionSessionRow;
  mainSessionId: string;
  outcome: GraphDispatchOutcome;
}): Promise<PlanExecutionResult> {
  const { taskId, runtime, session, mainSessionId, outcome } = input;
  const status =
    outcome.status === "cancelled"
      ? "cancelled"
      : executionStatusFromEffectiveGraph(outcome.effective);

  const isTerminal = status === "completed" || status === "cancelled";
  const isPaused =
    status === "waiting_for_user" ||
    status === "waiting_for_approval" ||
    status === "blocked" ||
    status === "failed";
  const waitKind: WaitKind | undefined = isPaused ? waitKindFromOutcome(outcome) : undefined;

  const runningNodeId =
    currentNodeFromOutcome(outcome) ?? latestStartedNodeId(outcome.events);
  const currentNodeId = isTerminal
    ? null
    : status === "running"
      ? runningNodeId
      : runningNodeId ?? session.currentNodeId ?? null;

  const transition = executionTransition({
    status,
    pauseReason: waitKind,
    message: outcome.message,
    nodeId: currentNodeId,
  });

  await setExecutionSessionState({
    sessionId: session.id,
    status: transition.sessionStatus,
    currentNodeId,
    pauseReason: transition.pauseReason,
    completedNodeIds: outcome.effective.completedNodeIds,
  });

  await db.task.update({
    where: { id: taskId },
    data: {
      status: transition.taskStatus,
      blockReason: transition.blockReason,
      completedAt: status === "completed" ? new Date() : undefined,
    },
  });

  if (status === "completed") {
    await completeActiveRunsForTask(taskId);
    await completeWorkBlock(taskId, session.workBlockId);
    await appendMainSessionEvent({
      taskId,
      planId: runtime.planId,
      sessionId: mainSessionId,
      eventType: "execution_completed",
      payload: { totalSteps: outcome.executedNodeIds.length },
    });
  }
  if (status === "cancelled") {
    await releaseWorkBlock(taskId, session.workBlockId);
  }

  await rebuildTaskProjection(taskId);

  return buildExecutionResponse({
    taskId,
    planId: runtime.planId,
    mainSessionId,
    executionSessionId: session.id,
    planRunId: runtime.planId,
    status,
    effective: outcome.effective,
    currentNodeId,
    executedNodeIds: outcome.executedNodeIds,
    message: outcome.message,
    errorDetails: errorDetailsFromOutcome(outcome),
    waitKind,
  });
}

/**
 * The single execution entry point. Every state-mutating execution action —
 * start, resume, approve, submit (in-process or out-of-band provider result),
 * block, fail, retry, pause, cancel, mutate — flows through here as one
 * ExecutionCommand, dispatched once and persisted once under an epoch guard.
 */
export async function executeCommand(
  input: ExecutionCommandEnvelope & PlanExecutionObserver,
): Promise<PlanExecutionResult> {
  const { taskId, command } = input;
  const context: ExecutionCommandContext = input.context ?? {};
  const trigger: ExecutionTrigger =
    context.trigger ?? (command.type === "start" ? command.trigger : "manual");

  const workBlockId =
    command.type === "start"
      ? context.workBlockId ?? null
      : context.workBlockId ?? (await getActiveExecutionWorkBlockId(taskId));

  const runtime = await ensureNativePlanRun(taskId, workBlockId);
  if (!runtime) return noPlanResponse(taskId, context.sessionId);

  const session = await ensureExecutionSession({
    workspaceId: runtime.workspaceId,
    taskId,
    planId: runtime.planId,
    trigger,
    workBlockId,
    sessionId: context.sessionId ?? undefined,
  });
  const mainSession = await ensurePlanMainSession({
    taskId,
    planId: runtime.planId,
  });
  const runtimeName = await getRuntimeName(taskId);

  if (command.type === "start") {
    await activateWorkBlock(taskId, session.workBlockId);
    await appendMainSessionEvent({
      taskId,
      planId: runtime.planId,
      sessionId: mainSession.id,
      workBlockId: session.workBlockId,
      eventType: "execution_started",
      payload: { trigger, prompt: command.prompt },
    });
  }

  const state = toGraphExecutionState(runtime.persisted);
  const effective = resolveEffectivePlanGraph(state);
  const engineContext: EngineRuntimeContext = {
    taskId,
    planId: runtime.planId,
    mainSession,
  };

  const graphCommand = buildGraphCommand({
    command,
    state,
    effective,
    session,
    engineContext,
    trigger,
  });

  const graphRuntime = createGraphRuntime<EngineRuntimeContext>({
    taskId,
    runtimeName,
    policies: { maxSteps: DEFAULT_MAX_STEPS },
    callbacks: createKernelGraphCallbacks({
      taskId,
      sessionId: session.id,
      runtimeName,
      mainSession,
      onGraphEvent: input.onGraphEvent,
      onRuntimeEvent: input.onRuntimeEvent,
      onStateChange: input.onStateChange,
    }),
  });

  const outcome = await graphRuntime.dispatch(graphCommand);

  // Single writer: one epoch-guarded persist of the final runtime state.
  const committed = await savePlanRunGuarded({
    workspaceId: runtime.workspaceId,
    taskId,
    planId: runtime.planId,
    workBlockId: session.workBlockId,
    expectedEpoch: runtime.persisted.executionEpoch,
    run: runtime.persisted.planRun,
    compiledPlan: runtime.compiledPlan,
    graph: outcome.state.graph,
    attempts: outcome.state.attempts,
    results: outcome.state.results,
    executionContextSnapshots: outcome.state.executionContextSnapshots,
  });
  if (!committed.committed) {
    throw new ExecutionConflictError();
  }

  await appendGraphRuntimeEvents({
    taskId,
    planId: runtime.planId,
    sessionId: mainSession.id,
    events: outcome.events,
  });

  return finalizeOutcome({
    taskId,
    runtime,
    session,
    mainSessionId: mainSession.id,
    outcome,
  });
}
