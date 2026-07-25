import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events";
import { publishTaskWorkspaceUpdatedEvent } from "@/modules/projections/task-projection-events";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { activateInternalEvent } from "../triggers/task-triggers";
import { splitAcceptedResultIntoCandidates } from "../goals/goal-workbench";

export async function acceptTaskResult(input: { taskId: string }) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { id: true, workspaceId: true, goalId: true, status: true },
  });
  const latestRun = await db.run.findFirst({
    where: { taskId: task.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  if (!latestRun || latestRun.status !== "Completed") {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Only completed runs can be accepted.",
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
    workBlockId: null,
    runId: latestRun.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      accepted_run_id: latestRun.id,
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
