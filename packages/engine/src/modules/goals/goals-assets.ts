import { db, Prisma } from "@chrona/db";
import type { PromoteTaskToGoalRequest } from "@chrona/contracts/api";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { extractAcceptedResultText } from "../tasks/accepted-result-context";
import {
  goalAcceptedResultRef,
  goalAssetRef,
  parseFrozenGoalTaskContext,
  type FrozenGoalAsset,
  type FrozenGoalTaskContext,
} from "./goal-task-context";
import { getGoal, getGoalOrThrow } from "./goals-read";
import {
  acceptedResultForTask,
  artifactReadModel,
  boundedText,
  GoalTask,
  recordValue,
} from "./goals-shared";
const GOAL_CONTEXT_SUMMARY_LIMIT = 400;
const GOAL_RESULT_SEARCH_SUMMARY_LIMIT = 2_000;
const GOAL_RESULT_ARTIFACT_LIMIT = 8;
const GOAL_RESULT_TITLE_LIMIT = 240;

function formalAssetContent(content: Prisma.JsonValue) {
  return typeof content === "string"
    ? content
    : recordValue(content)?.format === "chrona-json-render"
      ? extractAcceptedResultText(recordValue(content)?.spec)
      : JSON.stringify(content);
}

function frozenAssetReadModel(asset: FrozenGoalAsset) {
  return {
    ref: asset.ref,
    title: asset.title,
    description: asset.description,
    kind: asset.kind,
    role: asset.role,
    version: asset.version,
    updatedAt: asset.updatedAt,
  };
}

function frozenResultReadModel(result: ReturnType<typeof parseFrozenGoalTaskContext>["acceptedResults"][number]) {
  return {
    ref: result.ref,
    title: result.taskTitle,
    acceptedAt: result.acceptedAt,
    summary: result.summary,
    artifactCount: result.artifactCount,
  };
}
function frozenAssetMatchesQuery(asset: FrozenGoalAsset, query?: string) {
  if (!query) return true;
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [asset.title, asset.description, asset.kind, asset.role]
    .join("\n")
    .toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}



function goalResultReadModel(candidate: GoalTask, result: NonNullable<ReturnType<typeof acceptedResultForTask>>) {
  return {
    ref: goalAcceptedResultRef(result.runId),
    title: boundedText(candidate.title, GOAL_RESULT_TITLE_LIMIT),
    acceptedAt: result.acceptedAt,
    summary: boundedText(result.summary, GOAL_RESULT_SEARCH_SUMMARY_LIMIT),
    artifacts: result.artifacts.slice(0, GOAL_RESULT_ARTIFACT_LIMIT).map((artifact) => ({
      title: boundedText(artifact.title, GOAL_RESULT_TITLE_LIMIT),
      type: artifact.type,
      contentPreview: artifact.contentPreview ? boundedText(artifact.contentPreview, GOAL_CONTEXT_SUMMARY_LIMIT) : null,
    })),
  };
}

export type ReadGoalAcceptedResultsInput = {
  taskId: string;
  workspaceId: string;
  query?: string;
  ref?: string;
  offset?: number;
  maxChars?: number;
  limit: number;
  cursor?: string;
};

async function readGoalContextTask(input: ReadGoalAcceptedResultsInput) {
  const task = await db.task.findFirst({ where: { id: input.taskId, workspaceId: input.workspaceId }, select: { goalId: true, goalContext: true } });
  if (!task) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  if (!task.goalId) return { task, goal: null };
  const goal = await db.goal.findFirst({ where: { id: task.goalId, workspaceId: input.workspaceId }, select: { title: true } });
  if (!goal) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal not found");
  return { task, goal };
}

function goalResultResponse<T>(goal: { title: string }, input: ReadGoalAcceptedResultsInput, results: T[], nextCursor: string | null) {
  return { linked: true, goal: { title: goal.title }, query: input.query ?? null, results, nextCursor };
}

async function readFrozenAssetResult(task: { goalId: string }, goal: { title: string }, snapshot: FrozenGoalTaskContext, input: ReadGoalAcceptedResultsInput) {
  const asset = snapshot.assets.find((candidate) => candidate.ref === input.ref);
  if (!asset) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal asset ref was not found in the current Task snapshot");
  const candidates = await db.goalAsset.findMany({ where: { goalId: task.goalId, workspaceId: input.workspaceId }, select: { id: true, versions: { where: { version: asset.version }, take: 1, select: { content: true } } } });
  const version = candidates.find((candidate) => goalAssetRef(candidate.id) === asset.ref)?.versions[0];
  if (!version) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Captured Goal asset version was not found");
  const content = formalAssetContent(version.content);
  const offset = input.offset ?? 0;
  const maxChars = input.maxChars ?? 12_000;
  const nextOffset = offset + maxChars < content.length ? offset + maxChars : null;
  return goalResultResponse(goal, input, [{ ...frozenAssetReadModel(asset), content: content.slice(offset, offset + maxChars), nextOffset }], null);
}

async function readFrozenAcceptedResult(task: { goalId: string }, goal: { title: string }, snapshot: FrozenGoalTaskContext, input: ReadGoalAcceptedResultsInput) {
  const frozenResult = snapshot.acceptedResults.find((candidate) => candidate.ref === input.ref);
  if (!frozenResult) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal accepted-result ref was not found in the current Task snapshot");
  const liveGoal = await getGoalOrThrow(task.goalId);
  const match = liveGoal.tasks.flatMap((candidate) => {
    const result = acceptedResultForTask(candidate);
    return result && goalAcceptedResultRef(result.runId) === frozenResult.ref ? [{ candidate, result }] : [];
  }).at(0);
  if (!match) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Captured Goal accepted result was not found");
  return goalResultResponse(goal, input, [goalResultReadModel(match.candidate, match.result)], null);
}

function frozenGoalResults(goal: { title: string }, snapshot: FrozenGoalTaskContext, input: ReadGoalAcceptedResultsInput) {
  const assets = snapshot.assets.filter((asset) => frozenAssetMatchesQuery(asset, input.query)).map(frozenAssetReadModel);
  const terms = input.query?.toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const acceptedResults = snapshot.acceptedResults.filter((result) => terms.every((term) => `${result.taskTitle}\n${result.summary}`.toLocaleLowerCase().includes(term))).map(frozenResultReadModel);
  const combined = [...assets, ...acceptedResults];
  const offset = input.cursor ? combined.findIndex((result) => result.ref === input.cursor) + 1 : 0;
  if (input.cursor && offset === 0) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Goal result cursor is invalid or stale");
  const results = combined.slice(offset, offset + input.limit);
  return goalResultResponse(goal, input, results, offset + results.length < combined.length ? results.at(-1)?.ref ?? null : null);
}

export async function readGoalAcceptedResults(input: ReadGoalAcceptedResultsInput) {
  const { task, goal } = await readGoalContextTask(input);
  if (!goal || task.goalId === null) return { linked: false, message: "Current Task is not linked to a Goal.", results: [], nextCursor: null };
  const linkedTask = { ...task, goalId: task.goalId };
  const snapshot = parseFrozenGoalTaskContext(task.goalContext);
  if (input.ref?.startsWith("GA")) return readFrozenAssetResult(linkedTask, goal, snapshot, input);
  if (input.ref?.startsWith("GR")) return readFrozenAcceptedResult(linkedTask, goal, snapshot, input);
  return frozenGoalResults(goal, snapshot, input);
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
        titleSource: "system",
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
