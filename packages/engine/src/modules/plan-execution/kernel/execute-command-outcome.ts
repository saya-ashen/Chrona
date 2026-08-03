/* eslint-disable complexity, max-lines-per-function -- Outcome commitment explicitly validates every attempt and canonical Run scope. */
import { type GraphDispatchOutcome } from "@chrona/graph-runtime";
import type { ExecutionCommand, ExecutionCommandContext, PlanExecutionResult, PlanExecutionStatus } from "@chrona/contracts/ai";
import { RunStatus, type Prisma } from "@/generated/prisma/client";
import { executionStatusFromGraphOutcome, graphStatusForExecutionStatus } from "../execution-state-machine";
import { derivePlanRunFromRuntime, syncNormalizedRuntimeState, type NativePlanRuntime } from "../persistence/plan-runtime-store";
import { completePlanRunCommandReceiptInTransaction, savePlanRunGuarded, type ClaimedPlanRunCommand } from "../persistence/plan-run-store";
import type { ExecutionSessionRow } from "../persistence/execution-session-store";
import { appendMainSessionEvent } from "../persistence/plan-state-store";
import { getCurrentExecution } from "../use-cases/get-current-execution";
import { appendGraphRuntimeEvents } from "../persistence/runtime-event-store";
import { buildSemanticRefHistory } from "../runtime/node-runtime-refs";
import { aggregateResultManifest } from "../results/result-manifest";
import { finalizeTaskResult } from "../results/finalize-task-result";
import { buildFinalizedOutcomeResponse, commitOutcomeFinalizationInTransaction } from "./execute-command-finalization";
import { eventCommandType } from "./execute-command-graph-command";
import { withPlanExecutionDurability } from "../persistence/scheduler-durability";
import { markAuthoritativeExecutionResult } from "./command-receipts";
import { registerPreparedSubmitNodeResultDeliverables, type PreparedSubmitNodeResultDeliverables } from "./execute-command-deliverables";

// Authoritative graph state, finalization projections, graph events, and the
// command receipt response commit in one durability transaction. If the process
// crashes before this point the stale receipt lease is reclaimable; if it
// crashes after this point replay reads the original receipt result, not a later
// current-execution projection.
class OutcomeCommitLostAfterArtifactRegistration extends Error {}

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
  committedOutcome?: GraphDispatchOutcome;
  outcome: GraphDispatchOutcome;
  deliverables?: PreparedSubmitNodeResultDeliverables[];
  commandReceipt?: ClaimedPlanRunCommand;
};

function finalizationInput(input: OutcomeInput) {
  return {
    taskId: input.taskId,
    runtime: input.runtime,
    session: input.session,
    mainSessionId: input.command.type === "cancel" && input.existingContextSession
      ? input.session.id
      : input.mainSession.id,
    taskSessionId: input.mainSession.id,
    outcome: input.outcome,
    updateSessionState: !(input.existingContextSession && input.contextSessionId !== input.session.id),
  };
}

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

const ACTIVE_RUNTIME_RUN_STATUSES = [
  RunStatus.Pending,
  RunStatus.Running,
  RunStatus.WaitingForApproval,
  RunStatus.WaitingForInput,
] as const;

type OutcomeAttempt = OutcomeInput["outcome"]["state"]["attempts"][number];

function runtimeRunRefFromAttempt(attempt: OutcomeAttempt): string | null {
  const output = attempt.runtimeSnapshot?.output;
  if (!output || typeof output !== "object") return null;
  const runtimeRunRef = (output as Record<string, unknown>).runtimeRunRef;
  return typeof runtimeRunRef === "string" && runtimeRunRef.length > 0 ? runtimeRunRef : null;
}

function canonicalRunStatusForAttempt(attempt: OutcomeAttempt): RunStatus | null {
  if (attempt.status === "succeeded") return RunStatus.Completed;
  if (attempt.status === "failed") return RunStatus.Failed;
  if (attempt.status === "cancelled") return RunStatus.Cancelled;
  return null;
}

function terminalAttemptErrorSummary(attempt: OutcomeAttempt): string | null {
  if (attempt.status === "succeeded") return null;
  const message = attempt.error?.message;
  if (typeof message !== "string" || message.length === 0) {
    return attempt.status === "cancelled" ? "Runtime execution was cancelled" : "Runtime execution failed";
  }
  return message.slice(0, 2_000);
}

