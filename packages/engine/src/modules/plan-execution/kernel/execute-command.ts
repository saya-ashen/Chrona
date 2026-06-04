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
  executionStatusFromGraphOutcome,
  executionTransition,
  graphStatusForExecutionStatus,
} from "../execution-state-machine";
import { ensureNativePlanRun, derivePlanRunFromRuntime } from "../persistence/plan-runtime-store";
import { savePlanRunGuarded } from "../plan-run-store";
import {
  ensureExecutionSession,
  getActiveExecutionWorkBlockId,
  setExecutionSessionState,
  type ExecutionSessionRow,
} from "../persistence/execution-session-store";
import { ensurePlanMainSession, appendMainSessionEvent } from "../plan-state-store";
import { getCurrentExecution } from "../use-cases/get-current-execution";
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
import type { EngineRuntimeContext, PlanExecutionObserver } from "./kernel-types";
import { branchBindingForRef } from "../node-runtime-refs";

const DEFAULT_MAX_STEPS = 10;

function eventCommandType(command: ExecutionCommand): string {
  switch (command.type) {
    case "submit_node_result":
      return command.result.kind === "done" ? "complete_manual_node" : `${command.result.kind}_current_node`;
    case "block_node":
      return "block_current_node";
    case "fail_node":
      return "fail_current_node";
    case "cancel":
      return "cancel_session";
    case "pause":
      return "pause_session";
    default:
      return command.type;
  }
}

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
    waitingNode(effective)?.id ??
    effective.readyNodeIds[0] ??
    null
  );
}

function toSubmittedNodeResult(
  nodeId: string,
  result: SubmittedNodeResult,
  effective?: EffectivePlanGraph,
): GraphSubmittedNodeResult {
  let selectedBranch = result.kind === "done" ? result.selectedBranch : undefined;

  // Resolve branchRef → selectedBranch for condition nodes whose caller
  // passed a raw branch ref string instead of the fully resolved branch.
  if (!selectedBranch && result.kind === "done" && result.branchRef && effective) {
    const conditionNode = effective.nodes.find((n) => n.id === nodeId);
    if (conditionNode) {
      try {
        const binding = branchBindingForRef({
          plan: effective,
          node: conditionNode,
          branchRef: result.branchRef,
        });
        selectedBranch = {
          ref: binding.ref,
          label: binding.label,
          nextNodeId: binding.nextNodeId!,
          source: "ai",
        };
      } catch { /* branch ref invalid — leave selectedBranch undefined */ }
    }
  }

  switch (result.kind) {
    case "done":
      return {
        nodeId,
        status: "done",
        summary: result.summary ?? "",
        evidence: result.evidence,
        output: result.output ?? result.outputs,
        selectedBranch: result.selectedBranch ?? selectedBranch,
      };
    case "failed":
      return { nodeId, status: "failed", error: result.error, evidence: result.evidence };
    case "blocked":
      return {
        nodeId,
        status: "blocked",
        reason: result.reason,
        actionForm: result.actionForm,
        evidence: result.evidence,
      };
    case "cancelled":
      return { nodeId, status: "cancelled", reason: result.reason, evidence: result.evidence };
  }
}

