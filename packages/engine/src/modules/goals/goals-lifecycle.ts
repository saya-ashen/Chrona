import { db } from "@chrona/db";
import type {
  ConfirmGoalCriterionRequest,
  GoalActionRequest,
  ProcessGoalResultRequest,
  ReviewGoalCriterionRequest,
} from "@chrona/contracts/api";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { getGoal, getGoalOrThrow, toGoalReadModel } from "./goals-read";
import {
  acceptedResultForTask,
  appendGoalEvent,
  AchievementConfirmation,
  criteriaFrom,
  goalInclude,
  GoalWithDetails,
} from "./goals-shared";

export async function actOnGoal(input: { goalId: string; command: GoalActionRequest }) {
  const goal = await getGoalOrThrow(input.goalId);
  const now = new Date();

  if (input.command.action === "achieve") {
    if (goal.status !== "Active") {
      throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can be achieved");
    }
    const criteria = criteriaFrom(goal.successCriteria);
    if (criteria.length === 0 || criteria.some((criterion) => !criterion.satisfied)) {
      throw new EngineError(
        ENGINE_ERROR_CODES.CONFLICT,
        "Every success criterion must be explicitly confirmed before the Goal can be achieved",
      );
    }
    const evidenceIds = [...new Set(input.command.evidenceArtifactIds)];
    const criterionEvidenceIds = new Set(criteria.flatMap((criterion) => criterion.evidenceArtifactIds ?? []));
    if (evidenceIds.some((id) => !criterionEvidenceIds.has(id))) {
      throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Achievement evidence must already confirm a success criterion");
    }
    const evidence = await db.artifact.findMany({
      where: {
        id: { in: evidenceIds },
        workspaceId: goal.workspaceId,
        OR: [
          { task: { goalId: goal.id } },
          { sourceGoalAssets: { some: { goalId: goal.id } } },
          { currentGoalAssets: { some: { goalId: goal.id } } },
        ],
      },
      select: { id: true },
    });
    if (evidence.length !== evidenceIds.length) {
      throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Every achievement evidence artifact must belong to this Goal");
    }
    const confirmation: AchievementConfirmation = {
      note: input.command.confirmation,
      actorType: "user",
      actorId: "server-action",
      confirmedAt: now.toISOString(),
      evidenceArtifactIds: evidenceIds,
    };
    await db.$transaction(async (tx) => {
      await tx.goal.update({ where: { id: goal.id }, data: { status: "Achieved", achievedAt: now, achievementConfirmation: confirmation } });
      const latest = await tx.event.aggregate({ _max: { ingestSequence: true } });
      await tx.event.create({
        data: {
          eventType: "goal.achieved",
          workspaceId: goal.workspaceId,
          actorType: "user",
          actorId: "server-action",
          source: "ui",
          payload: { goal_id: goal.id, confirmation: confirmation.note, evidence_artifact_ids: evidenceIds },
          summary: confirmation.note,
          occurredAt: now,
          ingestSequence: (latest._max.ingestSequence ?? 0) + 1,
        },
      });
    });
    return getGoal({ goalId: goal.id });
  }

  const transition = (() => {
    switch (input.command.action) {
      case "pause":
        if (goal.status !== "Active") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can be paused");
        return { data: { status: "Paused" as const }, eventType: "goal.paused" as const, summary: `Paused Goal: ${goal.title}` };
      case "resume":
        if (goal.status !== "Paused") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only paused Goals can be resumed");
        return { data: { status: "Active" as const }, eventType: "goal.resumed" as const, summary: `Resumed Goal: ${goal.title}` };
      case "stop":
        if (goal.status === "Achieved") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "An achieved Goal cannot be stopped");
        return { data: { status: "Stopped" as const, stoppedAt: now }, eventType: "goal.stopped" as const, summary: `Stopped Goal: ${goal.title}` };
    }
  })();
  const updated = await db.goal.update({ where: { id: goal.id }, data: transition.data, include: goalInclude });
  await appendGoalEvent({
    eventType: transition.eventType,
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    summary: transition.summary,
    occurredAt: now,
  });
  return toGoalReadModel(updated);
}


function acceptedResultOrThrow(goal: GoalWithDetails, taskId: string) {
  const task = goal.tasks.find((candidate) => candidate.id === taskId);
  const result = task ? acceptedResultForTask(task) : null;
  if (!task || !result) {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "The Task must have an accepted result");
  }
  return { task, result };
}

