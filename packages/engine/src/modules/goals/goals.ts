/* eslint-disable max-lines */
import { db, Prisma } from "@chrona/db";
import type {
  CreateGoalRequest,
  CreateGoalTaskRequest,
  GoalActionRequest,
  GoalSuccessCriterion,
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
  | "goal.paused"
  | "goal.resumed"
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
        take: 1,
        select: { planRun: true },
      },
    },
  },
  assets: {
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { sourceArtifact: true, currentArtifact: true },
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

// Accepted results reconcile persisted event, run, plan-output, and Artifact records.
// eslint-disable-next-line complexity
function acceptedResultForTask(task: GoalTask) {
  const runId = acceptedRunId(task);
  if (!runId) return null;
  const run = task.runs.find((candidate) => candidate.id === runId);
  if (!run) return null;
  const extracted = extractAcceptedResultText(planOutputSpec(task.taskPlanRuns[0]?.planRun));
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
        evidenceArtifactIds: achievementConfirmation?.evidenceArtifactIds ?? [],
      })),
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
    const evidenceIds = [...new Set(input.command.evidenceArtifactIds)];
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
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "Every achievement evidence artifact must belong to this Goal",
      );
    }
    const confirmation: AchievementConfirmation = {
      note: input.command.confirmation,
      actorType: "user",
      actorId: "server-action",
      confirmedAt: now.toISOString(),
      evidenceArtifactIds: evidenceIds,
    };
    const criteria = criteriaFrom(goal.successCriteria).map((criterion) => ({
      ...criterion,
      satisfied: true,
      confirmedAt: now.toISOString(),
    }));
    await db.$transaction(async (tx) => {
      await tx.goal.update({
        where: { id: goal.id },
        data: {
          status: "Achieved",
          achievedAt: now,
          successCriteria: criteria,
          achievementConfirmation: confirmation,
        },
      });
      const latest = await tx.event.aggregate({ _max: { ingestSequence: true } });
      await tx.event.create({
        data: {
          eventType: "goal.achieved",
          workspaceId: goal.workspaceId,
          actorType: "user",
          actorId: "server-action",
          source: "ui",
          payload: {
            goal_id: goal.id,
            confirmation: confirmation.note,
            evidence_artifact_ids: evidenceIds,
          },
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

export async function createGoalTask(input: { goalId: string; command: CreateGoalTaskRequest }) {
  const goal = await getGoalOrThrow(input.goalId);
  if (goal.status !== "Active") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can create bounded tasks");
  }
  const created = await createTask({
    workspaceId: goal.workspaceId,
    goalId: goal.id,
    title: input.command.title,
    description: input.command.description ?? null,
    priority: input.command.priority,
    autoPlanGeneration: input.command.autoPlanGeneration,
    autoExecute: false,
  });
  await appendGoalEvent({
    eventType: input.command.kind === "review" ? "goal.review_task_created" : "goal.task_created",
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    taskId: created.taskId,
    payload: { kind: input.command.kind },
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
