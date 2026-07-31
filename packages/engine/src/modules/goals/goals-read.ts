import { db } from "@chrona/db";
import { deriveGoalProjection } from "@chrona/domain";
import type { GoalSuccessCriterion } from "@chrona/contracts/api";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { goalAcceptedResultRef } from "./goal-task-context";
import {
  acceptedResultForTask,
  achievementConfirmationFrom,
  artifactReadModel,
  boundedText,
  criteriaFrom,
  GOAL_CONTEXT_RESULT_LIMIT,
  GOAL_CONTEXT_SUMMARY_LIMIT,
  GoalWithDetails,
  GoalTask,
  goalInclude,
  operationalBriefFrom,
  recordValue,
} from "./goals-shared";

export function acceptedResultCatalog(goal: GoalWithDetails) {
  return goal.tasks
    .flatMap((task) => {
      const result = acceptedResultForTask(task);
      return result ? [{
        ref: goalAcceptedResultRef(result.runId),
        taskTitle: task.title,
        acceptedAt: result.acceptedAt,
        summary: boundedText(result.summary, GOAL_CONTEXT_SUMMARY_LIMIT),
        artifactCount: result.artifacts.length,
      }] : [];
    })
    .sort((left, right) => (right.acceptedAt ?? "").localeCompare(left.acceptedAt ?? ""))
    .slice(0, GOAL_CONTEXT_RESULT_LIMIT);
}



export function taskGroup(task: GoalTask) {
  if (["WaitingForInput", "WaitingForApproval", "Blocked", "Failed"].includes(task.status)) return "attention" as const;
  if (["Queued", "Running"].includes(task.status)) return "active" as const;
  if (["Completed", "Done", "Cancelled"].includes(task.status)) return "completed" as const;
  return "planned" as const;
}

export function taskReadModel(task: GoalTask) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    kind: task.kind,
    dueAt: task.dueAt?.toISOString() ?? null,
    updatedAt: task.updatedAt.toISOString(),
    attention: task.projection?.displayState ?? null,
    group: taskGroup(task),
    acceptedResult: acceptedResultForTask(task),
  };
}
export function choosePrimaryResult(goal: GoalWithDetails) {
  const evidenceIds = new Set(
    achievementConfirmationFrom(goal.achievementConfirmation)?.evidenceArtifactIds ?? [],
  );
  const finalAssets = goal.assets.filter((asset) =>
    evidenceIds.has(asset.currentArtifactId) ||
    recordValue(asset.currentArtifact.metadata)?.finalGoalResult === true,
  );
  const finalAsset = finalAssets.find((asset) => asset.currentArtifact.uri.startsWith("generated://"))
    || finalAssets.at(0)
    || goal.assets.find((asset) => asset.role === "evidence" || asset.role === "submission");
  return finalAsset ? artifactReadModel(finalAsset.currentArtifact) : goal.tasks.flatMap((task) => acceptedResultForTask(task)?.artifacts ?? [])[0] ?? null;
}

export function eventReadModels(goal: GoalWithDetails) {
  const taskActivity: Array<{
    id: string;
    type: string;
    title: string;
    detail: string | null;
    occurredAt: string;
    taskId: string | null;
  }> = goal.tasks.flatMap((task) => {
    const result = acceptedResultForTask(task);
    const items = [{
      id: `task:${task.id}`,
      type: "task_created",
      title: task.title,
      detail: task.description,
      occurredAt: task.createdAt.toISOString(),
      taskId: task.id,
    }];
    if (result) {
      items.push({
        id: `accepted:${task.id}:${result.runId}`,
        type: "result_accepted",
        title: task.title,
        detail: result.summary,
        occurredAt: result.acceptedAt ?? task.updatedAt.toISOString(),
        taskId: task.id,
      });
    }
    return items;
  });
  const confirmation = achievementConfirmationFrom(goal.achievementConfirmation);
  if (confirmation) {
    taskActivity.push({
      id: `achieved:${goal.id}`,
      type: "goal_achieved",
      title: goal.title,
      detail: confirmation.note,
      occurredAt: confirmation.confirmedAt,
      taskId: null,
    });
  }
  return taskActivity.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export function reviewProposalReadModel(proposal: GoalWithDetails["reviewProposals"][number]) {
  const sourceRun = proposal.sourceTask?.runs[0] ?? null;
  return {
    id: proposal.id,
    status: proposal.status,
    sourceTaskId: proposal.sourceTaskId,
    sourceRunId: proposal.sourceRunId,
    sourceTask: proposal.sourceTask
      ? {
          id: proposal.sourceTask.id,
          title: proposal.sourceTask.title,
          status: proposal.sourceTask.status,
          latestRunId: proposal.sourceTask.latestRunId,
          latestRun: sourceRun ? { id: sourceRun.id, status: sourceRun.status, errorSummary: sourceRun.errorSummary } : null,
        }
      : null,
    inputSnapshotHash: proposal.inputSnapshotHash,
    schemaVersion: proposal.schemaVersion,
    providerName: proposal.providerName,
    modelName: proposal.modelName,
    summary: proposal.summary,
    generationError: proposal.generationError,
    appliedAt: proposal.appliedAt?.toISOString() ?? null,
    rejectedAt: proposal.rejectedAt?.toISOString() ?? null,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
    items: proposal.items.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      kind: item.kind,
      payload: item.payload,
      rationale: item.rationale,
      evidenceRefs: item.evidenceRefs,
      warnings: item.warnings,
      dependencyHash: item.dependencyHash,
      decision: item.decision,
      decisionReason: item.decisionReason,
      appliedObjectType: item.appliedObjectType,
      appliedObjectId: item.appliedObjectId,
      decidedAt: item.decidedAt?.toISOString() ?? null,
    })),
  };
}

