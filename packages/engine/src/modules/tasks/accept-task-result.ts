/* eslint-disable complexity, max-lines-per-function -- Acceptance bridges legacy Run records with canonical graph execution state. */
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events";
import { publishTaskWorkspaceUpdatedEvent } from "@/modules/projections/task-projection-events";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { activateInternalEvent } from "../triggers/task-triggers";
import { splitAcceptedResultIntoCandidates } from "../goals/goal-workbench";
import { getCurrentExecution } from "../plan-execution/use-cases/get-current-execution";
import { ensurePlanExecutionRun } from "../plan-execution/persistence/task-execution-store";

export async function acceptTaskResult(input: { taskId: string }) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { id: true, workspaceId: true, goalId: true, status: true },
  });
  const currentExecution = await getCurrentExecution({ taskId: task.id });
  const canonicalPlanRun = currentExecution.planRunId
    ? await db.taskPlanRun.findUnique({
        where: { id: currentExecution.planRunId },
        select: { id: true, workBlockId: true, occurrenceId: true },
      })
    : await db.taskPlanRun.findFirst({
        where: { taskId: task.id, workBlockId: null },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { id: true, workBlockId: true, occurrenceId: true },
      });
  const canonicalPlanRunId = canonicalPlanRun?.id ?? null;
  let latestRun = await db.run.findFirst({
    where: { taskId: task.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  // Graph execution is authoritative for plan-backed tasks. Older graph-only
  // executions may not have a legacy Run row, so materialize the compatibility
  // identity once before recording result review.
  if ((!latestRun || latestRun.status !== "Completed") && currentExecution.status === "completed" && canonicalPlanRun) {
    latestRun = await ensurePlanExecutionRun({
      taskId: task.id,
      planRunId: canonicalPlanRun.id,
      workBlockId: canonicalPlanRun.workBlockId,
      occurrenceId: canonicalPlanRun.occurrenceId,
      status: "Completed",
      triggeredBy: "result-review",
      setAsLatest: true,
    });
  }

  if (!latestRun || latestRun.status !== "Completed") {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Only completed runs can be accepted.",
    );
  }

  if (
    currentExecution.planOutput &&
    currentExecution.planOutput.finalization.status !== "Ready"
  ) {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Only successfully finalized task results can be accepted.",
    );
  }

  const existingAcceptance = await db.event.findFirst({
    where: {
      taskId: task.id,
      runId: latestRun.id,
      eventType: "task.result_accepted",
    },
    orderBy: { ingestedAt: "desc" },
    select: { payload: true, ingestedAt: true },
  });
  if (existingAcceptance) {
    const payload = existingAcceptance.payload as { accepted_at?: unknown } | null;
    const acceptedAt = typeof payload?.accepted_at === "string"
      ? payload.accepted_at
      : existingAcceptance.ingestedAt.toISOString();
    if (task.goalId) {
      await splitAcceptedResultIntoCandidates({
        goalId: task.goalId,
        taskId: task.id,
        runId: latestRun.id,
      });
    }
    return {
      taskId: task.id,
      workspaceId: task.workspaceId,
      runId: latestRun.id,
      acceptedAt,
    };
  }

  const acceptedAt = new Date().toISOString();

  await appendCanonicalEvent({
    eventType: "task.result_accepted",
    workspaceId: task.workspaceId,
    taskId: task.id,
    workBlockId: latestRun.workBlockId,
    runId: latestRun.id,
    planRunId: canonicalPlanRunId,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      accepted_run_id: latestRun.id,
      accepted_plan_run_id: canonicalPlanRunId,
      accepted_at: acceptedAt,
    },
    dedupeKey: `task.result_accepted:${task.id}:${latestRun.id}`,
  });

  if (task.goalId) {
    await splitAcceptedResultIntoCandidates({ goalId: task.goalId, taskId: task.id, runId: latestRun.id });
  }

  await activateInternalEvent({
    workspaceId: task.workspaceId,
    topic: "task.result.accepted",
    causationId: `task-result:${task.id}:${latestRun.id}`,
    normalizedInput: {
      taskId: task.id,
      runId: latestRun.id,
      acceptedAt,
    },
  });


  publishTaskWorkspaceUpdatedEvent({
    taskId: task.id,
    workspaceId: task.workspaceId,
    reason: "task.result_accepted",
  });

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    runId: latestRun.id,
    acceptedAt,
  };
}
