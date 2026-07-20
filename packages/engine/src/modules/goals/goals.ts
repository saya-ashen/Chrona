import { db, Prisma } from "@chrona/db";
import type {
  CreateGoalRequest,
  GoalActionRequest,
  GoalSuccessCriterion,
  PromoteTaskToGoalRequest,
  UpdateGoalRequest,
} from "@chrona/contracts/api";
import { deriveGoalProjection } from "@chrona/domain";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

const goalInclude = {
  tasks: {
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: {
      projection: true,
      runs: {
        where: { status: "Completed" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        include: { artifacts: { orderBy: { createdAt: "desc" } } },
      },
    },
  },
  assets: {
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { sourceArtifact: true, currentArtifact: true },
  },
} satisfies Prisma.GoalInclude;

type GoalWithDetails = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;

function criteriaFrom(value: unknown): GoalSuccessCriterion[] {
  return Array.isArray(value) ? (value as GoalSuccessCriterion[]) : [];
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

  return {
    id: goal.id,
    workspaceId: goal.workspaceId,
    title: goal.title,
    description: goal.description,
    successCriteria,
    status: goal.status,
    nextReviewAt: goal.nextReviewAt?.toISOString() ?? null,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    achievedAt: goal.achievedAt?.toISOString() ?? null,
    stoppedAt: goal.stoppedAt?.toISOString() ?? null,
    projection,
    tasks: goal.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      kind: task.kind,
      dueAt: task.dueAt?.toISOString() ?? null,
      updatedAt: task.updatedAt.toISOString(),
      attention: task.projection?.displayState ?? null,
      latestAcceptedResult: task.runs[0]
        ? {
            runId: task.runs[0].id,
            completedAt: task.runs[0].endedAt?.toISOString() ?? null,
            artifacts: task.runs[0].artifacts.map((artifact) => ({
              id: artifact.id,
              title: artifact.title,
              type: artifact.type,
              uri: artifact.uri,
              contentPreview: artifact.contentPreview,
              createdAt: artifact.createdAt.toISOString(),
            })),
          }
        : null,
    })),
    assets: goal.assets.map((asset) => ({
      id: asset.id,
      label: asset.label,
      role: asset.role,
      status: asset.status,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      sourceArtifact: {
        id: asset.sourceArtifact.id,
        title: asset.sourceArtifact.title,
        type: asset.sourceArtifact.type,
        uri: asset.sourceArtifact.uri,
        contentPreview: asset.sourceArtifact.contentPreview,
        createdAt: asset.sourceArtifact.createdAt.toISOString(),
      },
      currentArtifact: {
        id: asset.currentArtifact.id,
        title: asset.currentArtifact.title,
        type: asset.currentArtifact.type,
        uri: asset.currentArtifact.uri,
        contentPreview: asset.currentArtifact.contentPreview,
        createdAt: asset.currentArtifact.createdAt.toISOString(),
      },
    })),
  };
}

async function getGoalOrThrow(goalId: string) {
  const goal = await db.goal.findUnique({ where: { id: goalId }, include: goalInclude });
  if (!goal) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal not found");
  return goal;
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
  return toGoalReadModel(goal);
}

export async function updateGoal(input: { goalId: string; patch: UpdateGoalRequest }) {
  const goal = await getGoalOrThrow(input.goalId);
  const updated = await db.goal.update({
    where: { id: goal.id },
    data: {
      ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
      ...(input.patch.description !== undefined ? { description: input.patch.description } : {}),
      ...(input.patch.successCriteria !== undefined
        ? { successCriteria: input.patch.successCriteria }
        : {}),
      ...(input.patch.nextReviewAt !== undefined
        ? { nextReviewAt: input.patch.nextReviewAt ? new Date(input.patch.nextReviewAt) : null }
        : {}),
    },
    include: goalInclude,
  });
  return toGoalReadModel(updated);
}

export async function actOnGoal(input: { goalId: string; command: GoalActionRequest }) {
  const goal = await getGoalOrThrow(input.goalId);
  const now = new Date();
  const data = (() => {
    switch (input.command.action) {
      case "pause":
        if (goal.status !== "Active") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can be paused");
        return { status: "Paused" as const };
      case "resume":
        if (goal.status !== "Paused") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only paused Goals can be resumed");
        return { status: "Active" as const };
      case "stop":
        if (goal.status === "Achieved") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "An achieved Goal cannot be stopped");
        return { status: "Stopped" as const, stoppedAt: now };
      case "review":
        if (goal.status !== "Active") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can be reviewed");
        return { nextReviewAt: null };
      case "achieve": {
        if (goal.status !== "Active") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can be achieved");
        const criteria = criteriaFrom(goal.successCriteria).map((criterion) => ({
          ...criterion,
          satisfied: true,
          confirmedAt: now.toISOString(),
        }));
        return { status: "Achieved" as const, achievedAt: now, successCriteria: criteria };
      }
    }
  })();

  return toGoalReadModel(await db.goal.update({ where: { id: goal.id }, data, include: goalInclude }));
}

export async function promoteTaskToGoal(input: { taskId: string; command: PromoteTaskToGoalRequest }) {
  const existingEvent = await db.event.findUnique({
    where: { dedupeKey: `task.promoted_to_goal:${input.command.idempotencyKey}` },
    select: { payload: true },
  });
  const existingGoalId = (existingEvent?.payload as { goal_id?: unknown } | null)?.goal_id;
  if (typeof existingGoalId === "string") return getGoal({ goalId: existingGoalId });

  const goalId = await db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: input.taskId, workspaceId: input.command.workspaceId },
      select: { id: true, workspaceId: true, goalId: true },
    });
    if (!task) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
    if (task.goalId) throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Task already belongs to a Goal");

    const acceptance = await tx.event.findFirst({
      where: {
        taskId: task.id,
        runId: input.command.acceptedRunId,
        eventType: "task.result_accepted",
      },
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
