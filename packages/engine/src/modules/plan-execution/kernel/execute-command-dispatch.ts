/* eslint-disable max-lines-per-function, complexity -- Command dispatch keeps receipt ownership and graph authority transitions colocated. */
import { db } from "@/lib/db";
import { createGraphRuntime, resolveEffectivePlanGraph, type GraphDispatchOutcome } from "@chrona/graph-runtime";
import type { ExecutionCommandContext, ExecutionCommandEnvelope, PlanExecutionResult } from "@chrona/contracts/ai";
import { toGraphExecutionState } from "../runtime/graph-state";
import { PlanRuntimeStateChangedError } from "../persistence/plan-runtime-store";
import { getCurrentExecution } from "../use-cases/get-current-execution";
import { buildGraphCommand, resolveSubmitAttempt } from "./execute-command-graph-command";
import { createKernelGraphCallbacks } from "./graph-callbacks";
import type { EngineRuntimeContext, PlanExecutionObserver } from "./kernel-types";
import { persistAndFinalizeOutcome } from "./execute-command-outcome";
import type { PreparedCommandExecution } from "./execute-command-setup";
import { StaleRuntimeResultSyncError } from "./runtime-result-sync-errors";
import { prepareSubmitNodeResultDeliverables } from "./execute-command-deliverables";

const DEFAULT_MAX_STEPS = 10;

function staleRuntimeResultError(input: {
  taskId: string;
  command: ExecutionCommandEnvelope["command"];
  session: PreparedCommandExecution["session"];
}) {
  const { command, taskId, session } = input;
  if (command.type !== "submit_node_result" || !command.runtimeRunRef || session.status === "Active") return;
  throw new StaleRuntimeResultSyncError({ taskId, runtimeRunRef: command.runtimeRunRef }, "inactive_session");
}

function submittedRunId(command: Extract<ExecutionCommandEnvelope["command"], { type: "submit_node_result" }>, context: ExecutionCommandContext) {
  const evidence = command.result.evidence;
  const evidenceRunId = evidence && typeof evidence.runId === "string" ? evidence.runId : undefined;
  return context.runId ?? evidenceRunId ?? undefined;
}

async function exactSubmitIdentityValid(input: {
  taskId: string;
  command: Extract<ExecutionCommandEnvelope["command"], { type: "submit_node_result" }>;
  context: ExecutionCommandContext;
  planRunId: string;
  attemptId: string;
}) {
  const runId = submittedRunId(input.command, input.context);
  if (input.command.providerRunId) {
    const providerRun = await db.taskPlanProviderRun.findFirst({
      where: {
        id: input.command.providerRunId,
        taskId: input.taskId,
        planRunId: input.planRunId,
        nodeAttemptId: input.attemptId,
        ...(runId ? { runId } : {}),
        ...(input.command.runtimeRunRef ? { run: { runtimeRunRef: input.command.runtimeRunRef } } : {}),
      },
      select: { id: true },
    });
    if (!providerRun) return false;
  }
  if (!runId) return true;
  const run = await db.run.findFirst({
    where: {
      id: runId,
      taskId: input.taskId,
      nodeAttemptId: input.attemptId,
      ...(input.command.runtimeRunRef ? { runtimeRunRef: input.command.runtimeRunRef } : {}),
    },
    select: { id: true },
  });
  return run !== null;
}

async function unresolvedGraphCommandResult(input: {
  taskId: string;
  workBlockId: string | null;
}): Promise<PlanExecutionResult> {
  const current = await getCurrentExecution(input);
  return current.status === "completed" || current.status === "cancelled"
    ? { ...current, message: "Execution already completed; node result ignored." }
    : current;
}

export async function dispatchExecutionCommand(input: {
  taskId: string;
  command: ExecutionCommandEnvelope["command"];
  context: ExecutionCommandContext;
  observer: PlanExecutionObserver;
  prepared: PreparedCommandExecution;
}): Promise<PlanExecutionResult> {
  const { taskId, command, context, observer, prepared } = input;
  const {
    trigger,
    runtime,
    taskContext,
    goalContext,
    session,
    mainSession,
    runtimeName,
    existingContextSession,
    contextSessionId,
  } = prepared;
  staleRuntimeResultError({ taskId, command, session });

  const state = toGraphExecutionState(runtime.persisted);
  const effective = resolveEffectivePlanGraph(state);
  const submitAttempt = command.type === "submit_node_result" ? resolveSubmitAttempt(command, state, effective) : null;
  if (command.type === "submit_node_result" && submitAttempt && !(await exactSubmitIdentityValid({
    taskId,
    command,
    context,
    planRunId: runtime.persisted.id,
    attemptId: submitAttempt.id,
  }))) {
    return unresolvedGraphCommandResult({ taskId, workBlockId: session.workBlockId });
  }
  const graphCommand = buildGraphCommand({
    command,
    state,
    effective,
    session,
    engineContext: { taskId, planId: runtime.planId, mainSession },
    trigger,
  });
  if (!graphCommand) return unresolvedGraphCommandResult({ taskId, workBlockId: session.workBlockId });
  const submittedDeliverables = command.type === "submit_node_result" && submitAttempt
    ? prepareSubmitNodeResultDeliverables({
        runtime,
        session,
        command,
        nodeId: submitAttempt.nodeId,
        attemptId: submitAttempt.id,
      })
    : null;
  const deferredDeliverables = submittedDeliverables ? [submittedDeliverables] : [];

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
      executionEpoch: runtime.persisted.executionEpoch,
      persisted: runtime.persisted,
      planSummary: runtime.planSummary,
      taskContext,
      goalContext,
      initialRunContext: command.type === "start" || command.type === "restart_from_beginning"
        ? {
            ...(runtime.planPrompt ? { planningPrompt: runtime.planPrompt } : {}),
            ...(command.prompt ? { startPrompt: command.prompt } : {}),
          }
        : undefined,
      updateSessionProjection: !(existingContextSession && contextSessionId !== session.id),
      onGraphEvent: observer.onGraphEvent,
      onRuntimeEvent: observer.onRuntimeEvent,
      onStateChange: observer.onStateChange,
      deferExecutorDeliverables(preparedDeliverables) {
        deferredDeliverables.push(preparedDeliverables);
      },
    }),
  });
  let outcome: GraphDispatchOutcome;
  try {
    outcome = await graphRuntime.dispatch(graphCommand);
  } catch (error) {
    if (error instanceof PlanRuntimeStateChangedError) {
      return unresolvedGraphCommandResult({ taskId, workBlockId: session.workBlockId });
    }
    throw error;
  }
  return persistAndFinalizeOutcome({
    taskId,
    runtime,
    session,
    mainSession,
    command,
    context,
    existingContextSession,
    contextSessionId,
    outcome,
    deliverables: deferredDeliverables,
    commandReceipt: prepared.commandReceipt,
  });
}
