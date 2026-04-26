import {
  ApprovalStatus,
  ArtifactType,
  PrismaClient,
  RunStatus,
  ScheduleProposalStatus,
  ScheduleSource,
  ScheduleStatus,
  TaskPriority,
  TaskStatus,
  WorkspaceStatus,
} from "../packages/db/src/generated/prisma/client";
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

  const scheduledTask = await prisma.task.upsert({
    where: { id: "task_scheduled" },
    update: {
      workspaceId: workspace.id,
      title: "Prepare release schedule",
      description: "Lock the next release block and due date.",
      status: TaskStatus.Scheduled,
      priority: TaskPriority.Medium,
      ownerType: "human",
      dueAt: new Date("2026-04-17T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-17T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-17T11:00:00.000Z"),
      scheduleStatus: ScheduleStatus.Scheduled,
      scheduleSource: ScheduleSource.human,
    },
    create: {
      id: "task_scheduled",
      workspaceId: workspace.id,
      title: "Prepare release schedule",
      description: "Lock the next release block and due date.",
      status: TaskStatus.Scheduled,
      priority: TaskPriority.Medium,
      ownerType: "human",
      dueAt: new Date("2026-04-17T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-17T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-17T11:00:00.000Z"),
      scheduleStatus: ScheduleStatus.Scheduled,
      scheduleSource: ScheduleSource.human,
    },
  });

  const unscheduledTask = await prisma.task.upsert({
    where: { id: "task_unscheduled" },
    update: {
      workspaceId: workspace.id,
      title: "Queue follow-up docs",
      description: "Needs a planned slot before AI starts drafting.",
      status: TaskStatus.Ready,
      priority: TaskPriority.Medium,
      ownerType: "human",
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduleStatus: ScheduleStatus.Unscheduled,
      scheduleSource: null,
    },
    create: {
      id: "task_unscheduled",
      workspaceId: workspace.id,
      title: "Queue follow-up docs",
      description: "Needs a planned slot before AI starts drafting.",
      status: TaskStatus.Ready,
      priority: TaskPriority.Medium,
      ownerType: "human",
      scheduleStatus: ScheduleStatus.Unscheduled,
    },
  });

  const overdueTask = await prisma.task.upsert({
    where: { id: "task_overdue" },
    update: {
      workspaceId: workspace.id,
      title: "Recover overdue adapter run",
      description: "Execution slipped past the planned window and needs replanning.",
      status: TaskStatus.Running,
      priority: TaskPriority.High,
      ownerType: "human",
      dueAt: new Date("2026-04-15T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-15T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-15T11:00:00.000Z"),
      scheduleStatus: ScheduleStatus.Overdue,
      scheduleSource: ScheduleSource.human,
    },
    create: {
      id: "task_overdue",
      workspaceId: workspace.id,
      title: "Recover overdue adapter run",
      description: "Execution slipped past the planned window and needs replanning.",
      status: TaskStatus.Running,
      priority: TaskPriority.High,
      ownerType: "human",
      dueAt: new Date("2026-04-15T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-15T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-15T11:00:00.000Z"),
      scheduleStatus: ScheduleStatus.Overdue,
      scheduleSource: ScheduleSource.human,
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

  await prisma.taskProjection.upsert({
    where: { taskId: scheduledTask.id },
    update: {
      workspaceId: workspace.id,
      persistedStatus: TaskStatus.Scheduled,
      displayState: "Scheduled",
      dueAt: new Date("2026-04-17T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-17T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-17T11:00:00.000Z"),
      scheduleStatus: "Scheduled",
      scheduleSource: "human",
      lastActivityAt: new Date("2026-04-16T15:00:00.000Z"),
    },
    create: {
      taskId: scheduledTask.id,
      workspaceId: workspace.id,
      persistedStatus: TaskStatus.Scheduled,
      displayState: "Scheduled",
      dueAt: new Date("2026-04-17T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-17T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-17T11:00:00.000Z"),
      scheduleStatus: "Scheduled",
      scheduleSource: "human",
      lastActivityAt: new Date("2026-04-16T15:00:00.000Z"),
    },
  });

  await prisma.taskProjection.upsert({
    where: { taskId: unscheduledTask.id },
    update: {
      workspaceId: workspace.id,
      persistedStatus: TaskStatus.Ready,
      displayState: "Ready",
      actionRequired: "Schedule task",
      scheduleStatus: "Unscheduled",
      scheduleProposalCount: 1,
      lastActivityAt: new Date("2026-04-16T14:00:00.000Z"),
    },
    create: {
      taskId: unscheduledTask.id,
      workspaceId: workspace.id,
      persistedStatus: TaskStatus.Ready,
      displayState: "Ready",
      actionRequired: "Schedule task",
      scheduleStatus: "Unscheduled",
      scheduleProposalCount: 1,
      lastActivityAt: new Date("2026-04-16T14:00:00.000Z"),
    },
  });

  await prisma.taskProjection.upsert({
    where: { taskId: overdueTask.id },
    update: {
      workspaceId: workspace.id,
      persistedStatus: TaskStatus.Running,
      displayState: "Running",
      actionRequired: "Reschedule task",
      dueAt: new Date("2026-04-15T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-15T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-15T11:00:00.000Z"),
      scheduleStatus: "Overdue",
      scheduleSource: "human",
      lastActivityAt: new Date("2026-04-15T12:30:00.000Z"),
    },
    create: {
      taskId: overdueTask.id,
      workspaceId: workspace.id,
      persistedStatus: TaskStatus.Running,
      displayState: "Running",
      actionRequired: "Reschedule task",
      dueAt: new Date("2026-04-15T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-15T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-15T11:00:00.000Z"),
      scheduleStatus: "Overdue",
      scheduleSource: "human",
      lastActivityAt: new Date("2026-04-15T12:30:00.000Z"),
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

  await prisma.scheduleProposal.upsert({
    where: { id: "proposal_unscheduled" },
    update: {
      workspaceId: workspace.id,
      taskId: unscheduledTask.id,
      source: ScheduleSource.ai,
      status: ScheduleProposalStatus.Pending,
      proposedBy: "planner-agent",
      summary: "Move this into tomorrow morning",
      dueAt: new Date("2026-04-18T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-18T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-18T10:30:00.000Z"),
      assigneeAgentId: "planner-agent",
      resolvedAt: null,
      resolutionNote: null,
    },
    create: {
      id: "proposal_unscheduled",
      workspaceId: workspace.id,
      taskId: unscheduledTask.id,
      source: ScheduleSource.ai,
      status: ScheduleProposalStatus.Pending,
      proposedBy: "planner-agent",
      summary: "Move this into tomorrow morning",
      dueAt: new Date("2026-04-18T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-18T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-18T10:30:00.000Z"),
      assigneeAgentId: "planner-agent",
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