async function terminalizeAcceptedRuntimeRuns(input: OutcomeInput, tx: Prisma.TransactionClient): Promise<void> {
  const currentAttemptIds = new Set(input.outcome.state.results
    .filter((result) => (result.status === "current" || result.status === "rejected") && typeof result.attemptId === "string")
    .map((result) => result.attemptId as string));
  const submittedAttemptId = input.command.type === "submit_node_result"
    ? input.command.expectedAttemptId ?? input.context.nodeAttemptId ?? null
    : input.context.nodeAttemptId ?? null;
  for (const attempt of input.outcome.state.attempts) {
    const status = canonicalRunStatusForAttempt(attempt);
    if (!status || !currentAttemptIds.has(attempt.id)) continue;
    const runtimeRunRef = runtimeRunRefFromAttempt(attempt);
    const run = await tx.run.findUnique({
      where: { nodeAttemptId: attempt.id },
      select: {
        id: true,
        nodeAttemptId: true,
        taskId: true,
        taskSessionId: true,
        workBlockId: true,
        occurrenceId: true,
        runtimeRunRef: true,
        status: true,
      },
    });
    if (!run) continue;
    const isSubmittedAttempt = attempt.id === submittedAttemptId;
    if (runtimeRunRef && run.runtimeRunRef !== runtimeRunRef) {
      throw new Error(`Canonical runtime run ${run.id} does not match the accepted runtime reference`);
    }
    if (
      run.taskId !== input.taskId
      || run.taskSessionId !== input.mainSession.id
      || run.workBlockId !== input.session.workBlockId
      || run.occurrenceId !== input.session.occurrenceId
      || run.nodeAttemptId !== attempt.id
      || (isSubmittedAttempt && input.context.runId && input.context.runId !== run.id)
      || (isSubmittedAttempt && input.context.nodeAttemptId && input.context.nodeAttemptId !== attempt.id)
    ) {
      throw new Error(`Canonical runtime run ${run.id} does not match the accepted graph attempt scope`);
    }

    const expectedProviderRunId = isSubmittedAttempt
      ? input.command.type === "submit_node_result"
        ? input.command.providerRunId ?? input.context.providerRunId ?? null
        : input.context.providerRunId ?? null
      : null;
    const providerRuns = await tx.taskPlanProviderRun.findMany({
      where: {
        taskId: input.taskId,
        planRunId: input.runtime.persisted.id,
        nodeAttemptId: attempt.id,
        runId: run.id,
        ...(expectedProviderRunId ? { id: expectedProviderRunId } : {}),
      },
      select: { id: true, runId: true },
      take: 2,
    });
    if (
      providerRuns.length > 1
      || (expectedProviderRunId !== null && providerRuns.length !== 1)
      || (run.runtimeRunRef !== null && providerRuns.length !== 1)
    ) {
      throw new Error(`Accepted graph attempt ${attempt.id} does not resolve to its exact provider run`);
    }

    const updated = await tx.run.updateMany({
      where: {
        id: run.id,
        taskId: input.taskId,
        taskSessionId: input.mainSession.id,
        workBlockId: input.session.workBlockId,
        occurrenceId: input.session.occurrenceId,
        runtimeRunRef: run.runtimeRunRef,
        nodeAttemptId: attempt.id,
        status: { in: [...ACTIVE_RUNTIME_RUN_STATUSES] },
      },
      data: {
        status,
        endedAt: attempt.finishedAt ? new Date(attempt.finishedAt) : new Date(),
        errorSummary: terminalAttemptErrorSummary(attempt),
        retryable: false,
        resumeSupported: false,
        pendingInputPrompt: null,
        lastSyncedAt: new Date(),
        syncStatus: "healthy",
        mappingPartial: false,
      },
    });
    if (updated.count !== 1 && run.status !== status) {
      throw new Error(`Canonical runtime run ${run.id} changed before authoritative terminalization`);
    }
  }
}


