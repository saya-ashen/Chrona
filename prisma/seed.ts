import {
  ApprovalStatus,
  ArtifactType,
  PrismaClient,
  RunStatus,
  TaskPriority,
  TaskStatus,
  WorkspaceStatus,
} from "../src/generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";

const adapter = new PrismaBunSqlite({
  url: process.env.DATABASE_URL || "file:./prisma/dev.db",
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const workspace = await prisma.workspace.upsert({
    where: { id: "ws_demo" },
    update: {
      name: "Demo Workspace",
      description: "Seed data for the control-plane MVP",
      defaultRuntime: "openclaw",
      status: WorkspaceStatus.Active,
    },
    create: {
      id: "ws_demo",
      name: "Demo Workspace",
      description: "Seed data for the control-plane MVP",
      defaultRuntime: "openclaw",
      status: WorkspaceStatus.Active,
    },
  });

  const runningTask = await prisma.task.upsert({
    where: { id: "task_projection" },
    update: {
      workspaceId: workspace.id,
      title: "Write task projection",
      description: "Build the Task Projection pipeline",
      status: TaskStatus.Running,
      priority: TaskPriority.High,
      ownerType: "human",
    },
    create: {
      id: "task_projection",
      workspaceId: workspace.id,
      title: "Write task projection",
      description: "Build the Task Projection pipeline",
      status: TaskStatus.Running,
      priority: TaskPriority.High,
      ownerType: "human",
    },
  });

  const blockedTask = await prisma.task.upsert({
    where: { id: "task_adapter" },
    update: {
      workspaceId: workspace.id,
      title: "Review adapter mapping",
      description: "Needs approval before applying file changes",
      status: TaskStatus.Blocked,
      priority: TaskPriority.Urgent,
      ownerType: "human",
    },
    create: {
      id: "task_adapter",
      workspaceId: workspace.id,
      title: "Review adapter mapping",
      description: "Needs approval before applying file changes",
      status: TaskStatus.Blocked,
      priority: TaskPriority.Urgent,
      ownerType: "human",
    },
  });

  const runningRun = await prisma.run.upsert({
    where: { id: "run_projection" },
    update: {
      taskId: runningTask.id,
      runtimeName: "openclaw",
      runtimeRunRef: "oc_run_projection",
      runtimeSessionRef: "oc_session_projection",
      status: RunStatus.Running,
      triggeredBy: "user",
      startedAt: new Date("2026-04-08T10:00:00.000Z"),
    },
    create: {
      id: "run_projection",
      taskId: runningTask.id,
      runtimeName: "openclaw",
      runtimeRunRef: "oc_run_projection",
      runtimeSessionRef: "oc_session_projection",
      status: RunStatus.Running,
      triggeredBy: "user",
      startedAt: new Date("2026-04-08T10:00:00.000Z"),
    },
  });

  const blockedRun = await prisma.run.upsert({
    where: { id: "run_adapter" },
    update: {
      taskId: blockedTask.id,
      runtimeName: "openclaw",
      runtimeRunRef: "oc_run_adapter",
      runtimeSessionRef: "oc_session_adapter",
      status: RunStatus.WaitingForApproval,
      triggeredBy: "user",
      startedAt: new Date("2026-04-08T10:05:00.000Z"),
      resumeSupported: true,
    },
    create: {
      id: "run_adapter",
      taskId: blockedTask.id,
      runtimeName: "openclaw",
      runtimeRunRef: "oc_run_adapter",
      runtimeSessionRef: "oc_session_adapter",
      status: RunStatus.WaitingForApproval,
      triggeredBy: "user",
      startedAt: new Date("2026-04-08T10:05:00.000Z"),
      resumeSupported: true,
    },
  });

  await prisma.event.upsert({
    where: { dedupeKey: `run.started:${runningRun.id}` },
    update: {
      payload: { runtime_name: "openclaw", runtime_run_ref: runningRun.runtimeRunRef },
    },
    create: {
      eventType: "run.started",
      workspaceId: workspace.id,
      taskId: runningTask.id,
      runId: runningRun.id,
      actorType: "user",
      actorId: "seed-user",
      source: "seed",
      payload: { runtime_name: "openclaw", runtime_run_ref: runningRun.runtimeRunRef },
      dedupeKey: `run.started:${runningRun.id}`,
      ingestSequence: 1,
    },
  });

  await prisma.approval.upsert({
    where: { id: "approval_adapter" },
    update: {
      workspaceId: workspace.id,
      taskId: blockedTask.id,
      runId: blockedRun.id,
      type: "file_change",
      title: "Approve adapter patch",
      summary: "Apply OpenClaw mapping changes",
      riskLevel: "high",
      status: ApprovalStatus.Pending,
      requestedAt: new Date("2026-04-08T10:06:00.000Z"),
    },
    create: {
      id: "approval_adapter",
      workspaceId: workspace.id,
      taskId: blockedTask.id,
      runId: blockedRun.id,
      type: "file_change",
      title: "Approve adapter patch",
      summary: "Apply OpenClaw mapping changes",
      riskLevel: "high",
      status: ApprovalStatus.Pending,
      requestedAt: new Date("2026-04-08T10:06:00.000Z"),
    },
  });

  await prisma.artifact.upsert({
    where: { id: "artifact_projection_patch" },
    update: {
      workspaceId: workspace.id,
      taskId: runningTask.id,
      runId: runningRun.id,
      type: ArtifactType.patch,
      title: "projection.diff",
      uri: "file:///tmp/projection.diff",
      contentPreview: "diff --git a/src/modules/projections/rebuild-task-projection.ts",
    },
    create: {
      id: "artifact_projection_patch",
      workspaceId: workspace.id,
      taskId: runningTask.id,
      runId: runningRun.id,
      type: ArtifactType.patch,
      title: "projection.diff",
      uri: "file:///tmp/projection.diff",
      contentPreview: "diff --git a/src/modules/projections/rebuild-task-projection.ts",
    },
  });

  await prisma.taskProjection.upsert({
    where: { taskId: runningTask.id },
    update: {
      workspaceId: workspace.id,
      persistedStatus: TaskStatus.Running,
      latestRunStatus: RunStatus.Running,
      latestArtifactTitle: "projection.diff",
      lastActivityAt: new Date("2026-04-08T10:07:00.000Z"),
    },
    create: {
      taskId: runningTask.id,
      workspaceId: workspace.id,
      persistedStatus: TaskStatus.Running,
      latestRunStatus: RunStatus.Running,
      latestArtifactTitle: "projection.diff",
      lastActivityAt: new Date("2026-04-08T10:07:00.000Z"),
    },
  });

  await prisma.taskProjection.upsert({
    where: { taskId: blockedTask.id },
    update: {
      workspaceId: workspace.id,
      persistedStatus: TaskStatus.Blocked,
      displayState: "WaitingForApproval",
      blockType: "waiting_for_approval",
      blockScope: "run",
      blockSince: new Date("2026-04-08T10:06:00.000Z"),
      actionRequired: "Approve / Reject / Edit and Approve",
      latestRunStatus: RunStatus.WaitingForApproval,
      approvalPendingCount: 1,
      lastActivityAt: new Date("2026-04-08T10:06:00.000Z"),
    },
    create: {
      taskId: blockedTask.id,
      workspaceId: workspace.id,
      persistedStatus: TaskStatus.Blocked,
      displayState: "WaitingForApproval",
      blockType: "waiting_for_approval",
      blockScope: "run",
      blockSince: new Date("2026-04-08T10:06:00.000Z"),
      actionRequired: "Approve / Reject / Edit and Approve",
      latestRunStatus: RunStatus.WaitingForApproval,
      approvalPendingCount: 1,
      lastActivityAt: new Date("2026-04-08T10:06:00.000Z"),
    },
  });

  await prisma.taskDependency.upsert({
    where: {
      taskId_dependsOnTaskId: {
        taskId: blockedTask.id,
        dependsOnTaskId: runningTask.id,
      },
    },
    update: {
      workspaceId: workspace.id,
      dependencyType: "blocks",
    },
    create: {
      workspaceId: workspace.id,
      taskId: blockedTask.id,
      dependsOnTaskId: runningTask.id,
      dependencyType: "blocks",
    },
  });

  await prisma.memory.upsert({
    where: { id: "memory_projection_guideline" },
    update: {
      workspaceId: workspace.id,
      taskId: runningTask.id,
      sourceRunId: runningRun.id,
      content: "Use Task Projection for all list surfaces.",
      scope: "workspace",
      sourceType: "user_input",
      status: "Active",
    },
    create: {
      id: "memory_projection_guideline",
      workspaceId: workspace.id,
      taskId: runningTask.id,
      sourceRunId: runningRun.id,
      content: "Use Task Projection for all list surfaces.",
      scope: "workspace",
      sourceType: "user_input",
      status: "Active",
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
