import { db, Prisma } from "@chrona/db";
import type {
  CreateGoalRequest,
  CreateGoalTaskRequest,
  CreateGoalWithFirstTaskRequest,
  GoalOperationalBrief,
  UpdateGoalRequest,
} from "@chrona/contracts/api";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { createTask } from "../tasks/create-task";
import { rebuildTaskProjection } from "../projections/rebuild-task-projection";
import { buildAutomaticGoalTaskContext } from "./goal-task-context";
import { getGoal, getGoalOrThrow, toGoalReadModel, acceptedResultCatalog } from "./goals-read";
import { appendGoalEvent, goalInclude, recordValue } from "./goals-shared";

export async function listGoals(input: { workspaceId: string }) {
  const goals = await db.goal.findMany({
    where: { workspaceId: input.workspaceId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: goalInclude,
  });
  return { goals: goals.map(toGoalReadModel) };
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

// Direct Goal entry reuses canonical Task persistence inside one transaction so
// runtime validation, sessions, occurrences, and task.created audit remain
// identical to every other Task path without exposing a partially-created Goal.
export async function createGoalWithFirstTask(input: CreateGoalWithFirstTaskRequest) {
  const dedupeKey = `goal.created_with_first_task:${input.idempotencyKey}`;
  const existing = await db.event.findUnique({ where: { dedupeKey }, select: { payload: true } });
  const existingPayload = recordValue(existing?.payload);
  if (typeof existingPayload?.goal_id === "string" && typeof existingPayload.task_id === "string") {
    return { goal: await getGoal({ goalId: existingPayload.goal_id }), taskId: existingPayload.task_id };
  }
  const result = await db.$transaction(async (tx) => {
    const raced = await tx.event.findUnique({ where: { dedupeKey }, select: { payload: true } });
    const racedPayload = recordValue(raced?.payload);
    if (typeof racedPayload?.goal_id === "string" && typeof racedPayload.task_id === "string") return { goalId: racedPayload.goal_id, taskId: racedPayload.task_id };
    const goal = await tx.goal.create({
      data: {
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.additionalContext ?? null,
        operationalBrief: {
          outcome: input.title,
          currentFocus: input.firstTaskTitle,
          strategy: "",
          constraints: [],
        },
        successCriteria: [{
          id: "outcome-confirmed",
          kind: "user_confirmed",
          description: `Confirm: ${input.title}`,
          satisfied: false,
          confirmedAt: null,
          proposalStatus: "proposed",
        }],
        status: "Active",
      },
    });
    const taskResult = await createTask({
      workspaceId: input.workspaceId,
      goalId: goal.id,
      title: input.firstTaskTitle,
      description: null,
      priority: input.priority,
      autoPlanGeneration: false,
      autoExecute: false,
    }, tx);
    await tx.event.create({ data: { eventType: "goal.created_with_first_task", workspaceId: input.workspaceId, taskId: taskResult.taskId, actorType: "user", actorId: "server-action", source: "ui", payload: { goal_id: goal.id, task_id: taskResult.taskId }, summary: `Created Goal and first task: ${goal.title}`, dedupeKey, ingestSequence: 1 } });
    return { goalId: goal.id, taskId: taskResult.taskId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await rebuildTaskProjection(result.taskId);
  return { goal: await getGoal({ goalId: result.goalId }), taskId: result.taskId };
}

export async function updateGoal(input: { goalId: string; patch: UpdateGoalRequest }) {
  const goal = await getGoalOrThrow(input.goalId);
  const updated = await db.goal.update({
    where: { id: goal.id },
    data: {
      ...(input.patch.title !== undefined ? { title: input.patch.title, titleSource: "user", titleRenameNoticeSeenAt: new Date() } : {}),
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

export async function createGoalTask(input: { goalId: string; command: CreateGoalTaskRequest }) {
  const goal = await getGoalOrThrow(input.goalId);
  if (goal.status !== "Active") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can create bounded tasks");
  }
  const contextSnapshot = await buildAutomaticGoalTaskContext({ goalId: goal.id, workspaceId: goal.workspaceId });
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
      context_result_count: acceptedResultCatalog(goal).length,
      expected_outcome: input.command.expectedOutcome ?? null,
    },
    summary: input.command.kind === "review"
      ? `Created bounded Goal review: ${input.command.title}`
      : `Created bounded Goal task: ${input.command.title}`,
  });
  return { taskId: created.taskId, goal: await getGoal({ goalId: goal.id }) };
}
