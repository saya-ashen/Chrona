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
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { getChronaGeneratedFilesDir } from "../packages/shared/src/data-paths";

const adapter = new PrismaBunSqlite({
  url: process.env.DATABASE_URL || "file:./prisma/dev.db",
});
const prisma = new PrismaClient({ adapter });

function contentHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

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

export const GOAL_WORKBENCH_ACCEPTANCE_IDS = {
  goalId: "goal_phd_application_active",
  criteriaTaskId: "task_goal_active_criteria",
  discoveryTaskId: "task_goal_active_discovery",
  approvalTaskId: "task_goal_active_approval",
  draftTaskId: "task_goal_active_draft",
  criteriaArtifactId: "artifact_goal_active_criteria",
  comparisonArtifactId: "artifact_goal_active_comparison",
  criteriaRunId: "run_goal_active_criteria",
  discoveryRunId: "run_goal_active_discovery",
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
  kind?: "document" | "form" | "page" | "file";
}) {
  const asset = await prisma.goalAsset.upsert({
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
      kind: input.kind ?? "file",
    },
    create: {
      workspaceId: input.workspaceId,
      goalId: input.goalId,
      sourceArtifactId: input.artifactId,
      currentArtifactId: input.artifactId,
      role: input.role,
      status: GoalAssetStatus.Approved,
      label: input.label,
      kind: input.kind ?? "file",
    },
  });
  if (input.kind === "form") {
    const content = {
      fields: [
        { id: "researchThemes", label: "Research themes", type: "textarea", required: true, description: "Describe the confirmed deep-learning themes." },
        { id: "minimumStipend", label: "Minimum monthly stipend", type: "text", required: true },
        { id: "requiresFullFunding", label: "Require full funding", type: "checkbox", required: true },
      ],
    };
    const desiredHash = contentHash(content);
    const existingVersion = await prisma.goalAssetVersion.findFirst({
      where: { assetId: asset.id, contentHash: desiredHash },
    });
    if (!existingVersion) {
      const latestVersion = await prisma.goalAssetVersion.findFirst({
        where: { assetId: asset.id },
        orderBy: { version: "desc" },
      });
      await prisma.goalAssetVersion.create({
        data: {
          workspaceId: input.workspaceId,
          goalId: input.goalId,
          assetId: asset.id,
          artifactId: input.artifactId,
          version: (latestVersion?.version ?? 0) + 1,
          parentVersionId: latestVersion?.id,
          source: latestVersion ? "manual" : "inbox",
          content,
          contentHash: desiredHash,
          authorType: "system",
          changeSummary: "Structured selection criteria Form",
        },
      });
    }
  }
  return asset;
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
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[0].id, role: GoalAssetRole.reference, label: "Confirmed selection criteria", kind: "form" }),
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[1].id, role: GoalAssetRole.reference, label: "Opening comparison", kind: "page" }),
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[2].id, role: GoalAssetRole.submission, label: "Approved application package", kind: "document" }),
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[3].id, role: GoalAssetRole.evidence, label: "Submission receipt", kind: "file" }),
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[4].id, role: GoalAssetRole.evidence, label: "Offer letter", kind: "file" }),
    upsertGoalAsset({ workspaceId: workspace.id, goalId: goal.id, artifactId: artifacts[5].id, role: GoalAssetRole.evidence, label: "Acceptance confirmation", kind: "document" }),
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