async function saveOutcome(input: OutcomeInput, status: PlanExecutionStatus) {
  const { runtime, outcome } = input;
  const graph = { ...outcome.state.graph, status: graphStatusForExecutionStatus(status) };
  let results = outcome.state.results;
  let registeredDeliverables = false;
  const planOutput = () => outputWithManifest({ ...input, outcome: { ...outcome, state: { ...outcome.state, results } } });
  const run = () => derivePlanRunFromRuntime({
    existingRun: runtime.persisted.planRun,
    compiledPlan: runtime.compiledPlan,
    graph,
    attempts: outcome.state.attempts,
    results,
    executionContextSnapshots: outcome.state.executionContextSnapshots,
    status,
  });
  const committed = await withPlanExecutionDurability(async (tx) => {
    for (const prepared of input.deliverables ?? []) {
      const acceptedResult = [...results].reverse().find(
        (result) =>
          result.nodeId === prepared.nodeId
          && result.status === "current"
          && (!prepared.attemptId || result.attemptId === prepared.attemptId)
          && (!result.deliverables || result.deliverables.length === 0),
      );
      if (!acceptedResult) continue;
      const registered = await registerPreparedSubmitNodeResultDeliverables({
        runtime,
        mainSessionId: input.mainSession.id,
        prepared,
        runId: acceptedResult.evidence?.runId,
        sourceNodeRef: acceptedResult.deliverables?.[0]?.sourceNodeRef,
      }, tx);
      results = results.map((result) => result === acceptedResult ? { ...result, deliverables: registered } : result);
      registeredDeliverables = true;
    }
    input.committedOutcome = { ...outcome, state: { ...outcome.state, results } };
    const saved = await savePlanRunGuarded({
      workspaceId: runtime.workspaceId,
      taskId: input.taskId,
      planId: runtime.planId,
      workBlockId: input.session.workBlockId,
      expectedEpoch: runtime.persisted.executionEpoch,
      run: run(),
      compiledPlan: runtime.compiledPlan,
      graph,
      attempts: outcome.state.attempts,
      results,
      executionContextSnapshots: outcome.state.executionContextSnapshots,
      planOutput: planOutput(),
    }, tx);
    if (!saved.committed) {
      if (registeredDeliverables) throw new OutcomeCommitLostAfterArtifactRegistration();
      return { saved, finalization: null };
    }
    await syncNormalizedRuntimeState({
      workspaceId: runtime.workspaceId,
      taskId: input.taskId,
      workBlockId: input.session.workBlockId,
      planId: runtime.planId,
      attempts: outcome.state.attempts,
      results,
    }, tx);
    await terminalizeAcceptedRuntimeRuns(input, tx);
    if (input.command.type === "retry_node") {
      const now = new Date();
      await tx.taskPlanProviderApproval.updateMany({
        where: {
          taskId: input.taskId,
          planRunId: runtime.persisted.id,
          status: "pending",
          nodeAttempt: { status: { not: "running" } },
        },
        data: {
          status: "superseded",
          resolvedAt: now,
          resolvedBy: "system",
          resolutionRaw: { resolution_source: "retry_scope_replacement", reason: "node_attempt_retried" },
        },
      });
      await tx.taskPlanProviderRun.updateMany({
        where: {
          taskId: input.taskId,
          planRunId: runtime.persisted.id,
          status: "waiting_for_approval",
          nodeAttempt: { status: { not: "running" } },
        },
        data: { status: "cancelled", finishedAt: now },
      });
    }
    const finalization = await commitOutcomeFinalizationInTransaction(
      finalizationInput(input),
      runtime.persisted.executionEpoch + 1,
      tx,
    );
    if (!finalization) throw new Error("Plan outcome finalization lost its guarded execution epoch");
    await appendOutcomeEvents({ ...input, outcome: input.committedOutcome ?? outcome }, tx);
    const response = markAuthoritativeExecutionResult(buildFinalizedOutcomeResponse(
      { ...finalizationInput(input), outcome: input.committedOutcome ?? outcome },
      finalization,
      planOutput(),
    ));
    if (input.commandReceipt) {
      const receiptCompleted = await completePlanRunCommandReceiptInTransaction({
        tx,
        receipt: input.commandReceipt,
        result: response,
      });
      if (!receiptCompleted) throw new Error("Plan outcome receipt lost its exact claim CAS");
    }
    return { saved, finalization, response };
  }).catch((error) => {
    if (!(error instanceof OutcomeCommitLostAfterArtifactRegistration)) throw error;
    return { saved: { committed: false, planRun: run() }, finalization: null, response: undefined };
  });
  return { committed: committed.saved, planOutput: planOutput(), finalization: committed.finalization, response: committed.response };
}

async function appendOutcomeEvents(input: OutcomeInput, tx: Prisma.TransactionClient): Promise<void> {
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
  }, tx);
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
  const { committed, planOutput, finalization, response } = await saveOutcome(input, status);
  if (!committed.committed || !finalization || !response) {
    return getCurrentExecution({ taskId: input.taskId, workBlockId: input.session.workBlockId });
  }
  if (status === "completed") await finalizeCompletedResult(input, String(planOutput.manifest.sourceRevision));
  return response;
}
