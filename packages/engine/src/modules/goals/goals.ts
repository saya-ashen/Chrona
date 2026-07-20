/* eslint-disable max-lines */
import { db, Prisma } from "@chrona/db";
import type {
  ApplyGoalReviewRequest,
  ConfirmGoalCriterionRequest,
  CreateGoalRequest,
  CreateGoalTaskRequest,
  GoalActionRequest,
  GoalOperationalBrief,
  GoalSuccessCriterion,
  GoalWorkingSetSelection,
  GoalWorkingSetSubjectType,
  ProcessGoalResultRequest,
  PromoteTaskToGoalRequest,
  UpdateGoalRequest,
} from "@chrona/contracts/api";
import { deriveGoalProjection } from "@chrona/domain";
import { createTask } from "../tasks/create-task";
import { extractAcceptedResultText } from "../tasks/accepted-result-context";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

type GoalEventType =
  | "goal.created"
  | "goal.updated"
  | "goal.brief_updated"
  | "goal.working_set_updated"
  | "goal.paused"
  | "goal.resumed"
  | "goal.result_processed"
  | "goal.criterion_confirmed"
  | "goal.review_applied"
  | "goal.stopped"
  | "goal.review_task_created"
  | "goal.task_created"
  | "goal.achieved";

const goalInclude = {
  tasks: {
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: {
      projection: true,
      events: {
        where: { eventType: "task.result_accepted" },
        orderBy: [{ ingestSequence: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
      runs: {
        where: { status: "Completed" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { artifacts: { orderBy: { createdAt: "desc" } } },
      },
      taskPlanRuns: {
        orderBy: { updatedAt: "desc" },
        select: { planId: true, workBlockId: true, planRun: true },
      },
    },
  },
  assets: {
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { sourceArtifact: true, currentArtifact: true },
  },
  workingSetItems: {
    orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
  },
  briefRevisions: {
    orderBy: { createdAt: "desc" },
    take: 20,
  },
} satisfies Prisma.GoalInclude;

type GoalWithDetails = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;
type GoalTask = GoalWithDetails["tasks"][number];
type GoalArtifact = GoalTask["runs"][number]["artifacts"][number];

type AchievementConfirmation = {
  note: string;
  actorType: string;
  actorId: string | null;
  confirmedAt: string;
  evidenceArtifactIds: string[];
};

function criteriaFrom(value: unknown): GoalSuccessCriterion[] {
  return Array.isArray(value) ? (value as GoalSuccessCriterion[]) : [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function achievementConfirmationFrom(value: unknown): AchievementConfirmation | null {
  const record = recordValue(value);
  if (!record || typeof record.note !== "string" || typeof record.confirmedAt !== "string") {
    return null;
  }
  return {
    note: record.note,
    actorType: typeof record.actorType === "string" ? record.actorType : "user",
    actorId: typeof record.actorId === "string" ? record.actorId : null,
    confirmedAt: record.confirmedAt,
    evidenceArtifactIds: Array.isArray(record.evidenceArtifactIds)
      ? record.evidenceArtifactIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function operationalBriefFrom(value: unknown): GoalOperationalBrief | null {
  const record = recordValue(value);
  if (
    !record
    || typeof record.outcome !== "string"
    || typeof record.currentFocus !== "string"
    || typeof record.strategy !== "string"
    || !Array.isArray(record.constraints)
  ) return null;
  return {
    outcome: record.outcome,
    currentFocus: record.currentFocus,
    strategy: record.strategy,
    constraints: record.constraints.filter((item): item is string => typeof item === "string"),
  };
}

function selectionKey(selection: GoalWorkingSetSelection) {
  return `${selection.subjectType}:${selection.subjectId}`;
}

function goalContextSnapshot(goal: GoalWithDetails, selections: GoalWorkingSetSelection[]) {
  const requested = new Set(selections.map(selectionKey));
  const selectedItems = goal.workingSetItems.filter((item) => requested.has(`${item.subjectType}:${item.subjectId}`));
  if (selectedItems.length !== requested.size) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Every selected context item must belong to the Goal working set",
    );
  }
  return {
    goal: {
      id: goal.id,
      title: goal.title,
      operationalBrief: operationalBriefFrom(goal.operationalBrief),
      capturedAt: new Date().toISOString(),
    },
    items: selectedItems.map((item) => ({
      subjectType: item.subjectType,
      subjectId: item.subjectId,
      label: item.label,
      snapshot: item.snapshot,
    })),
  } satisfies Prisma.InputJsonObject;
}

function acceptedRunId(task: GoalTask) {
  const payload = recordValue(task.events[0]?.payload);
  return typeof payload?.accepted_run_id === "string" ? payload.accepted_run_id : null;
}

function planOutputSpec(value: unknown) {
  const planRun = recordValue(value);
  const mutableGraph = recordValue(planRun?.mutableGraph);
  const planOutput = recordValue(mutableGraph?.planOutput);
  return planOutput?.spec ?? null;
}

function artifactReadModel(artifact: GoalArtifact) {
  const downloadable = artifact.uri.startsWith("generated://");
  return {
    id: artifact.id,
    taskId: artifact.taskId,
    title: artifact.title,
    type: artifact.type,
    uri: artifact.uri,
    contentPreview: artifact.contentPreview,
    createdAt: artifact.createdAt.toISOString(),
    operations: {
      canOpen: downloadable || Boolean(artifact.contentPreview),
      canCopy: Boolean(artifact.contentPreview) || downloadable,
      canDownload: downloadable,
      downloadHref: downloadable
        ? `/api/tasks/${encodeURIComponent(artifact.taskId)}/result-files/download?path=${encodeURIComponent(artifact.uri)}`
        : null,
    },
  };
}

function acceptedPlanOutput(task: GoalTask, run: GoalTask["runs"][number]) {
  const planId = typeof run.runtimeConfigSnapshot === "object" && run.runtimeConfigSnapshot !== null && !Array.isArray(run.runtimeConfigSnapshot)
    ? (run.runtimeConfigSnapshot as Record<string, unknown>).planId
    : null;
  const candidates = task.taskPlanRuns.filter((planRun) =>
    (typeof planId === "string" && planRun.planId === planId) ||
    planRun.workBlockId === run.workBlockId,
  );
  return planOutputSpec((candidates[0] ?? task.taskPlanRuns[0])?.planRun);
}

// Accepted results reconcile persisted event, run, plan-output, and Artifact records.
// eslint-disable-next-line complexity
function acceptedResultForTask(task: GoalTask) {
  const runId = acceptedRunId(task);
  if (!runId) return null;
  const run = task.runs.find((candidate) => candidate.id === runId);
  if (!run) return null;
  const extracted = extractAcceptedResultText(acceptedPlanOutput(task, run));
  const summary = extracted.startsWith("No structured result content")
    ? task.description ?? "The accepted result did not include a readable summary."
    : extracted;
  const acceptedAtPayload = recordValue(task.events[0]?.payload)?.accepted_at;
  const acceptedAt = typeof acceptedAtPayload === "string"
    ? acceptedAtPayload
    : task.events[0]?.occurredAt?.toISOString() ?? run.endedAt?.toISOString() ?? null;
  return {
    runId: run.id,
    acceptedAt,
    completedAt: run.endedAt?.toISOString() ?? null,
    summary,
    artifacts: run.artifacts.map(artifactReadModel),
  };
}

function taskGroup(task: GoalTask) {
  if (["WaitingForInput", "WaitingForApproval", "Blocked", "Failed"].includes(task.status)) return "attention" as const;
  if (["Queued", "Running"].includes(task.status)) return "active" as const;
  if (["Completed", "Done", "Cancelled"].includes(task.status)) return "completed" as const;
  return "planned" as const;
}

function taskReadModel(task: GoalTask) {
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
function choosePrimaryResult(goal: GoalWithDetails) {
  const evidenceIds = new Set(
    achievementConfirmationFrom(goal.achievementConfirmation)?.evidenceArtifactIds ?? [],
  );
  const finalAssets = goal.assets.filter((asset) =>
    evidenceIds.has(asset.currentArtifactId) ||
    recordValue(asset.currentArtifact.metadata)?.finalGoalResult === true,
  );
  const finalAsset = finalAssets.find((asset) => asset.currentArtifact.uri.startsWith("generated://"))
    ?? finalAssets[0]
    ?? goal.assets.find((asset) => asset.role === "evidence" || asset.role === "submission");
  if (finalAsset) return artifactReadModel(finalAsset.currentArtifact);
  return goal.tasks.flatMap((task) => acceptedResultForTask(task)?.artifacts ?? [])[0] ?? null;
}

function eventReadModels(goal: GoalWithDetails) {
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

function toGoalReadModel(goal: GoalWithDetails) {
  const successCriteria = criteriaFrom(goal.successCriteria);
  const projection = deriveGoalProjection({
    status: goal.status,
    nextReviewAt: goal.nextReviewAt,
    tasks: goal.tasks.map((task) => ({
      status: task.status,
      blockType: task.projection?.blockType ?? null,
    })),
    successCriteria,
  });
  const tasks = goal.tasks.map(taskReadModel);
  const groupedTasks = {
    attention: tasks.filter((task) => task.group === "attention"),
    active: tasks.filter((task) => task.group === "active"),
    planned: tasks.filter((task) => task.group === "planned"),
    completed: tasks.filter((task) => task.group === "completed"),
  };
  const achievementConfirmation = achievementConfirmationFrom(goal.achievementConfirmation);
  const primaryResult = choosePrimaryResult(goal);
  const criterionEvidence = new Map(
    successCriteria.map((criterion) => [criterion.id, criterion.evidenceArtifactIds ?? []]),
  );
  return {
    id: goal.id,
    workspaceId: goal.workspaceId,
    title: goal.title,
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
    primaryAction: {
      kind: projection.nextAction,
      taskId: groupedTasks.attention[0]?.id ?? null,
    },
    outcome: {
      primaryResult,
      confirmation: achievementConfirmation,
      criteria: successCriteria.map((criterion) => ({
        ...criterion,
        evidenceArtifactIds: criterionEvidence.get(criterion.id) ?? [],
      })),
    },
    workbench: {
      brief: operationalBriefFrom(goal.operationalBrief),
      briefRevisionCount: goal.briefRevisions.length,
      workingSet: goal.workingSetItems.map((item) => ({
        id: item.id,
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        label: item.label,
        snapshot: item.snapshot,
        rank: item.rank,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      focus: {
        needsYou: groupedTasks.attention,
        inProgress: groupedTasks.active,
        newResults: groupedTasks.completed.filter((task) => task.acceptedResult),
        upNext: groupedTasks.planned,
      },
    },
    taskGroups: groupedTasks,
    tasks,
    acceptedResults: tasks.flatMap((task) => task.acceptedResult ? [{ taskId: task.id, taskTitle: task.title, ...task.acceptedResult }] : []),
    assets: goal.assets.map((asset) => ({
      id: asset.id,
      label: asset.label,
      role: asset.role,
      status: asset.status,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      sourceArtifact: artifactReadModel(asset.sourceArtifact),
      currentArtifact: artifactReadModel(asset.currentArtifact),
      provenance: {
        sourceTaskId: asset.sourceArtifact.taskId,
        sourceRunId: asset.sourceArtifact.runId,
        sourceArtifactId: asset.sourceArtifactId,
        currentArtifactId: asset.currentArtifactId,
        unchanged: asset.sourceArtifactId === asset.currentArtifactId,
      },
    })),
    activity: eventReadModels(goal),
  };
}

async function getGoalOrThrow(goalId: string) {
  const goal = await db.goal.findUnique({ where: { id: goalId }, include: goalInclude });
  if (!goal) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal not found");
  return goal;
}

async function appendGoalEvent(input: {
  eventType: GoalEventType;
  goalId: string;
  workspaceId: string;
  taskId?: string | null;
  payload?: Prisma.InputJsonObject;
  summary: string;
  occurredAt?: Date;
}) {
  const latest = await db.event.aggregate({ _max: { ingestSequence: true } });
  return db.event.create({
    data: {
      eventType: input.eventType,
      workspaceId: input.workspaceId,
      taskId: input.taskId ?? null,
      actorType: "user",
      actorId: "server-action",
      source: "ui",
      payload: { goal_id: input.goalId, ...(input.payload ?? {}) },
      summary: input.summary,
      occurredAt: input.occurredAt ?? new Date(),
      ingestSequence: (latest._max.ingestSequence ?? 0) + 1,
    },
  });
}

export async function listGoals(input: { workspaceId: string }) {
  const goals = await db.goal.findMany({
    where: { workspaceId: input.workspaceId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: goalInclude,
  });
  return { goals: goals.map(toGoalReadModel) };
}

export async function getGoal(input: { goalId: string }) {
  return toGoalReadModel(await getGoalOrThrow(input.goalId));
}

export async function createGoal(input: CreateGoalRequest) {
  const goal = await db.goal.create({
    data: {
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description ?? null,
      successCriteria: input.successCriteria,
      status: "Active",
      nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
    },
    include: goalInclude,
  });
  await appendGoalEvent({
    eventType: "goal.created",
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    summary: `Created Goal: ${goal.title}`,
  });
  return toGoalReadModel(goal);
}

export async function updateGoal(input: { goalId: string; patch: UpdateGoalRequest }) {
  const goal = await getGoalOrThrow(input.goalId);
  const updated = await db.goal.update({
    where: { id: goal.id },
    data: {
      ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
      ...(input.patch.description !== undefined ? { description: input.patch.description } : {}),
      ...(input.patch.successCriteria !== undefined ? { successCriteria: input.patch.successCriteria } : {}),
      ...(input.patch.nextReviewAt !== undefined
        ? { nextReviewAt: input.patch.nextReviewAt ? new Date(input.patch.nextReviewAt) : null }
        : {}),
    },
    include: goalInclude,
  });
  await appendGoalEvent({
    eventType: "goal.updated",
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    summary: `Updated Goal: ${updated.title}`,
  });
  return toGoalReadModel(updated);
}

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
        ENGINE_ERROR_CODES.INVALID_TASK_STATE,
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

export async function updateGoalBrief(input: { goalId: string; brief: GoalOperationalBrief }) {
  const goal = await getGoalOrThrow(input.goalId);
  if (goal.status === "Achieved" || goal.status === "Stopped") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Archived Goals cannot change their operational brief");
  }
  await db.$transaction([
    db.goal.update({
      where: { id: goal.id },
      data: { operationalBrief: input.brief },
    }),
    db.goalBriefRevision.create({
      data: {
        workspaceId: goal.workspaceId,
        goalId: goal.id,
        brief: input.brief,
        actorType: "user",
        actorId: "server-action",
      },
    }),
  ]);
  await appendGoalEvent({
    eventType: "goal.brief_updated",
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    payload: { current_focus: input.brief.currentFocus },
    summary: `Updated Goal operational brief: ${input.brief.currentFocus}`,
  });
  return getGoal({ goalId: goal.id });
}

type WorkingSetCandidate = {
  subjectType: GoalWorkingSetSubjectType;
  subjectId: string;
  label: string;
  snapshot: Prisma.InputJsonObject;
};

function workingSetCandidates(goal: GoalWithDetails): WorkingSetCandidate[] {
  const taskCandidates = goal.tasks.map((task) => ({
    subjectType: "task" as const,
    subjectId: task.id,
    label: task.title,
    snapshot: {
      title: task.title,
      description: task.description,
      status: task.status,
      updatedAt: task.updatedAt.toISOString(),
    } satisfies Prisma.InputJsonObject,
  }));
  const assetCandidates = goal.assets.map((asset) => ({
    subjectType: "goal_asset" as const,
    subjectId: asset.id,
    label: asset.label,
    snapshot: {
      label: asset.label,
      role: asset.role,
      status: asset.status,
      artifactId: asset.currentArtifactId,
      contentPreview: asset.currentArtifact.contentPreview,
    } satisfies Prisma.InputJsonObject,
  }));
  const resultCandidates = goal.tasks.flatMap((task) => {
    const result = acceptedResultForTask(task);
    return result ? [{
      subjectType: "accepted_result" as const,
      subjectId: result.runId,
      label: task.title,
      snapshot: {
        taskId: task.id,
        taskTitle: task.title,
        runId: result.runId,
        acceptedAt: result.acceptedAt,
        summary: result.summary,
      } satisfies Prisma.InputJsonObject,
    }] : [];
  });
  const artifactCandidates = goal.tasks.flatMap((task) => task.runs.flatMap((run) => run.artifacts.map((artifact) => ({
    subjectType: "artifact" as const,
    subjectId: artifact.id,
    label: artifact.title,
    snapshot: {
      taskId: artifact.taskId,
      runId: artifact.runId,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
      contentPreview: artifact.contentPreview,
    } satisfies Prisma.InputJsonObject,
  }))));
  const criterionCandidates = criteriaFrom(goal.successCriteria).map((criterion) => ({
    subjectType: "criterion" as const,
    subjectId: criterion.id,
    label: criterion.description,
    snapshot: {
      description: criterion.description,
      satisfied: criterion.satisfied,
      confirmedAt: criterion.confirmedAt,
    } satisfies Prisma.InputJsonObject,
  }));
  return [...taskCandidates, ...assetCandidates, ...resultCandidates, ...artifactCandidates, ...criterionCandidates];
}

export async function updateGoalWorkingSet(input: { goalId: string; selections: GoalWorkingSetSelection[] }) {
  const goal = await getGoalOrThrow(input.goalId);
  if (goal.status === "Achieved" || goal.status === "Stopped") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Archived Goals cannot change their working set");
  }
  const candidatesByKey = new Map(workingSetCandidates(goal).map((candidate) => [
    `${candidate.subjectType}:${candidate.subjectId}`,
    candidate,
  ]));
  const selected = input.selections.map((selection) => candidatesByKey.get(selectionKey(selection)));
  if (selected.some((candidate) => !candidate)) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Every working-set item must belong to this Goal");
  }
  await db.$transaction(async (tx) => {
    await tx.goalWorkingSetItem.deleteMany({ where: { goalId: goal.id } });
    const entries = selected.filter((candidate): candidate is WorkingSetCandidate => Boolean(candidate));
    if (entries.length > 0) {
      await tx.goalWorkingSetItem.createMany({
        data: entries.map((candidate, rank) => ({
          workspaceId: goal.workspaceId,
          goalId: goal.id,
          subjectType: candidate.subjectType,
          subjectId: candidate.subjectId,
          label: candidate.label,
          snapshot: candidate.snapshot,
          rank,
        })),
      });
    }
  });
  await appendGoalEvent({
    eventType: "goal.working_set_updated",
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    payload: { item_count: input.selections.length },
    summary: `Updated Goal working set (${input.selections.length} items)`,
  });
  return getGoal({ goalId: goal.id });
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
  const assetByArtifact = new Map(goal.assets.map((asset) => [asset.sourceArtifactId, asset]));
  const nextRank = goal.workingSetItems.length;
  await db.$transaction(async (tx) => {
    for (const [index, artifact] of artifacts.entries()) {
      let asset = assetByArtifact.get(artifact.id);
      if (input.command.createGoalAssets && !asset) {
        asset = await tx.goalAsset.create({
          data: {
            workspaceId: goal.workspaceId,
            goalId: goal.id,
            sourceArtifactId: artifact.id,
            currentArtifactId: artifact.id,
            role: criterion ? "evidence" : "reference",
            status: "Approved",
            label: artifact.title,
          },
          include: { sourceArtifact: true, currentArtifact: true },
        });
      }
      if (input.command.addToWorkingSet) {
        const subjectType = asset ? "goal_asset" : "artifact";
        const subjectId = asset?.id ?? artifact.id;
        await tx.goalWorkingSetItem.upsert({
          where: { goalId_subjectType_subjectId: { goalId: goal.id, subjectType, subjectId } },
          create: {
            workspaceId: goal.workspaceId,
            goalId: goal.id,
            subjectType,
            subjectId,
            label: asset?.label ?? artifact.title,
            snapshot: asset
              ? { label: asset.label, role: asset.role, status: asset.status, artifactId: artifact.id, contentPreview: artifact.contentPreview }
              : { taskId: artifact.taskId, title: artifact.title, type: artifact.type, uri: artifact.uri, contentPreview: artifact.contentPreview },
            rank: nextRank + index,
          },
          update: {},
        });
      }
    }
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

export async function applyGoalReview(input: { goalId: string; command: ApplyGoalReviewRequest }) {
  const goal = await getGoalOrThrow(input.goalId);
  if (goal.status !== "Active") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can apply reviews");
  }
  const selections = goal.workingSetItems.map((item) => ({ subjectType: item.subjectType, subjectId: item.subjectId }));
  const context = goalContextSnapshot(goal, selections);
  const now = new Date();
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: goal.workspaceId }, select: { defaultRuntime: true } });
  const createdTaskIds: string[] = [];
  await db.$transaction(async (tx) => {
    await tx.goal.update({
      where: { id: goal.id },
      data: {
        ...(input.command.brief ? { operationalBrief: input.command.brief } : {}),
        ...(input.command.nextReviewAt !== undefined ? { nextReviewAt: input.command.nextReviewAt ? new Date(input.command.nextReviewAt) : null } : {}),
      },
    });
    if (input.command.brief) {
      await tx.goalBriefRevision.create({ data: { workspaceId: goal.workspaceId, goalId: goal.id, brief: input.command.brief, actorType: "user", actorId: "server-action" } });
    }
    for (const command of input.command.tasks) {
      const task = await tx.task.create({
        data: {
          workspaceId: goal.workspaceId,
          goalId: goal.id,
          title: command.title,
          description: command.description ?? null,
          priority: command.priority,
          kind: "single",
          status: "Ready",
          executionRuntime: workspace.defaultRuntime,
          executionConfig: {},
          autoPlanGeneration: command.autoPlanGeneration,
          autoExecute: false,
          goalContext: { ...context, expectedOutcome: command.expectedOutcome ?? null } as Prisma.InputJsonObject,
        },
      });
      createdTaskIds.push(task.id);
    }
    const latest = await tx.event.aggregate({ _max: { ingestSequence: true } });
    await tx.event.create({
      data: {
        eventType: "goal.review_applied",
        workspaceId: goal.workspaceId,
        actorType: "user",
        actorId: "server-action",
        source: "ui",
        payload: { goal_id: goal.id, task_ids: createdTaskIds, next_review_at: input.command.nextReviewAt ?? null, brief_updated: Boolean(input.command.brief) },
        summary: input.command.summary,
        occurredAt: now,
        ingestSequence: (latest._max.ingestSequence ?? 0) + 1,
      },
    });
  });
  return getGoal({ goalId: goal.id });
}


export async function createGoalTask(input: { goalId: string; command: CreateGoalTaskRequest }) {
  const goal = await getGoalOrThrow(input.goalId);
  if (goal.status !== "Active") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can create bounded tasks");
  }
  const contextSelections = input.command.contextSelections ?? goal.workingSetItems.map((item) => ({
    subjectType: item.subjectType,
    subjectId: item.subjectId,
  }));
  const contextSnapshot = goalContextSnapshot(goal, contextSelections);
  const created = await createTask({
    workspaceId: goal.workspaceId,
    goalId: goal.id,
    title: input.command.title,
    description: input.command.description ?? null,
    priority: input.command.priority,
    autoPlanGeneration: input.command.autoPlanGeneration,
    autoExecute: false,
    goalContext: {
      ...contextSnapshot,
      expectedOutcome: input.command.expectedOutcome ?? null,
    },
  });
  await appendGoalEvent({
    eventType: input.command.kind === "review" ? "goal.review_task_created" : "goal.task_created",
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    taskId: created.taskId,
    payload: {
      kind: input.command.kind,
      context_item_count: contextSelections.length,
      expected_outcome: input.command.expectedOutcome ?? null,
    },
    summary: input.command.kind === "review"
      ? `Created bounded Goal review: ${input.command.title}`
      : `Created bounded Goal task: ${input.command.title}`,
  });
  return { taskId: created.taskId, goal: await getGoal({ goalId: goal.id }) };
}

export async function getGoalArtifact(input: { goalId: string; artifactId: string }) {
  const goal = await getGoalOrThrow(input.goalId);
  const artifact = goal.tasks
    .flatMap((task) => task.runs.flatMap((run) => run.artifacts))
    .find((candidate) => candidate.id === input.artifactId)
    ?? goal.assets.flatMap((asset) => [asset.sourceArtifact, asset.currentArtifact])
      .find((candidate) => candidate.id === input.artifactId);
  if (!artifact) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal artifact not found");
  }
  return artifactReadModel(artifact);
}

export async function promoteTaskToGoal(input: { taskId: string; command: PromoteTaskToGoalRequest }) {
  const existingEvent = await db.event.findUnique({
    where: { dedupeKey: `task.promoted_to_goal:${input.command.idempotencyKey}` },
    select: { payload: true },
  });
  const existingGoalId = recordValue(existingEvent?.payload)?.goal_id;
  if (typeof existingGoalId === "string") return getGoal({ goalId: existingGoalId });

  const goalId = await db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: input.taskId, workspaceId: input.command.workspaceId },
      select: { id: true, workspaceId: true, goalId: true },
    });
    if (!task) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
    if (task.goalId) throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Task already belongs to a Goal");

    const acceptance = await tx.event.findFirst({
      where: { taskId: task.id, runId: input.command.acceptedRunId, eventType: "task.result_accepted" },
      select: { id: true },
    });
    if (!acceptance) throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "The selected result must be accepted before promotion");

    const artifacts = await tx.artifact.findMany({
      where: {
        id: { in: input.command.artifactIds },
        workspaceId: task.workspaceId,
        taskId: task.id,
        runId: input.command.acceptedRunId,
      },
    });
    if (artifacts.length !== new Set(input.command.artifactIds).size) {
      throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Every selected artifact must belong to the accepted result");
    }

    const created = await tx.goal.create({
      data: {
        workspaceId: task.workspaceId,
        title: input.command.title,
        description: input.command.description ?? null,
        successCriteria: input.command.successCriteria,
        status: "Active",
        tasks: { connect: { id: task.id } },
        assets: {
          create: artifacts.map((artifact) => ({
            workspaceId: task.workspaceId,
            sourceArtifactId: artifact.id,
            currentArtifactId: artifact.id,
            role: "reference",
            status: "Approved",
            label: artifact.title,
          })),
        },
      },
      select: { id: true },
    });

    await tx.event.create({
      data: {
        eventType: "task.promoted_to_goal",
        workspaceId: task.workspaceId,
        taskId: task.id,
        runId: input.command.acceptedRunId,
        actorType: "user",
        actorId: "server-action",
        source: "ui",
        payload: { goal_id: created.id, artifact_ids: artifacts.map((artifact) => artifact.id) },
        dedupeKey: `task.promoted_to_goal:${input.command.idempotencyKey}`,
        ingestSequence: 0,
      },
    });
    return created.id;
  });

  return getGoal({ goalId });
}