// This retained acceptance scenario keeps Goal, Task, projection, and context timestamps coherent.
async function resetActiveGoalRuntimeFixture() {
  const taskIds = [
    GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId,
    GOAL_WORKBENCH_ACCEPTANCE_IDS.draftTaskId,
  ];
  const runs = await prisma.run.findMany({ where: { taskId: { in: taskIds } }, select: { id: true } });
  const runIds = runs.map(({ id }) => id);
  const dynamicAssets = await prisma.goalAsset.findMany({
    where: { goalId: GOAL_WORKBENCH_ACCEPTANCE_IDS.goalId, versions: { some: { sourceTaskId: { in: taskIds } } } },
    select: { id: true },
  });
  const dynamicAssetIds = dynamicAssets.map(({ id }) => id);

  await prisma.$transaction(async (tx) => {
    if (dynamicAssetIds.length > 0) {
      await tx.goalAsset.deleteMany({ where: { id: { in: dynamicAssetIds } } });
    }
    await tx.goalInboxCandidate.deleteMany({ where: { sourceTaskId: { in: taskIds } } });
    if (runIds.length > 0) {
      await tx.conversationEntry.deleteMany({ where: { runId: { in: runIds } } });
      await tx.approval.deleteMany({ where: { runId: { in: runIds } } });
      await tx.artifact.deleteMany({ where: { runId: { in: runIds } } });
      await tx.runtimeCursor.deleteMany({ where: { runId: { in: runIds } } });
      await tx.run.deleteMany({ where: { id: { in: runIds } } });
    }
    await tx.event.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.rawEventLog.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.executionSession.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.taskPlanProviderApproval.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.taskPlanProviderRun.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.taskPlanNodeAttempt.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.taskPlanTerminalAction.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.taskPlanRun.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.taskPlan.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.taskTimelineItem.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.taskSession.deleteMany({ where: { taskId: { in: taskIds } } });
    await tx.taskProjection.deleteMany({ where: { taskId: { in: taskIds } } });
  });
}