function resultArtifactsOrThrow(
  result: NonNullable<ReturnType<typeof acceptedResultForTask>>,
  artifactIds: string[],
) {
  const requested = new Set(artifactIds);
  const artifacts = result.artifacts.filter((artifact) => requested.has(artifact.id));
  if (artifacts.length !== requested.size) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Every Artifact must belong to the accepted result");
  }
  return artifacts;
}

export async function processGoalResult(input: {
  goalId: string;
  taskId: string;
  command: ProcessGoalResultRequest;
}) {
  const goal = await getGoalOrThrow(input.goalId);
  if (goal.status !== "Active") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can process results");
  }
  const { result } = acceptedResultOrThrow(goal, input.taskId);
  const artifacts = resultArtifactsOrThrow(result, [...new Set(input.command.artifactIds)]);
  const criterion = input.command.criterionId
    ? criteriaFrom(goal.successCriteria).find((candidate) => candidate.id === input.command.criterionId)
    : null;
  if (input.command.criterionId && !criterion) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Success criterion not found");
  }
  await db.$transaction(async (tx) => {
    if (!criterion) return;
    const formalAssets = await tx.goalAsset.findMany({
      where: { goalId: goal.id, sourceArtifactId: { in: artifacts.map((artifact) => artifact.id) } },
      select: { id: true, sourceArtifactId: true },
    });
    if (formalAssets.length !== artifacts.length) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "Review every selected Artifact in the Goal Workbench Inbox before linking it as criterion evidence",
      );
    }
    await tx.goalAsset.updateMany({ where: { id: { in: formalAssets.map((asset) => asset.id) } }, data: { role: "evidence" } });
  });
  await appendGoalEvent({
    eventType: "goal.result_processed",
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    payload: { task_id: input.taskId, run_id: result.runId, artifact_ids: artifacts.map((artifact) => artifact.id), criterion_id: criterion?.id ?? null },
    summary: `Processed accepted result: ${input.taskId}`,
  });
  return getGoal({ goalId: goal.id });
}

export async function reviewGoalCriterion(input: {
  goalId: string;
  criterionId: string;
  command: ReviewGoalCriterionRequest;
}) {
  const goal = await getGoalOrThrow(input.goalId);
  if (goal.status !== "Active") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can review success criteria");
  }
  const criteria = criteriaFrom(goal.successCriteria);
  const criterionIndex = criteria.findIndex((criterion) => criterion.id === input.criterionId);
  if (criterionIndex < 0) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Success criterion not found");
  const updatedCriteria = criteria.map((criterion, index) => index === criterionIndex
    ? { ...criterion, description: input.command.description, proposalStatus: "confirmed" as const }
    : criterion);
  await db.goal.update({ where: { id: goal.id }, data: { successCriteria: updatedCriteria } });
  await appendGoalEvent({
    eventType: "goal.criterion_confirmed",
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    payload: { criterion_id: input.criterionId, proposal_reviewed: true },
    summary: input.command.description,
  });
  return getGoal({ goalId: goal.id });
}

export async function confirmGoalCriterion(input: {
  goalId: string;
  criterionId: string;
  command: ConfirmGoalCriterionRequest;
}) {
  const goal = await getGoalOrThrow(input.goalId);
  if (goal.status !== "Active") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can confirm success criteria");
  }
  const artifacts = await db.artifact.findMany({
    where: {
      id: { in: [...new Set(input.command.artifactIds)] },
      workspaceId: goal.workspaceId,
      OR: [
        { task: { goalId: goal.id } },
        { sourceGoalAssets: { some: { goalId: goal.id } } },
        { currentGoalAssets: { some: { goalId: goal.id } } },
      ],
    },
    select: { id: true },
  });
  if (artifacts.length !== new Set(input.command.artifactIds).size) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Every criterion evidence Artifact must belong to this Goal");
  }
  const now = new Date();
  const criteria = criteriaFrom(goal.successCriteria);
  const criterionIndex = criteria.findIndex((criterion) => criterion.id === input.criterionId);
  if (criterionIndex < 0) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Success criterion not found");
  const updatedCriteria = criteria.map((criterion, index) => index === criterionIndex
    ? { ...criterion, satisfied: true, confirmedAt: now.toISOString(), evidenceArtifactIds: artifacts.map((artifact) => artifact.id) }
    : criterion);
  await db.goal.update({ where: { id: goal.id }, data: { successCriteria: updatedCriteria } });
  await appendGoalEvent({
    eventType: "goal.criterion_confirmed",
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    occurredAt: now,
    payload: { criterion_id: input.criterionId, artifact_ids: artifacts.map((artifact) => artifact.id), note: input.command.note },
    summary: input.command.note,
  });
  return getGoal({ goalId: goal.id });
}
