import {
  ArtifactType,
  GoalAssetRole,
  GoalAssetStatus,
  GoalStatus,
  PrismaClient,
  RunStatus,
  TaskPriority,
  TaskStatus,
  WorkspaceStatus,
} from "../packages/db/src/generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";

const adapter = new PrismaBunSqlite({ url: process.env.DATABASE_URL || "file:./prisma/dev.db" });
const prisma = new PrismaClient({ adapter });

export const GOAL_ACCEPTANCE_IDS = {
  workspaceId: "ws_goal_acceptance",
  goalId: "goal_phd_offer_accepted",
  criteriaTaskId: "task_goal_confirm_criteria",
  discoveryTaskId: "task_goal_discover_openings",
  applicationTaskId: "task_goal_prepare_application",
  followUpTaskId: "task_goal_follow_up",
  finalArtifactId: "artifact_goal_final_outcome",
  processArtifactId: "artifact_goal_process_summary",
} as const;

async function upsertCompletedTask(input: {
  id: string;
  workspaceId: string;
  goalId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  kind?: "single" | "recurring";
}) {
  return prisma.task.upsert({
    where: { id: input.id },
    update: {
      workspaceId: input.workspaceId,
      goalId: input.goalId,
      title: input.title,
      description: input.description,
      status: TaskStatus.Completed,
      priority: input.priority,
      kind: input.kind ?? "single",
      completedAt: new Date("2026-07-18T08:30:00.000Z"),
    },
    create: {
      id: input.id,
      workspaceId: input.workspaceId,
      goalId: input.goalId,
      title: input.title,
      description: input.description,
      status: TaskStatus.Completed,
      priority: input.priority,
      kind: input.kind ?? "single",
      executionRuntime: "simulated-goal-acceptance",
      executionConfig: { simulated: true, purpose: "Goal acceptance evidence" },
      completedAt: new Date("2026-07-18T08:30:00.000Z"),
    },
  });
}

async function upsertCompletedRun(taskId: string, suffix: string, endedAt: Date) {
  return prisma.run.upsert({
    where: { id: `run_goal_${suffix}` },
    update: { taskId, status: RunStatus.Completed, endedAt },
    create: {
      id: `run_goal_${suffix}`,
      taskId,
      runtimeName: "simulated-goal-acceptance",
      runtimeConfigSnapshot: { simulated: true, noProviderInvoked: true },
      status: RunStatus.Completed,
      startedAt: new Date(endedAt.getTime() - 15 * 60_000),
      endedAt,
      triggeredBy: "acceptance-fixture",
      syncStatus: "healthy",
    },
  });
}

async function acceptResult(workspaceId: string, taskId: string, runId: string, sequence: number, acceptedAt: string) {
  await prisma.event.upsert({
    where: { dedupeKey: `goal-acceptance:${taskId}:${runId}` },
    update: { payload: { accepted_run_id: runId, accepted_at: acceptedAt } },
    create: {
      id: `event_goal_accept_${sequence}`,
      workspaceId,
      taskId,
      runId,
      eventType: "task.result_accepted",
      actorType: "user",
      actorId: "acceptance-fixture",
      source: "seed",
      payload: { accepted_run_id: runId, accepted_at: acceptedAt },
      summary: "Simulated accepted task result for Goal acceptance",
      dedupeKey: `goal-acceptance:${taskId}:${runId}`,
      occurredAt: new Date(acceptedAt),
      ingestSequence: sequence,
    },
  });
}

