import { db, Prisma } from "@chrona/db";
import type { GoalOperationalBrief, GoalSuccessCriterion } from "@chrona/contracts/api";
import { extractAcceptedResultText } from "../tasks/accepted-result-context";

type GoalEventType =
  | "goal.created"
  | "goal.updated"
  | "goal.brief_updated"
  | "goal.paused"
  | "goal.resumed"
  | "goal.result_processed"
  | "goal.criterion_confirmed"
  | "goal.review_applied"
  | "goal.review_generation_started"
  | "goal.review_proposal_ready"
  | "goal.review_proposal_failed"
  | "goal.review_proposal_applied"
  | "goal.review_proposal_rejected"
  | "goal.stopped"
  | "goal.review_task_created"
  | "goal.task_created"
  | "goal.achieved";

export const goalInclude = {
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
    include: {
      sourceArtifact: true,
      currentArtifact: true,
      versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, content: true } },
    },
  },
  briefRevisions: {
    orderBy: { createdAt: "desc" },
    take: 20,
  },
  inboxCandidates: {
    where: { status: "Pending" },
    select: { id: true },
  },
  reviewProposals: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 10,
    include: {
      items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      sourceTask: {
        select: {
          id: true,
          title: true,
          status: true,
          latestRunId: true,
          runs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, status: true, errorSummary: true } },
        },
      },
    },
  },
} satisfies Prisma.GoalInclude;

export type GoalWithDetails = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;
export type GoalTask = GoalWithDetails["tasks"][number];
export type GoalArtifact = GoalTask["runs"][number]["artifacts"][number];

export type AchievementConfirmation = {
  note: string;
  actorType: string;
  actorId: string | null;
  confirmedAt: string;
  evidenceArtifactIds: string[];
};

export function criteriaFrom(value: unknown): GoalSuccessCriterion[] {
  return Array.isArray(value) ? (value as GoalSuccessCriterion[]) : [];
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function achievementConfirmationFrom(value: unknown): AchievementConfirmation | null {
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

export function operationalBriefFrom(value: unknown): GoalOperationalBrief | null {
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

export const GOAL_CONTEXT_RESULT_LIMIT = 8;
export const GOAL_CONTEXT_SUMMARY_LIMIT = 400;

export function boundedText(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit).trimEnd()}…`;
}

export function acceptedRunId(task: GoalTask) {
  const payload = recordValue(task.events[0]?.payload);
  return typeof payload?.accepted_run_id === "string" ? payload.accepted_run_id : null;
}

export function planOutputSpec(value: unknown) {
  const planRun = recordValue(value);
  const mutableGraph = recordValue(planRun?.mutableGraph);
  const planOutput = recordValue(mutableGraph?.planOutput);
  return recordValue(planOutput?.finalizedResult)?.spec ?? null;
}

export function artifactReadModel(artifact: GoalArtifact) {
  const downloadable = artifact.uri.startsWith("generated://");
  return {
    id: artifact.id,
    taskId: artifact.taskId,
    runId: artifact.runId,
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

export function runPlanId(run: GoalTask["runs"][number]) {
  const snapshot = recordValue(run.runtimeConfigSnapshot);
  return typeof snapshot?.planId === "string" ? snapshot.planId : null;
}

export function acceptedPlanRun(task: GoalTask, run: GoalTask["runs"][number]) {
  const planId = runPlanId(run);
  return task.taskPlanRuns.find((planRun) =>
    planRun.workBlockId === run.workBlockId || (planId !== null && planRun.planId === planId),
  ) ?? task.taskPlanRuns[0];
}

export function acceptedPlanOutput(task: GoalTask, run: GoalTask["runs"][number]) {
  const planRun = acceptedPlanRun(task, run);
  return planRun ? planOutputSpec(planRun.planRun) : null;
}

export function acceptedResultSummary(task: GoalTask, run: GoalTask["runs"][number]) {
  const extracted = extractAcceptedResultText(acceptedPlanOutput(task, run));
  return extracted.startsWith("No structured result content")
    ? task.description ?? "The accepted result did not include a readable summary."
    : extracted;
}

export function acceptedResultTimestamp(task: GoalTask, run: GoalTask["runs"][number]) {
  const payload = recordValue(task.events[0]?.payload);
  return typeof payload?.accepted_at === "string"
    ? payload.accepted_at
    : task.events[0]?.occurredAt?.toISOString() ?? run.endedAt?.toISOString() ?? null;
}

// Accepted results reconcile persisted event, run, plan-output, and Artifact records.
export function acceptedResultForTask(task: GoalTask) {
  const runId = acceptedRunId(task);
  const run = runId === null ? undefined : task.runs.find((candidate) => candidate.id === runId);
  if (!run) return null;
  return {
    runId: run.id,
    acceptedAt: acceptedResultTimestamp(task, run),
    completedAt: run.endedAt?.toISOString() ?? null,
    summary: acceptedResultSummary(task, run),
    artifacts: run.artifacts.map(artifactReadModel),
  };
}

export async function appendGoalEvent(input: {
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
