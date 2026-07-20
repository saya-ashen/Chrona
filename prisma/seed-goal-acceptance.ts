/* eslint-disable max-lines */
import {
  ArtifactType,
  GoalAssetRole,
  GoalAssetStatus,
  GoalStatus,
  Prisma,
  PrismaClient,
  RunStatus,
  TaskPriority,
  TaskStatus,
  WorkspaceStatus,
} from "../packages/db/src/generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { getChronaGeneratedFilesDir } from "../packages/shared/src/data-paths";

const adapter = new PrismaBunSqlite({
  url: process.env.DATABASE_URL || "file:./prisma/dev.db",
});
const prisma = new PrismaClient({ adapter });

export const GOAL_ACCEPTANCE_IDS = {
  workspaceId: "ws_goal_acceptance",
  goalId: "goal_phd_offer_accepted",
  criteriaTaskId: "task_goal_confirm_criteria",
  discoveryTaskId: "task_goal_discover_openings",
  applicationTaskId: "task_goal_prepare_application",
  followUpTaskId: "task_goal_follow_up",
  criteriaArtifactId: "artifact_goal_research_criteria",
  comparisonArtifactId: "artifact_goal_opening_comparison",
  applicationArtifactId: "artifact_goal_application_package",
  receiptArtifactId: "artifact_goal_submission_receipt",
  offerArtifactId: "artifact_goal_offer_letter",
  finalArtifactId: "artifact_goal_final_outcome",
} as const;

type CompletedTaskInput = {
  id: string;
  workspaceId: string;
  goalId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  completedAt: Date;
  kind?: "single" | "recurring";
};

type ResultFixture = {
  taskId: string;
  workspaceId: string;
  runId: string;
  planId: string;
  title: string;
  summary: string;
  acceptedAt: Date;
  files?: Array<{ path: string; title: string }>;
};

type ArtifactFixture = {
  id: string;
  workspaceId: string;
  taskId: string;
  runId: string;
  title: string;
  type: ArtifactType;
  uri: string;
  contentPreview: string;
  metadata: Prisma.InputJsonObject;
};

async function upsertCompletedTask(input: CompletedTaskInput) {
  return prisma.task.upsert({
    where: { id: input.id },
    update: {
      workspaceId: input.workspaceId,
      goalId: input.goalId,
      title: input.title,
      description: input.description,
      status: TaskStatus.Done,
      priority: input.priority,
      kind: input.kind ?? "single",
      completedAt: input.completedAt,
    },
    create: {
      id: input.id,
      workspaceId: input.workspaceId,
      goalId: input.goalId,
      title: input.title,
      description: input.description,
      status: TaskStatus.Done,
      priority: input.priority,
      kind: input.kind ?? "single",
      executionRuntime: "simulated-goal-acceptance",
      executionConfig: {
        simulated: true,
        purpose: "Retained Goal product acceptance evidence",
      },
      completedAt: input.completedAt,
    },
  });
}

function resultSpec(title: string, summary: string, files: Array<{ path: string; title: string }> = []) {
  const fileIds = files.map((_, index) => `file-${index}`);
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: {}, children: ["summary", ...fileIds] },
      summary: {
        type: "ResultSummary",
        props: { title, summary, copyText: summary },
      },
      ...Object.fromEntries(files.map((file, index) => [fileIds[index], {
        type: "FileRef",
        props: { path: file.path, title: file.title },
      }])),
    },
  };
}

