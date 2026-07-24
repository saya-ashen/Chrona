import { createHash } from "node:crypto";
import { db, Prisma } from "@chrona/db";
import { extractAcceptedResultText } from "../tasks/accepted-result-context";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

const GOAL_CONTEXT_RESULT_LIMIT = 8;
const GOAL_CONTEXT_SUMMARY_LIMIT = 400;

type GoalContextClient = Prisma.TransactionClient | typeof db;

type GoalContextExtra = Prisma.InputJsonObject | undefined;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit).trimEnd()}…`;
}

export function goalAcceptedResultRef(runId: string) {
  return `GR${createHash("sha256").update(runId).digest("hex").slice(0, 12).toUpperCase()}`;
}

function planOutputSpec(value: unknown) {
  const planRun = record(value);
  const mutableGraph = record(planRun?.mutableGraph);
  const planOutput = record(mutableGraph?.planOutput);
  return planOutput?.spec ?? null;
}

function acceptedResultCatalog(goal: Awaited<ReturnType<typeof loadGoalContext>>) {
  if (!goal) return [];
  return goal.tasks
    .flatMap((task) => {
      const payload = record(task.events[0]?.payload);
      const runId = typeof payload?.accepted_run_id === "string" ? payload.accepted_run_id : null;
      if (!runId) return [];
      const run = task.runs.find((candidate) => candidate.id === runId);
      if (!run) return [];
      const runtimeConfig = record(run.runtimeConfigSnapshot);
      const planId = typeof runtimeConfig?.planId === "string" ? runtimeConfig.planId : null;
      const planRun = task.taskPlanRuns.find((candidate) =>
        (planId && candidate.planId === planId) || candidate.workBlockId === run.workBlockId,
      ) ?? task.taskPlanRuns[0];
      const extracted = extractAcceptedResultText(planRun ? planOutputSpec(planRun.planRun) : null);
      const summary = extracted.startsWith("No structured result content")
        ? task.description ?? "The accepted result did not include a readable summary."
        : extracted;
      const acceptedAtValue = payload?.accepted_at;
      const acceptedAt = typeof acceptedAtValue === "string"
        ? acceptedAtValue
        : task.events[0]?.occurredAt?.toISOString() ?? run.endedAt?.toISOString() ?? null;
      return [{
        ref: goalAcceptedResultRef(run.id),
        taskTitle: task.title,
        acceptedAt,
        summary: boundedText(summary, GOAL_CONTEXT_SUMMARY_LIMIT),
        artifactCount: run.artifacts.length,
      }];
    })
    .sort((left, right) => (right.acceptedAt ?? "").localeCompare(left.acceptedAt ?? ""))
    .slice(0, GOAL_CONTEXT_RESULT_LIMIT);
}

function loadGoalContext(goalId: string, client: GoalContextClient) {
  return client.goal.findUnique({
    where: { id: goalId },
    select: {
      workspaceId: true,
      title: true,
      operationalBrief: true,
      tasks: {
        orderBy: [{ updatedAt: "desc" as const }, { id: "asc" as const }],
        select: {
          title: true,
          description: true,
          events: {
            where: { eventType: "task.result_accepted" },
            orderBy: [{ ingestSequence: "desc" as const }, { createdAt: "desc" as const }],
            take: 1,
            select: { payload: true, occurredAt: true },
          },
          runs: {
            where: { status: "Completed" },
            orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
            select: {
              id: true,
              endedAt: true,
              runtimeConfigSnapshot: true,
              workBlockId: true,
              artifacts: { select: { id: true } },
            },
          },
          taskPlanRuns: {
            orderBy: { updatedAt: "desc" },
            select: { planId: true, workBlockId: true, planRun: true },
          },
        },
      },
    },
  });
}

export async function buildAutomaticGoalTaskContext(
  input: { goalId: string; workspaceId: string; additionalContext?: GoalContextExtra },
  client: GoalContextClient = db,
): Promise<Prisma.InputJsonObject> {
  const goal = await loadGoalContext(input.goalId, client);
  if (!goal || goal.workspaceId !== input.workspaceId) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal not found");
  }
  return JSON.parse(JSON.stringify({
    ...(input.additionalContext ?? {}),
    goal: {
      title: goal.title,
      operationalBrief: goal.operationalBrief,
      capturedAt: new Date().toISOString(),
    },
    acceptedResults: acceptedResultCatalog(goal),
  })) as Prisma.InputJsonObject;
}