export async function seedCompletedGoalAcceptanceFixture() {
  const workspace = (await prisma.workspace.findFirst({
    where: { status: WorkspaceStatus.Active },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })) ?? await prisma.workspace.create({
    data: {
      id: GOAL_ACCEPTANCE_IDS.workspaceId,
      name: "Goal Acceptance Workspace",
      description: "Persistent simulated evidence for long-horizon Goal acceptance.",
      defaultRuntime: "simulated-goal-acceptance",
      status: WorkspaceStatus.Active,
    },
  });

  const criteria = [{
    id: "accepted-offer",
    kind: "user_confirmed",
    description: "A suitable funded PhD offer is received and explicitly accepted by the user",
    satisfied: true,
    confirmedAt: "2026-07-18T09:00:00.000Z",
  }];
  const goal = await prisma.goal.upsert({
    where: { id: GOAL_ACCEPTANCE_IDS.goalId },
    update: {
      workspaceId: workspace.id,
      title: "Obtain a suitable PhD offer in deep learning",
      description: "A simulated long-horizon Goal showing bounded discovery, application, approval, follow-up, and explicit user-confirmed achievement.",
      status: GoalStatus.Achieved,
      successCriteria: criteria,
      nextReviewAt: null,
      achievedAt: new Date("2026-07-18T09:00:00.000Z"),
    },
    create: {
      id: GOAL_ACCEPTANCE_IDS.goalId,
      workspaceId: workspace.id,
      title: "Obtain a suitable PhD offer in deep learning",
      description: "A simulated long-horizon Goal showing bounded discovery, application, approval, follow-up, and explicit user-confirmed achievement.",
      status: GoalStatus.Achieved,
      successCriteria: criteria,
      achievedAt: new Date("2026-07-18T09:00:00.000Z"),
    },
  });

  const tasks = await Promise.all([
    upsertCompletedTask({ id: GOAL_ACCEPTANCE_IDS.criteriaTaskId, workspaceId: workspace.id, goalId: goal.id, title: "Confirm research and location criteria", description: "Captured deep-learning research fit, funding requirement, and preferred locations.", priority: TaskPriority.High }),
    upsertCompletedTask({ id: GOAL_ACCEPTANCE_IDS.discoveryTaskId, workspaceId: workspace.id, goalId: goal.id, title: "Discover and evaluate suitable openings", description: "Simulated three weekly discovery occurrences; shortlisted NUS Deep Learning Lab.", priority: TaskPriority.High, kind: "recurring" }),
    upsertCompletedTask({ id: GOAL_ACCEPTANCE_IDS.applicationTaskId, workspaceId: workspace.id, goalId: goal.id, title: "Prepare and submit the NUS application", description: "Prepared tailored materials; simulated submission remained behind an approval boundary.", priority: TaskPriority.Urgent }),
    upsertCompletedTask({ id: GOAL_ACCEPTANCE_IDS.followUpTaskId, workspaceId: workspace.id, goalId: goal.id, title: "Review offer and confirm outcome", description: "Compared funding, supervision, and research fit; user explicitly confirmed acceptance.", priority: TaskPriority.Urgent }),
  ]);

  const runs = await Promise.all([
    upsertCompletedRun(tasks[0].id, "criteria", new Date("2026-06-10T09:30:00.000Z")),
    upsertCompletedRun(tasks[1].id, "discovery", new Date("2026-06-28T11:00:00.000Z")),
    upsertCompletedRun(tasks[2].id, "application", new Date("2026-07-05T15:00:00.000Z")),
    upsertCompletedRun(tasks[3].id, "offer", new Date("2026-07-18T08:30:00.000Z")),
  ]);

  await Promise.all(runs.map((run, index) => acceptResult(workspace.id, run.taskId, run.id, index + 1, run.endedAt!.toISOString())));

  const processArtifact = await prisma.artifact.upsert({
    where: { id: GOAL_ACCEPTANCE_IDS.processArtifactId },
    update: {
      workspaceId: workspace.id,
      taskId: tasks[2].id,
      runId: runs[2].id,
      contentPreview: "Simulated process: criteria confirmed → recurring discovery → opening selected → application prepared → approval granted → submission recorded → offer reviewed.",
    },
    create: {
      id: GOAL_ACCEPTANCE_IDS.processArtifactId,
      workspaceId: workspace.id,
      taskId: tasks[2].id,
      runId: runs[2].id,
      type: ArtifactType.summary,
      title: "Simulated application process",
      uri: "chrona://acceptance/goals/phd-offer/process",
      contentPreview: "Simulated process: criteria confirmed → recurring discovery → opening selected → application prepared → approval granted → submission recorded → offer reviewed.",
      metadata: { simulated: true, retainedForAcceptance: true },
    },
  });

  const finalArtifact = await prisma.artifact.upsert({
    where: { id: GOAL_ACCEPTANCE_IDS.finalArtifactId },
    update: {
      workspaceId: workspace.id,
      taskId: tasks[3].id,
      runId: runs[3].id,
      contentPreview: "Final outcome: a fully funded deep-learning PhD offer from NUS was received, reviewed against the recorded criteria, and explicitly accepted by the user on 18 July 2026.",
    },
    create: {
      id: GOAL_ACCEPTANCE_IDS.finalArtifactId,
      workspaceId: workspace.id,
      taskId: tasks[3].id,
      runId: runs[3].id,
      type: ArtifactType.summary,
      title: "Final Goal outcome",
      uri: "chrona://acceptance/goals/phd-offer/final-outcome",
      contentPreview: "Final outcome: a fully funded deep-learning PhD offer from NUS was received, reviewed against the recorded criteria, and explicitly accepted by the user on 18 July 2026.",
      metadata: { simulated: true, retainedForAcceptance: true, finalGoalResult: true },
    },
  });

  await Promise.all([
    prisma.goalAsset.upsert({
      where: { goalId_sourceArtifactId: { goalId: goal.id, sourceArtifactId: processArtifact.id } },
      update: { currentArtifactId: processArtifact.id, status: GoalAssetStatus.Approved },
      create: {
        workspaceId: workspace.id,
        goalId: goal.id,
        sourceArtifactId: processArtifact.id,
        currentArtifactId: processArtifact.id,
        role: GoalAssetRole.evidence,
        status: GoalAssetStatus.Approved,
        label: "Application process evidence",
      },
    }),
    prisma.goalAsset.upsert({
      where: { goalId_sourceArtifactId: { goalId: goal.id, sourceArtifactId: finalArtifact.id } },
      update: { currentArtifactId: finalArtifact.id, status: GoalAssetStatus.Approved },
      create: {
        workspaceId: workspace.id,
        goalId: goal.id,
        sourceArtifactId: finalArtifact.id,
        currentArtifactId: finalArtifact.id,
        role: GoalAssetRole.evidence,
        status: GoalAssetStatus.Approved,
        label: "Accepted PhD offer outcome",
      },
    }),
  ]);

  return { workspaceId: workspace.id, goalId: goal.id, taskIds: tasks.map((task) => task.id), finalArtifactId: finalArtifact.id };
}

if (import.meta.main) {
  seedCompletedGoalAcceptanceFixture()
    .then((result) => console.log(JSON.stringify(result)))
    .finally(() => prisma.$disconnect());
}
