import { type GraphDispatchOutcome } from "@chrona/graph-runtime";
import type { ExecutionCommand, ExecutionCommandContext, PlanExecutionResult, PlanExecutionStatus } from "@chrona/contracts/ai";
import { executionStatusFromGraphOutcome, graphStatusForExecutionStatus } from "../execution-state-machine";
import { derivePlanRunFromRuntime, syncNormalizedRuntimeState, type NativePlanRuntime } from "../persistence/plan-runtime-store";
import { savePlanRunGuarded } from "../persistence/plan-run-store";
import type { ExecutionSessionRow } from "../persistence/execution-session-store";
import { appendMainSessionEvent } from "../persistence/plan-state-store";
import { getCurrentExecution } from "../use-cases/get-current-execution";
import { appendGraphRuntimeEvents } from "../persistence/runtime-event-store";
import { buildSemanticRefHistory } from "../runtime/node-runtime-refs";
import { aggregateResultManifest } from "../results/result-manifest";
import { finalizeTaskResult } from "../results/finalize-task-result";
import { finalizeOutcome } from "./execute-command-finalization";
import { eventCommandType } from "./execute-command-graph-command";

type MainSession = { id: string; taskId: string; sessionKey: string };
type OutcomeInput = {
  taskId: string;
  runtime: NativePlanRuntime;
  session: ExecutionSessionRow;
  mainSession: MainSession;
  command: ExecutionCommand;
  context: ExecutionCommandContext;
  existingContextSession: { id: string } | null;
  contextSessionId?: string;
  outcome: GraphDispatchOutcome;
};

function outputWithManifest(input: OutcomeInput) {
  const { runtime, outcome, command, session } = input;
  const manifest = aggregateResultManifest({
    results: outcome.state.results,
    previous: runtime.persisted.planOutput.manifest,
    sourceNodeRef: (nodeId) => buildSemanticRefHistory(outcome.effective).nodeRefs.find(
      (binding) => binding.nodeId === nodeId || binding.backendId === nodeId,
    )?.ref ?? nodeId,
  });
  const manifestChanged = manifest.sourceRevision !== runtime.persisted.planOutput.manifest.sourceRevision;
  return {
    ...runtime.persisted.planOutput,
    manifest,
    finalizedResult: manifestChanged ? null : runtime.persisted.planOutput.finalizedResult,
    finalization: manifestChanged
      ? { status: "Pending" as const, sourceRevision: manifest.sourceRevision }
      : runtime.persisted.planOutput.finalization,
    revision: manifestChanged ? runtime.persisted.planOutput.revision + 1 : runtime.persisted.planOutput.revision,
    updatedAt: manifestChanged ? new Date().toISOString() : runtime.persisted.planOutput.updatedAt,
    updatedByNodeId: manifestChanged && command.type === "submit_node_result"
      ? command.nodeId ?? session.currentNodeId
      : runtime.persisted.planOutput.updatedByNodeId,
  };
}

async function saveOutcome(input: OutcomeInput, status: PlanExecutionStatus) {
  const { runtime, outcome } = input;
  const graph = { ...outcome.state.graph, status: graphStatusForExecutionStatus(status) };
  const run = derivePlanRunFromRuntime({
    existingRun: runtime.persisted.planRun,
    compiledPlan: runtime.compiledPlan,
    graph,
    attempts: outcome.state.attempts,
    results: outcome.state.results,
    executionContextSnapshots: outcome.state.executionContextSnapshots,
    status,
  });
  const planOutput = outputWithManifest(input);
  const committed = await savePlanRunGuarded({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    expectedEpoch: runtime.persisted.executionEpoch,
    run,
    compiledPlan: runtime.compiledPlan,
    graph,
    attempts: outcome.state.attempts,
    results: outcome.state.results,
    executionContextSnapshots: outcome.state.executionContextSnapshots,
    planOutput,
  });
  return { committed, planOutput };
}

async function appendOutcomeEvents(input: OutcomeInput): Promise<void> {
  const { taskId, runtime, session, mainSession, command, context, outcome } = input;
  await appendGraphRuntimeEvents({
    taskId,
    workBlockId: session.workBlockId,
    planId: runtime.planId,
    sessionId: mainSession.id,
    events: outcome.events,
    envelope: {
      command: { type: eventCommandType(command) },
      actor: context.actor ?? (command.type === "submit_node_result"
        ? { type: "user" }
        : { type: "system", service: "plan-execution" }),
      origin: context.origin ?? { channel: command.type === "submit_node_result" ? "api" : "internal" },
      correlation: { taskId, planId: runtime.planId, mainSessionId: mainSession.id, executionSessionId: session.id },
    },
  });
}

async function finalizeCompletedResult(input: OutcomeInput, sourceRevision: string): Promise<void> {
  const { taskId, runtime, session, mainSession } = input;
  await appendMainSessionEvent({
    taskId, planId: runtime.planId, sessionId: mainSession.id,
    eventType: "result_finalization_started", payload: { sourceRevision },
  });
  try {
    const finalized = await finalizeTaskResult({ taskId, workBlockId: session.workBlockId });
    await appendMainSessionEvent({
      taskId, planId: runtime.planId, sessionId: mainSession.id,
      eventType: "result_finalization_ready", payload: { sourceRevision: finalized.manifest.sourceRevision },
    });
  } catch (error) {
    await appendMainSessionEvent({
      taskId, planId: runtime.planId, sessionId: mainSession.id,
      eventType: "result_finalization_failed",
      payload: { sourceRevision, message: error instanceof Error ? error.message : String(error) },
    });
  }
}

export async function persistAndFinalizeOutcome(input: OutcomeInput): Promise<PlanExecutionResult> {
  const status = executionStatusFromGraphOutcome(input.outcome);
  const { committed, planOutput } = await saveOutcome(input, status);
  if (!committed.committed) return getCurrentExecution({ taskId: input.taskId, workBlockId: input.session.workBlockId });
  await syncNormalizedRuntimeState({
    workspaceId: input.runtime.workspaceId,
    taskId: input.taskId,
    planId: input.runtime.planId,
    attempts: input.outcome.state.attempts,
    results: input.outcome.state.results,
  });
  await appendOutcomeEvents(input);
  if (status === "completed") await finalizeCompletedResult(input, String(planOutput.manifest.sourceRevision));
  return finalizeOutcome({
    taskId: input.taskId,
    runtime: input.runtime,
    session: input.session,
    mainSessionId: input.command.type === "cancel" && input.existingContextSession
      ? input.session.id
      : input.mainSession.id,
    outcome: input.outcome,
    updateSessionState: !(input.existingContextSession && input.contextSessionId !== input.session.id),
  });
}