async function upsertAcceptedResult(input: ResultFixture) {
  const startedAt = new Date(input.acceptedAt.getTime() - 15 * 60_000);
  const run = await prisma.run.upsert({
    where: { id: input.runId },
    update: {
      taskId: input.taskId,
      status: RunStatus.Completed,
      startedAt,
      runtimeConfigSnapshot: { simulated: true, noProviderInvoked: true, planId: input.planId },
    },
    create: {
      id: input.runId,
      taskId: input.taskId,
      runtimeName: "simulated-goal-acceptance",
      runtimeConfigSnapshot: { simulated: true, noProviderInvoked: true, planId: input.planId },
      status: RunStatus.Completed,
      startedAt,
      endedAt: input.acceptedAt,
      triggeredBy: "acceptance-fixture",
      syncStatus: "healthy",
    },
  });
  await prisma.taskPlan.upsert({
    where: { planId: input.planId },
    update: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      summary: input.summary,
      compiledPlan: { nodes: [] },
    },
    create: {
      planId: input.planId,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      revision: 1,
      status: "Accepted",
      summary: input.summary,
      compiledPlan: { nodes: [] },
      generatedBy: "acceptance-fixture",
    },
  });
  const existingPlanRun = await prisma.taskPlanRun.findFirst({
    where: { taskId: input.taskId, planId: input.planId, workBlockId: null },
    select: { id: true },
  });
  const planRun = { mutableGraph: { planOutput: { spec: resultSpec(input.title, input.summary, input.files) } } };
  if (existingPlanRun) {
    await prisma.taskPlanRun.update({
      where: { id: existingPlanRun.id },
      data: { workspaceId: input.workspaceId, planRun },
    });
  } else {
    await prisma.taskPlanRun.create({
      data: {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        planId: input.planId,
        planRun,
      },
    });
  }
  await prisma.event.upsert({
    where: { dedupeKey: `goal-acceptance:${input.taskId}:${input.runId}` },
    update: {
      payload: {
        accepted_run_id: input.runId,
        accepted_at: input.acceptedAt.toISOString(),
      },
      summary: input.summary,
      occurredAt: input.acceptedAt,
    },
    create: {
      id: `event_accept_${input.runId}`,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      runId: input.runId,
      eventType: "task.result_accepted",
      actorType: "user",
      actorId: "acceptance-fixture",
      source: "seed",
      payload: {
        accepted_run_id: input.runId,
        accepted_at: input.acceptedAt.toISOString(),
      },
      summary: input.summary,
      dedupeKey: `goal-acceptance:${input.taskId}:${input.runId}`,
      occurredAt: input.acceptedAt,
      ingestSequence: input.acceptedAt.getTime(),
    },
  });
  return run;
}

async function upsertArtifact(input: ArtifactFixture) {
  return prisma.artifact.upsert({
    where: { id: input.id },
    update: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      runId: input.runId,
      title: input.title,
      type: input.type,
      uri: input.uri,
      contentPreview: input.contentPreview,
      metadata: input.metadata,
    },
    create: input,
  });
}

async function upsertGoalAsset(input: {
  workspaceId: string;
  goalId: string;
  artifactId: string;
  role: GoalAssetRole;
  label: string;
}) {
  return prisma.goalAsset.upsert({
    where: {
      goalId_sourceArtifactId: {
        goalId: input.goalId,
        sourceArtifactId: input.artifactId,
      },
    },
    update: {
      currentArtifactId: input.artifactId,
      role: input.role,
      status: GoalAssetStatus.Approved,
      label: input.label,
    },
    create: {
      workspaceId: input.workspaceId,
      goalId: input.goalId,
      sourceArtifactId: input.artifactId,
      currentArtifactId: input.artifactId,
      role: input.role,
      status: GoalAssetStatus.Approved,
      label: input.label,
    },
  });
}