export function goalProjection(goal: GoalWithDetails, successCriteria: GoalSuccessCriterion[]) {
  const projection = deriveGoalProjection({
    status: goal.status,
    nextReviewAt: goal.nextReviewAt,
    tasks: goal.tasks.map((task) => ({ status: task.status, blockType: task.projection?.blockType ?? null })),
    successCriteria,
  });
  return goal.inboxCandidates.length === 0 ? projection : { ...projection, attention: "needs_input" as const };
}

export function groupedTaskReadModels(tasks: ReturnType<typeof taskReadModel>[]) {
  return {
    attention: tasks.filter((task) => task.group === "attention"),
    active: tasks.filter((task) => task.group === "active"),
    planned: tasks.filter((task) => task.group === "planned"),
    completed: tasks.filter((task) => task.group === "completed"),
  };
}

export function primaryTaskIdFor(projection: ReturnType<typeof deriveGoalProjection>, groups: ReturnType<typeof groupedTaskReadModels>) {
  if (projection.nextAction === "resolve_attention") return groups.attention[0]?.id ?? null;
  if (projection.nextAction === "continue_work") return groups.planned[0]?.id || groups.active[0]?.id || null;
  return null;
}

export function goalAssetReadModels(goal: GoalWithDetails) {
  return goal.assets.map((asset) => ({
    id: asset.id, label: asset.label, role: asset.role, status: asset.status,
    createdAt: asset.createdAt.toISOString(), updatedAt: asset.updatedAt.toISOString(),
    sourceArtifact: artifactReadModel(asset.sourceArtifact), currentVersion: asset.versions[0]?.version ?? null,
    currentArtifact: artifactReadModel(asset.currentArtifact),
    provenance: { sourceTaskId: asset.sourceArtifact.taskId, sourceRunId: asset.sourceArtifact.runId, sourceArtifactId: asset.sourceArtifactId, currentArtifactId: asset.currentArtifactId, unchanged: asset.sourceArtifactId === asset.currentArtifactId },
  }));
}

export function acceptedTaskReadModels(tasks: ReturnType<typeof taskReadModel>[]) {
  return tasks.flatMap((task) => task.acceptedResult === null ? [] : [{ taskId: task.id, taskTitle: task.title, ...task.acceptedResult }]);
}

export function goalOutcome(goal: GoalWithDetails, criteria: GoalSuccessCriterion[]) {
  const evidence = new Map(criteria.map((criterion) => [criterion.id, criterion.evidenceArtifactIds]));
  return {
    primaryResult: choosePrimaryResult(goal),
    confirmation: achievementConfirmationFrom(goal.achievementConfirmation),
    criteria: criteria.map((criterion) => ({ ...criterion, evidenceArtifactIds: evidence.get(criterion.id) ?? [] })),
  };
}

export function toGoalReadModel(goal: GoalWithDetails) {
  const successCriteria = criteriaFrom(goal.successCriteria);
  const projection = goalProjection(goal, successCriteria);
  const tasks = goal.tasks.map(taskReadModel);
  const groupedTasks = groupedTaskReadModels(tasks);
  return {
    id: goal.id,
    workspaceId: goal.workspaceId,
    title: goal.title,
    titleSource: goal.titleSource,
    titleRenameNoticeSeenAt: goal.titleRenameNoticeSeenAt?.toISOString() ?? null,
    description: goal.description,
    successCriteria,
    status: goal.status,
    mode: goal.status === "Achieved" || goal.status === "Stopped" ? "archive" as const : "workspace" as const,
    nextReviewAt: goal.nextReviewAt?.toISOString() ?? null,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    achievedAt: goal.achievedAt?.toISOString() ?? null,
    stoppedAt: goal.stoppedAt?.toISOString() ?? null,
    projection,
    primaryAction: { kind: projection.nextAction, taskId: primaryTaskIdFor(projection, groupedTasks) },
    outcome: goalOutcome(goal, successCriteria),
    workbench: {
      brief: operationalBriefFrom(goal.operationalBrief),
      briefRevisionCount: goal.briefRevisions.length,
      pendingInboxCount: goal.inboxCandidates.length,
      focus: { needsYou: groupedTasks.attention, inProgress: groupedTasks.active, newResults: groupedTasks.completed.filter((task) => task.acceptedResult !== null), upNext: groupedTasks.planned },
    },
    reviewProposals: goal.reviewProposals.map(reviewProposalReadModel),
    taskGroups: groupedTasks,
    tasks,
    acceptedResults: acceptedTaskReadModels(tasks),
    assets: goalAssetReadModels(goal),
    activity: eventReadModels(goal),
  };
}

export async function getGoalOrThrow(goalId: string) {
  const goal = await db.goal.findUnique({ where: { id: goalId }, include: goalInclude });
  if (!goal) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal not found");
  return goal;
}
export async function getGoal(input: { goalId: string }) {
  return toGoalReadModel(await getGoalOrThrow(input.goalId));
}