function buildGraphCommand(input: {
  command: ExecutionCommand;
  state: GraphExecutionState;
  effective: EffectivePlanGraph;
  session: ExecutionSessionRow;
  engineContext: EngineRuntimeContext;
  trigger: ExecutionTrigger;
}): GraphRuntimeCommand | null {
  const { command, state, effective, session, engineContext, trigger } = input;
  const base = { state, trigger, context: engineContext } as const;

  switch (command.type) {
    case "start":
      return { type: "start", ...base };
    case "resume_with_input": {
      const nodeId =
        command.nodeId ?? session.currentNodeId ?? waitingNode(effective)?.id;
      if (!nodeId) return null;
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
      if (!nodeId) return null;
      return {
        type: "resume_with_approval",
        ...base,
        input: {
          nodeId,
          approved: command.approved,
          feedback: command.feedback,
          userInput: command.feedback,
        },
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
      if (!nodeId) return null;
      return {
        type: "submit_node_result",
        ...base,
        nodeResult: toSubmittedNodeResult(nodeId, command.result, effective),
        continueExecution: command.continueExecution ?? true,
      };
    }
    case "fail_node": {
      const nodeId = command.nodeId ?? currentNode(effective)?.id;
      if (!nodeId) return null;
      return {
        type: "submit_node_result",
        ...base,
        nodeResult: { nodeId, status: "failed", error: command.error },
      };
    }
    case "block_node": {
      const nodeId = command.nodeId ?? currentNode(effective)?.id;
      if (!nodeId) return null;
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
  updateSessionState?: boolean;
}): Promise<PlanExecutionResult> {
  const { taskId, runtime, session, mainSessionId, outcome } = input;
  const status = executionStatusFromGraphOutcome(outcome);

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

  if (input.updateSessionState !== false) {
    await setExecutionSessionState({
      sessionId: session.id,
      status: transition.sessionStatus,
      currentNodeId,
      pauseReason: transition.pauseReason,
      completedNodeIds: outcome.effective.completedNodeIds.filter(
        (nodeId) => outcome.effective.nodes.find((node) => node.id === nodeId)?.status !== "skipped",
      ),
    });
  }

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

  const contextSessionId = context.sessionId ?? undefined;
  const existingContextSession = contextSessionId
    ? await db.executionSession.findUnique({
        where: { id: contextSessionId },
        select: { id: true },
      })
    : null;

  const session = await ensureExecutionSession({
    workspaceId: runtime.workspaceId,
    taskId,
    planId: runtime.planId,
    trigger,
    workBlockId,
    sessionId: existingContextSession?.id,
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

  // Out-of-band provider results only advance an actively-running session.
  // While paused or stopped, a late callback is recorded as ignored.
  if (
    command.type === "submit_node_result" &&
    command.runtimeRunRef &&
    session.status !== "Active"
  ) {
    return getCurrentExecution({ taskId, workBlockId: session.workBlockId });
  }

  const graphCommand = buildGraphCommand({
    command,
    state,
    effective,
    session,
    engineContext,
    trigger,
  });
  // No target node resolves (e.g. a late report after the node/plan finished):
  // ignore gracefully and return the current execution state.
  if (!graphCommand) {
    const current = await getCurrentExecution({ taskId, workBlockId: session.workBlockId });
    if (current.status === "completed" || current.status === "cancelled") {
      return {
        ...current,
        message: "Execution already completed; node result ignored.",
      };
    }
    return current;
  }

  const graphRuntime = createGraphRuntime<EngineRuntimeContext>({
    taskId,
    runtimeName,
    policies: { maxSteps: DEFAULT_MAX_STEPS },
    callbacks: createKernelGraphCallbacks({
      taskId,
      sessionId: session.id,
      runtimeName,
      mainSession,
      workspaceId: runtime.workspaceId,
      workBlockId: session.workBlockId,
      planId: runtime.planId,
      compiledPlan: runtime.compiledPlan,
      persisted: runtime.persisted,
      updateSessionProjection: !(existingContextSession && contextSessionId !== session.id),
      onGraphEvent: input.onGraphEvent,
      onRuntimeEvent: input.onRuntimeEvent,
      onStateChange: input.onStateChange,
    }),
  });

  const outcome = await graphRuntime.dispatch(graphCommand);

  // Re-read the current epoch before the guarded write. Between command
  // entry and dispatch, a concurrent command (e.g. overlapping start) may
  // have advanced the epoch. Using the stale entry-time epoch would
  // reject a non-conflicting write. Instead we read the live epoch so
  // both commands can commit when their outcomes converge.
  const liveRow = await db.taskPlanRun.findFirst({
    where: {
      taskId,
      planId: runtime.planId,
      workBlockId: session.workBlockId ?? null,
    },
    select: { executionEpoch: true },
  });
  const liveEpoch = liveRow?.executionEpoch ?? runtime.persisted.executionEpoch;

  // Single writer: one epoch-guarded persist of the final runtime state.
  // Derive PlanRun from outcome so planRun.status reflects the execution
  // result (completed/running/paused) instead of stale "pending".
  const status = executionStatusFromGraphOutcome(outcome);
  // Derive PlanRun *and* graph status from the outcome so persisted state
  // matches the execution result (completed/paused/cancelled), not the
  // initial "active" or "pending" snapshot.
  const derivedGraph = {
    ...outcome.state.graph,
    status: graphStatusForExecutionStatus(status),
  };
  const derivedRun = derivePlanRunFromRuntime({
    existingRun: runtime.persisted.planRun,
    compiledPlan: runtime.compiledPlan,
    graph: derivedGraph,
    attempts: outcome.state.attempts,
    results: outcome.state.results,
    status,
  });
  const committed = await savePlanRunGuarded({
    workspaceId: runtime.workspaceId,
    taskId,
    planId: runtime.planId,
    workBlockId: session.workBlockId,
    expectedEpoch: liveEpoch,
    run: derivedRun,
    compiledPlan: runtime.compiledPlan,
    graph: derivedGraph,
    attempts: outcome.state.attempts,
    results: outcome.state.results,
    executionContextSnapshots: outcome.state.executionContextSnapshots,
  });
  if (!committed.committed) {
    // A concurrent command advanced the run first; surface current state.
    return getCurrentExecution({ taskId, workBlockId: session.workBlockId });
  }

  await appendGraphRuntimeEvents({
    taskId,
    planId: runtime.planId,
    sessionId: mainSession.id,
    events: outcome.events,
    envelope: {
      command: { type: eventCommandType(command) },
      actor: context.actor ?? (command.type === "submit_node_result"
        ? { type: "user" }
        : { type: "system", service: "plan-execution" }),
      origin: context.origin ?? { channel: command.type === "submit_node_result" ? "api" : "internal" },
      correlation: {
        taskId,
        planId: runtime.planId,
        mainSessionId: mainSession.id,
        executionSessionId: session.id,
      },
    },
  });

  return finalizeOutcome({
    taskId,
    runtime,
    session,
    mainSessionId: command.type === "cancel" && existingContextSession ? session.id : mainSession.id,
    outcome,
    updateSessionState: !(existingContextSession && contextSessionId !== session.id),
  });
}