// eslint-disable-next-line max-lines-per-function
export async function seedActiveGoalWorkbenchFixture() {
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
  const workspaceId = workspace.id;
  const goalId = GOAL_WORKBENCH_ACCEPTANCE_IDS.goalId;
  const criteria = [
    { id: "shortlist", kind: "user_confirmed", description: "A target opening is explicitly selected", satisfied: true, confirmedAt: "2026-07-19T09:00:00.000Z" },
    { id: "package", kind: "user_confirmed", description: "The tailored application package is approved", satisfied: false, confirmedAt: null },
    { id: "submitted", kind: "user_confirmed", description: "The application is submitted before the deadline", satisfied: false, confirmedAt: null },
  ];
  const brief = {
    outcome: "Submit a competitive NUS deep-learning PhD application before 31 July 2026",
    currentFocus: "Resolve the final statement approval and freeze the submission package",
    strategy: "Reuse the accepted opening comparison and criteria; draft only from verified applicant facts",
    constraints: [
      "Do not invent publications, grades, or research experience",
      "Require user approval before any external submission",
      "Keep every accepted result and source artifact immutable",
    ],
  };
  await prisma.goal.upsert({
    where: { id: goalId },
    update: {
      workspaceId,
      title: "Submit a competitive NUS deep-learning PhD application",
      description: "Continue accepted research evidence through review, approval, and a controlled final submission.",
      status: GoalStatus.Active,
      successCriteria: criteria,
      nextReviewAt: new Date("2026-07-23T09:00:00.000Z"),
      achievedAt: null,
      stoppedAt: null,
      achievementConfirmation: Prisma.JsonNull,
      operationalBrief: brief,
    },
    create: {
      id: goalId,
      workspaceId,
      title: "Submit a competitive NUS deep-learning PhD application",
      description: "Continue accepted research evidence through review, approval, and a controlled final submission.",
      status: GoalStatus.Active,
      successCriteria: criteria,
      nextReviewAt: new Date("2026-07-23T09:00:00.000Z"),
      operationalBrief: brief,
    },
  });
  await resetActiveGoalRuntimeFixture();

  const taskInputs = [
    { id: GOAL_WORKBENCH_ACCEPTANCE_IDS.criteriaTaskId, title: "Confirm application criteria", description: "Accepted target criteria and non-negotiable constraints.", status: TaskStatus.Completed, priority: TaskPriority.High },
    { id: GOAL_WORKBENCH_ACCEPTANCE_IDS.discoveryTaskId, title: "Compare the NUS opening with alternatives", description: "Accepted comparison supports the selected target.", status: TaskStatus.Completed, priority: TaskPriority.High },
    { id: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId, title: "Approve the tailored research statement", description: "Review the current statement, correct applicant facts, and approve or request changes.", status: TaskStatus.WaitingForApproval, priority: TaskPriority.Urgent },
    { id: GOAL_WORKBENCH_ACCEPTANCE_IDS.draftTaskId, title: "Assemble the final application package", description: "Prepare the bounded package after statement approval.", status: TaskStatus.Ready, priority: TaskPriority.High },
  ];
  for (const input of taskInputs) {
    await prisma.task.upsert({
      where: { id: input.id },
      update: {
        workspaceId,
        goalId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        executionRuntime: "simulated-goal-acceptance",
        executionConfig: { simulated: true, purpose: "Active Goal Workbench acceptance" },
        autoPlanGeneration: false,
        autoExecute: false,
        latestRunId: null,
        latestEventId: null,
        latestRawEventId: null,
        blockedByEventId: null,
        blockedByRawEventId: null,
        blockReason: Prisma.DbNull,
        completedAt: input.status === TaskStatus.Completed ? new Date("2026-07-20T08:30:00.000Z") : null,
        definitionStatus: "Active",
      },
      create: {
        id: input.id,
        workspaceId,
        goalId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        executionRuntime: "simulated-goal-acceptance",
        executionConfig: { simulated: true, purpose: "Active Goal Workbench acceptance" },
        autoPlanGeneration: false,
        autoExecute: false,
      },
    });
  }
  await prisma.taskProjection.upsert({
    where: { taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId },
    update: {
      workspaceId,
      persistedStatus: TaskStatus.WaitingForApproval,
      displayState: "WaitingForApproval",
      blockType: "approval_required",
      blockScope: "task",
      blockSince: new Date("2026-07-20T08:45:00.000Z"),
      actionRequired: "Review and approve the tailored research statement",
      blockDetail: "The final package cannot proceed until the statement is approved.",
      blockNodeId: "approve_research_statement",
      latestRunStatus: RunStatus.WaitingForApproval,
      approvalPendingCount: 1,
      latestArtifactTitle: null,
      lastActivityAt: new Date("2026-07-20T08:45:00.000Z"),
      latestEventId: null,
      latestRawEventId: null,
      blockedByEventId: null,
      blockedByRawEventId: null,
      currentNodeId: "approve_research_statement",
      currentNodeTitle: "Approve the tailored research statement",
    },
    create: {
      taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId,
      workspaceId,
      persistedStatus: TaskStatus.WaitingForApproval,
      displayState: "WaitingForApproval",
      blockType: "approval_required",
      blockScope: "task",
      blockSince: new Date("2026-07-20T08:45:00.000Z"),
      actionRequired: "Review and approve the tailored research statement",
      blockDetail: "The final package cannot proceed until the statement is approved.",
      blockNodeId: "approve_research_statement",
      latestRunStatus: RunStatus.WaitingForApproval,
      approvalPendingCount: 1,
      lastActivityAt: new Date("2026-07-20T08:45:00.000Z"),
      currentNodeId: "approve_research_statement",
      currentNodeTitle: "Approve the tailored research statement",
    },
  });
  await upsertAcceptedResult({
    taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.criteriaTaskId,
    workspaceId,
    runId: GOAL_WORKBENCH_ACCEPTANCE_IDS.criteriaRunId,
    planId: "plan_goal_active_criteria",
    title: "Confirmed application criteria",
    summary: "Funding, research fit, deadline, and factual-safety constraints were confirmed for the NUS application.",
    acceptedAt: new Date("2026-07-19T09:00:00.000Z"),
  });
  await upsertAcceptedResult({
    taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.discoveryTaskId,
    workspaceId,
    runId: GOAL_WORKBENCH_ACCEPTANCE_IDS.discoveryRunId,
    planId: "plan_goal_active_discovery",
    title: "Accepted opening comparison",
    summary: "The accepted comparison selected NUS as the primary target while retaining NTU and HKUST as bounded alternatives.",
    acceptedAt: new Date("2026-07-20T08:30:00.000Z"),
  });
  await upsertArtifact({ id: GOAL_WORKBENCH_ACCEPTANCE_IDS.criteriaArtifactId, workspaceId, taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.criteriaTaskId, runId: GOAL_WORKBENCH_ACCEPTANCE_IDS.criteriaRunId, title: "Confirmed application criteria", type: ArtifactType.summary, uri: "inline://goal-active/criteria", contentPreview: "Funding, fit, deadline, and factual-safety constraints confirmed.", metadata: { fixture: true } });
  await upsertArtifact({ id: GOAL_WORKBENCH_ACCEPTANCE_IDS.comparisonArtifactId, workspaceId, taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.discoveryTaskId, runId: GOAL_WORKBENCH_ACCEPTANCE_IDS.discoveryRunId, title: "NUS opening comparison", type: ArtifactType.summary, uri: "inline://goal-active/comparison", contentPreview: "NUS selected as primary target; NTU and HKUST retained as alternatives.", metadata: { fixture: true } });

  const approvalPlanId = "plan_goal_active_approval";
  const approvalNodeId = "approve_research_statement";
  const approvalLayerId = `node_layer_${approvalPlanId}_${approvalNodeId}_v1`;
  const approvalPlan = {
    id: "compiled_goal_active_approval",
    editablePlanId: approvalPlanId,
    sourceVersion: 1,
    title: "Approve the tailored research statement",
    goal: "Review the retained research statement and explicitly approve, reject, or request changes.",
    assumptions: [],
    nodes: [{ id: approvalNodeId, localId: approvalNodeId, type: "checkpoint", title: "Approve the tailored research statement", config: { checkpointType: "approve", prompt: "Verify applicant facts and research positioning before the final package proceeds.", required: true }, dependencies: [], dependents: [], executor: "user", mode: "manual", estimatedMinutes: 10, priority: "High" }],
    edges: [],
    entryNodeIds: [approvalNodeId],
    terminalNodeIds: [approvalNodeId],
    topologicalOrder: [approvalNodeId],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
  const approvalGraph = {
    id: approvalPlanId,
    taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId,
    status: "paused",
    nodes: [{ id: approvalNodeId, semanticKey: approvalNodeId, layers: [{ id: approvalLayerId, nodeId: approvalNodeId, type: "definition", createdAt: "2026-07-20T08:45:00.000Z", createdBy: "system", definition: { title: "Approve the tailored research statement", objective: "Verify applicant facts and research positioning before the final package proceeds.", semantics: { type: "checkpoint", priority: "High", mode: "manual", metadata: { checkpointType: "approve", prompt: "Verify applicant facts and research positioning before the final package proceeds.", required: true } }, executor: "user", estimatedMinutes: 10, metadata: { checkpointType: "approve", prompt: "Verify applicant facts and research positioning before the final package proceeds.", required: true } } }], createdAt: "2026-07-20T08:45:00.000Z", updatedAt: "2026-07-20T08:45:00.000Z" }],
    edges: [],
    mutations: [],
    createdAt: "2026-07-20T08:45:00.000Z",
    updatedAt: "2026-07-20T08:45:00.000Z",
  };
  const approvalAttemptId = "attempt_goal_active_approval_1";
  await prisma.taskPlan.upsert({ where: { planId: approvalPlanId }, update: { workspaceId, taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId, status: "Accepted", prompt: "Review the retained research statement", summary: "User approval gates the final package.", compiledPlan: approvalPlan }, create: { id: "task_plan_goal_active_approval", workspaceId, taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId, planId: approvalPlanId, revision: 1, status: "Accepted", prompt: "Review the retained research statement", summary: "User approval gates the final package.", compiledPlan: approvalPlan, generatedBy: "goal-acceptance-fixture" } });
  await prisma.taskPlanNodeAttempt.deleteMany({ where: { taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId } });
  await prisma.taskPlanRun.upsert({
    where: { id: "task_plan_run_goal_active_approval" },
    update: {
      workspaceId,
      taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId,
      planId: approvalPlanId,
      planRun: { planRun: { id: `plan_run_${approvalPlanId}`, compiledPlanId: approvalPlan.id, editablePlanId: approvalPlanId, sourceVersion: 1, status: "waiting_for_approval", nodeStates: { [approvalNodeId]: { nodeId: approvalNodeId, status: "waiting_for_approval", attempts: 1 } }, checkpointResponses: [], artifactRefs: [], attempts: [], createdAt: "2026-07-20T08:45:00.000Z", startedAt: "2026-07-20T08:45:00.000Z" }, mutableGraph: { graph: approvalGraph, attempts: [{ id: approvalAttemptId, taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId, graphId: approvalPlanId, nodeId: approvalNodeId, nodeLayerId: approvalLayerId, executionContextSnapshotId: "ctx_goal_active_approval", status: "running", idempotencyKey: "goal-active-approval-attempt", attemptNumber: 1, startedAt: "2026-07-20T08:45:00.000Z" }], results: [{ id: "result_goal_active_approval_wait", taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId, graphId: approvalPlanId, nodeId: approvalNodeId, nodeLayerId: approvalLayerId, attemptId: approvalAttemptId, status: "current", outputSummary: "Tailored statement is ready for factual review.", waitKind: "approval", actionForm: { instructions: "Read the statement summary, then approve, reject, or request changes with feedback.", submitLabel: "Submit decision", inputFields: [{ name: "feedback", label: "Approval note", kind: "text", multiline: true, required: false }] } }], executionContextSnapshots: [], planOutput: { spec: resultSpec("Tailored research statement ready for approval", "The statement connects verified deep-learning experience to the NUS lab direction without inventing applicant facts."), revision: 1, updatedAt: "2026-07-20T08:45:00.000Z", updatedByNodeId: approvalNodeId, history: [] } } },
      executionOwnerId: null,
      executionOwnerScope: null,
      executionLeaseUntil: null,
      executionEpoch: 0,
      latestEventId: null,
      latestRawEventId: null,
    },
    create: { id: "task_plan_run_goal_active_approval", workspaceId, taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId, planId: approvalPlanId, planRun: { planRun: { id: `plan_run_${approvalPlanId}`, compiledPlanId: approvalPlan.id, editablePlanId: approvalPlanId, sourceVersion: 1, status: "waiting_for_approval", nodeStates: { [approvalNodeId]: { nodeId: approvalNodeId, status: "waiting_for_approval", attempts: 1 } }, checkpointResponses: [], artifactRefs: [], attempts: [], createdAt: "2026-07-20T08:45:00.000Z", startedAt: "2026-07-20T08:45:00.000Z" }, mutableGraph: { graph: approvalGraph, attempts: [{ id: approvalAttemptId, taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId, graphId: approvalPlanId, nodeId: approvalNodeId, nodeLayerId: approvalLayerId, executionContextSnapshotId: "ctx_goal_active_approval", status: "running", idempotencyKey: "goal-active-approval-attempt", attemptNumber: 1, startedAt: "2026-07-20T08:45:00.000Z" }], results: [{ id: "result_goal_active_approval_wait", taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId, graphId: approvalPlanId, nodeId: approvalNodeId, nodeLayerId: approvalLayerId, attemptId: approvalAttemptId, status: "current", outputSummary: "Tailored statement is ready for factual review.", waitKind: "approval", actionForm: { instructions: "Read the statement summary, then approve, reject, or request changes with feedback.", submitLabel: "Submit decision", inputFields: [{ name: "feedback", label: "Approval note", kind: "text", multiline: true, required: false }] } }], executionContextSnapshots: [], planOutput: { spec: resultSpec("Tailored research statement ready for approval", "The statement connects verified deep-learning experience to the NUS lab direction without inventing applicant facts."), revision: 1, updatedAt: "2026-07-20T08:45:00.000Z", updatedByNodeId: approvalNodeId, history: [] } } } },
  });
  await prisma.executionSession.upsert({
    where: { id: "execution_session_goal_active_approval" },
    update: {
      workspaceId,
      taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId,
      planId: approvalPlanId,
      status: "Paused",
      currentNodeId: approvalNodeId,
      currentNodeAttemptId: approvalAttemptId,
      pauseReason: "approval",
      completedNodeIds: "[]",
      pausedByEventId: null,
      pausedByRawEventId: null,
      latestEventId: null,
      latestRawEventId: null,
      startedAt: new Date("2026-07-20T08:45:00.000Z"),
      pausedAt: new Date("2026-07-20T08:45:00.000Z"),
      completedAt: null,
    },
    create: { id: "execution_session_goal_active_approval", workspaceId, taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId, planId: approvalPlanId, status: "Paused", currentNodeId: approvalNodeId, currentNodeAttemptId: approvalAttemptId, pauseReason: "approval", completedNodeIds: "[]", startedAt: new Date("2026-07-20T08:45:00.000Z"), pausedAt: new Date("2026-07-20T08:45:00.000Z") },
  });
  await prisma.run.upsert({
    where: { id: "run_goal_active_approval" },
    update: {
      taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId,
      runtimeName: "simulated-goal-acceptance",
      runtimeConfigSnapshot: { simulated: true, noProviderInvoked: true, planId: approvalPlanId },
      status: RunStatus.WaitingForApproval,
      startedAt: new Date("2026-07-20T08:45:00.000Z"),
      endedAt: null,
      triggeredBy: "acceptance-fixture",
      syncStatus: "healthy",
    },
    create: {
      id: "run_goal_active_approval",
      taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId,
      runtimeName: "simulated-goal-acceptance",
      runtimeConfigSnapshot: { simulated: true, noProviderInvoked: true, planId: approvalPlanId },
      status: RunStatus.WaitingForApproval,
      startedAt: new Date("2026-07-20T08:45:00.000Z"),
      triggeredBy: "acceptance-fixture",
      syncStatus: "healthy",
    },
  });
  await prisma.task.update({
    where: { id: GOAL_WORKBENCH_ACCEPTANCE_IDS.approvalTaskId },
    data: {
      latestRunId: "run_goal_active_approval",
      latestEventId: null,
      latestRawEventId: null,
      blockedByEventId: null,
      blockedByRawEventId: null,
      completedAt: null,
    },
  });

  await prisma.goalBriefRevision.deleteMany({ where: { goalId } });
  await prisma.goalBriefRevision.create({ data: { workspaceId, goalId, brief, actorType: "user", actorId: "acceptance-fixture-user", createdAt: new Date("2026-07-20T09:00:00.000Z") } });
  await prisma.goalWorkingSetItem.deleteMany({ where: { goalId } });
  await prisma.goalWorkingSetItem.createMany({
    data: [
      {
        id: "goal_ws_active_criteria",
        workspaceId,
        goalId,
        subjectType: "task",
        subjectId: GOAL_WORKBENCH_ACCEPTANCE_IDS.criteriaTaskId,
        label: "Confirmed application criteria",
        snapshot: { title: "Confirm application criteria", status: "Completed", summary: "Funding, fit, deadline, and factual-safety constraints confirmed." },
        rank: 0,
      },
      {
        id: "goal_ws_active_comparison",
        workspaceId,
        goalId,
        subjectType: "accepted_result",
        subjectId: GOAL_WORKBENCH_ACCEPTANCE_IDS.discoveryRunId,
        label: "Accepted opening comparison",
        snapshot: { taskId: GOAL_WORKBENCH_ACCEPTANCE_IDS.discoveryTaskId, runId: GOAL_WORKBENCH_ACCEPTANCE_IDS.discoveryRunId, summary: "NUS target selected from the accepted comparison.", artifactIds: [GOAL_WORKBENCH_ACCEPTANCE_IDS.comparisonArtifactId] },
        rank: 1,
      },
      {
        id: "goal_ws_active_criterion",
        workspaceId,
        goalId,
        subjectType: "criterion",
        subjectId: "package",
        label: "Application package approved",
        snapshot: { description: "The tailored application package is approved", satisfied: false },
        rank: 2,
      },
    ],
  });
  await prisma.event.upsert({
    where: { dedupeKey: `goal-workbench:${goalId}:brief` },
    update: { workspaceId, eventType: "goal.brief_updated", payload: { goal_id: goalId, current_focus: brief.currentFocus }, summary: brief.currentFocus },
    create: { workspaceId, eventType: "goal.brief_updated", actorType: "user", actorId: "acceptance-fixture-user", source: "fixture", payload: { goal_id: goalId, current_focus: brief.currentFocus }, summary: brief.currentFocus, dedupeKey: `goal-workbench:${goalId}:brief`, ingestSequence: 202607200900 },
  });
  return { workspaceId, goalId, taskIds: taskInputs.map((task) => task.id) };
}

if (import.meta.main) {
  Promise.all([
    seedCompletedGoalAcceptanceFixture(),
    seedActiveGoalWorkbenchFixture(),
  ])
    .then(([archive, workbench]) => console.log(JSON.stringify({ archive, workbench })))
    .finally(() => prisma.$disconnect());
}