// A single retained scenario keeps task/run/result/artifact timestamps and provenance coherent.
// eslint-disable-next-line max-lines-per-function
export async function seedCompletedGoalAcceptanceFixture() {
  const workspace = (await prisma.workspace.findFirst({
    where: { status: WorkspaceStatus.Active },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })) ?? await prisma.workspace.create({
    data: {
      id: GOAL_ACCEPTANCE_IDS.workspaceId,
      name: "Goal Acceptance Workspace",
      description: "Retained Goal acceptance evidence.",
      defaultRuntime: "simulated-goal-acceptance",
      status: WorkspaceStatus.Active,
    },
  });

  const criteria = [
    {
      id: "funding",
      kind: "user_confirmed",
      description: "Full tuition waiver and a monthly stipend of at least SGD 2,700",
      satisfied: true,
      confirmedAt: "2026-07-18T09:00:00.000Z",
    },
    {
      id: "research-fit",
      kind: "user_confirmed",
      description: "Confirmed supervision in trustworthy and efficient deep learning",
      satisfied: true,
      confirmedAt: "2026-07-18T09:00:00.000Z",
    },
    {
      id: "acceptance",
      kind: "user_confirmed",
      description: "A suitable offer is explicitly accepted before its deadline",
      satisfied: true,
      confirmedAt: "2026-07-18T09:00:00.000Z",
    },
  ];
  const goal = await prisma.goal.upsert({
    where: { id: GOAL_ACCEPTANCE_IDS.goalId },
    update: {
      workspaceId: workspace.id,
      title: "Obtain a suitable PhD offer in deep learning",
      description: "Secure and accept a fully funded PhD position with strong supervision fit in trustworthy and efficient deep learning.",
      status: GoalStatus.Achieved,
      successCriteria: criteria,
      nextReviewAt: null,
      achievedAt: new Date("2026-07-18T09:00:00.000Z"),
    },
    create: {
      id: GOAL_ACCEPTANCE_IDS.goalId,
      workspaceId: workspace.id,
      title: "Obtain a suitable PhD offer in deep learning",
      description: "Secure and accept a fully funded PhD position with strong supervision fit in trustworthy and efficient deep learning.",
      status: GoalStatus.Achieved,
      successCriteria: criteria,
      achievedAt: new Date("2026-07-18T09:00:00.000Z"),
    },
  });

  const taskFixtures: CompletedTaskInput[] = [
    {
      id: GOAL_ACCEPTANCE_IDS.criteriaTaskId,
      workspaceId: workspace.id,
      goalId: goal.id,
      title: "Confirm research and offer criteria",
      description: "Recorded research themes, supervision expectations, full-funding threshold, geography, and start-date constraints.",
      priority: TaskPriority.High,
      completedAt: new Date("2026-06-10T09:30:00.000Z"),
    },
    {
      id: GOAL_ACCEPTANCE_IDS.discoveryTaskId,
      workspaceId: workspace.id,
      goalId: goal.id,
      title: "Discover and compare suitable openings",
      description: "Completed three weekly discovery reviews and compared NUS, NTU, and HKUST opportunities against the recorded criteria.",
      priority: TaskPriority.High,
      completedAt: new Date("2026-06-28T11:00:00.000Z"),
      kind: "recurring",
    },
    {
      id: GOAL_ACCEPTANCE_IDS.applicationTaskId,
      workspaceId: workspace.id,
      goalId: goal.id,
      title: "Prepare and submit the NUS application",
      description: "Prepared the tailored research statement, CV, and cover email; the user approved the submission before it was sent.",
      priority: TaskPriority.Urgent,
      completedAt: new Date("2026-07-05T15:00:00.000Z"),
    },
    {
      id: GOAL_ACCEPTANCE_IDS.followUpTaskId,
      workspaceId: workspace.id,
      goalId: goal.id,
      title: "Review and accept the NUS offer",
      description: "Verified funding, supervision, start date, acceptance deadline, and explicitly recorded the user's acceptance decision.",
      priority: TaskPriority.Urgent,
      completedAt: new Date("2026-07-18T08:30:00.000Z"),
    },
  ];
  const tasks = await Promise.all(taskFixtures.map(upsertCompletedTask));

  const resultFixtures: ResultFixture[] = [
    {
      taskId: tasks[0].id,
      workspaceId: workspace.id,
      runId: "run_goal_criteria",
      planId: "plan_goal_criteria",
      title: "Research and offer criteria confirmed",
      summary: "Confirmed must-have criteria: full tuition waiver, stipend of at least SGD 2,700/month, trustworthy or efficient deep-learning supervision, and an August 2026 start.",
      acceptedAt: new Date("2026-06-10T09:30:00.000Z"),
    },
    {
      taskId: tasks[1].id,
      workspaceId: workspace.id,
      runId: "run_goal_discovery",
      planId: "plan_goal_discovery",
      title: "NUS opening selected after three reviews",
      summary: "Compared NUS, NTU, and HKUST across three weekly reviews. NUS ranked first for supervision fit, full funding, and the requested August 2026 start.",
      acceptedAt: new Date("2026-06-28T11:00:00.000Z"),
    },
    {
      taskId: tasks[2].id,
      workspaceId: workspace.id,
      runId: "run_goal_application",
      planId: "plan_goal_application",
      title: "NUS application submitted after approval",
      summary: "Application package included the tailored research statement, academic CV, transcript checklist, and referee plan. User approval was recorded before submission; receipt NUS-GS-2026-07154 was saved.",
      acceptedAt: new Date("2026-07-05T15:00:00.000Z"),
      files: [{ path: `generated://goal-acceptance/${goal.id}/application-package.md`, title: "NUS application package" }],
    },
    {
      taskId: tasks[3].id,
      workspaceId: workspace.id,
      runId: "run_goal_offer",
      planId: "plan_goal_offer",
      title: "Fully funded NUS offer accepted",
      summary: "Offer from NUS School of Computing for the Deep Learning Lab: full tuition waiver, SGD 3,200 monthly stipend, Professor Lin Wei as supervisor, start date 10 August 2026, accepted on 18 July before the 22 July deadline.",
      acceptedAt: new Date("2026-07-18T08:30:00.000Z"),
      files: [{ path: `generated://goal-acceptance/${goal.id}/offer-letter.md`, title: "NUS PhD offer letter" }],
    },
  ];
  const runs = await Promise.all(resultFixtures.map(upsertAcceptedResult));

  const generatedRoot = join(getChronaGeneratedFilesDir(), "goal-acceptance", goal.id);
  await mkdir(generatedRoot, { recursive: true });
  const applicationPackage = `# NUS Deep Learning PhD application package\n\n- Candidate: Maya Chen\n- Supervisor: Professor Lin Wei\n- Research focus: trustworthy and efficient deep learning\n- Funding required: full tuition waiver and stipend\n- Submission approval: granted 5 July 2026, 14:42 SGT\n- Submitted: 5 July 2026, 15:00 SGT\n- Receipt: NUS-GS-2026-07154\n`;
  const offerLetter = `# NUS School of Computing — PhD offer\n\n- Programme: PhD in Computer Science\n- Lab: Deep Learning Lab\n- Supervisor: Professor Lin Wei\n- Funding: full tuition waiver\n- Stipend: SGD 3,200 per month\n- Start date: 10 August 2026\n- Acceptance deadline: 22 July 2026\n- Decision: accepted by Maya Chen on 18 July 2026\n`;
  await Promise.all([
    Bun.write(join(generatedRoot, "application-package.md"), applicationPackage),
    Bun.write(join(generatedRoot, "offer-letter.md"), offerLetter),
  ]);

  const artifacts = await Promise.all([
    upsertArtifact({
      id: GOAL_ACCEPTANCE_IDS.criteriaArtifactId,
      workspaceId: workspace.id,
      taskId: tasks[0].id,
      runId: runs[0].id,
      type: ArtifactType.report,
      title: "Research and offer criteria",
      uri: "chrona://acceptance/goals/phd-offer/research-criteria",
      contentPreview: "Must have: full tuition waiver; stipend ≥ SGD 2,700/month; trustworthy or efficient deep-learning supervision; August 2026 start. Prefer: Singapore; established lab; publication mentoring.",
      metadata: { simulated: true, retainedForAcceptance: true },
    }),
    upsertArtifact({
      id: GOAL_ACCEPTANCE_IDS.comparisonArtifactId,
      workspaceId: workspace.id,
      taskId: tasks[1].id,
      runId: runs[1].id,
      type: ArtifactType.report,
      title: "Shortlisted PhD openings comparison",
      uri: "chrona://acceptance/goals/phd-offer/opening-comparison",
      contentPreview: "1. NUS Deep Learning Lab — 94/100: strongest supervision fit, full funding, Aug 2026 start. 2. NTU Trustworthy AI — 86/100: funding confirmed, weaker efficiency focus. 3. HKUST Vision Lab — 79/100: strong research fit, start date uncertain.",
      metadata: { simulated: true, retainedForAcceptance: true, discoveryReviewCount: 3 },
    }),
    upsertArtifact({
      id: GOAL_ACCEPTANCE_IDS.applicationArtifactId,
      workspaceId: workspace.id,
      taskId: tasks[2].id,
      runId: runs[2].id,
      type: ArtifactType.file,
      title: "NUS application package",
      uri: `generated://goal-acceptance/${goal.id}/application-package.md`,
      contentPreview: applicationPackage,
      metadata: { simulated: true, retainedForAcceptance: true, approvedAt: "2026-07-05T14:42:00.000Z" },
    }),
    upsertArtifact({
      id: GOAL_ACCEPTANCE_IDS.receiptArtifactId,
      workspaceId: workspace.id,
      taskId: tasks[2].id,
      runId: runs[2].id,
      type: ArtifactType.summary,
      title: "NUS application submission receipt",
      uri: "chrona://acceptance/goals/phd-offer/submission-receipt",
      contentPreview: "Receipt NUS-GS-2026-07154 — submitted 5 July 2026 at 15:00 SGT after user approval. Status: complete; referee requests sent; no missing documents.",
      metadata: { simulated: true, retainedForAcceptance: true, externalReference: "NUS-GS-2026-07154" },
    }),
    upsertArtifact({
      id: GOAL_ACCEPTANCE_IDS.offerArtifactId,
      workspaceId: workspace.id,
      taskId: tasks[3].id,
      runId: runs[3].id,
      type: ArtifactType.file,
      title: "NUS PhD offer letter",
      uri: `generated://goal-acceptance/${goal.id}/offer-letter.md`,
      contentPreview: offerLetter,
      metadata: { simulated: true, retainedForAcceptance: true, finalGoalResult: true },
    }),
    upsertArtifact({
      id: GOAL_ACCEPTANCE_IDS.finalArtifactId,
      workspaceId: workspace.id,
      taskId: tasks[3].id,
      runId: runs[3].id,
      type: ArtifactType.summary,
      title: "Offer acceptance confirmation",
      uri: "chrona://acceptance/goals/phd-offer/acceptance-confirmation",
      contentPreview: "Accepted NUS School of Computing's fully funded PhD offer on 18 July 2026. Supervisor: Professor Lin Wei. Funding: full tuition waiver plus SGD 3,200/month. Start: 10 August 2026. Acceptance was recorded before the 22 July deadline.",
      metadata: { simulated: true, retainedForAcceptance: true, finalGoalResult: true },
    }),
  ]);

  await Promise.all([
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[0].id, role: GoalAssetRole.reference, label: "Confirmed selection criteria" }),
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[1].id, role: GoalAssetRole.reference, label: "Opening comparison" }),
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[2].id, role: GoalAssetRole.submission, label: "Approved application package" }),
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[3].id, role: GoalAssetRole.evidence, label: "Submission receipt" }),
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[4].id, role: GoalAssetRole.evidence, label: "Offer letter" }),
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[5].id, role: GoalAssetRole.evidence, label: "Acceptance confirmation" }),
  ]);

  const achievementConfirmation = {
    note: "I reviewed the supervision, funding, start date, and deadline, and confirm that I accepted the NUS offer.",
    actorType: "user",
    actorId: "acceptance-fixture-user",
    confirmedAt: "2026-07-18T09:00:00.000Z",
    evidenceArtifactIds: [artifacts[4].id, artifacts[5].id],
  };
  await prisma.goal.update({
    where: { id: goal.id },
    data: { achievementConfirmation },
  });
  await prisma.event.upsert({
    where: { dedupeKey: `goal-acceptance:${goal.id}:achieved` },
    update: {
      payload: {
        goal_id: goal.id,
        confirmation: achievementConfirmation.note,
        evidence_artifact_ids: achievementConfirmation.evidenceArtifactIds,
      },
      summary: achievementConfirmation.note,
      occurredAt: new Date(achievementConfirmation.confirmedAt),
    },
    create: {
      workspaceId: workspace.id,
      eventType: "goal.achieved",
      actorType: "user",
      actorId: achievementConfirmation.actorId,
      source: "seed",
      payload: {
        goal_id: goal.id,
        confirmation: achievementConfirmation.note,
        evidence_artifact_ids: achievementConfirmation.evidenceArtifactIds,
      },
      summary: achievementConfirmation.note,
      dedupeKey: `goal-acceptance:${goal.id}:achieved`,
      occurredAt: new Date(achievementConfirmation.confirmedAt),
      ingestSequence: new Date(achievementConfirmation.confirmedAt).getTime(),
    },
  });

  return {
    workspaceId: workspace.id,
    goalId: goal.id,
    taskIds: tasks.map((task) => task.id),
    artifactIds: artifacts.map((artifact) => artifact.id),
    primaryResultArtifactId: artifacts[4].id,
  };
}

if (import.meta.main) {
  seedCompletedGoalAcceptanceFixture()
    .then((result) => console.log(JSON.stringify(result)))
    .finally(() => prisma.$disconnect());
}
