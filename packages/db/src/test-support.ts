import { db } from "./db";
import type { TaskPriority, TaskStatus } from "./generated/prisma/client";

// Reset order mirrors the foreign-key dependency graph and must remain explicit.
// eslint-disable-next-line max-statements
export async function resetTestDb() {
  await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    await db.aiFeatureBinding.deleteMany();
    await db.workspaceAiSurface.deleteMany();
    await db.workspaceUserPreference.deleteMany();
    await db.goalReviewProposalItem.deleteMany();
    await db.goalReviewProposal.deleteMany();
    await db.goalAssetJob.deleteMany();
    await db.goalFormSubmission.deleteMany();
    await db.goalInboxCandidate.deleteMany();
    await db.goalAssetDraft.deleteMany();
    await db.goalAssetVersion.deleteMany();
    await db.goalAsset.deleteMany();
    await db.aiClient.deleteMany();
    await db.importedCalendarEvent.deleteMany();
    await db.calendarSource.deleteMany();
    await db.taskResultContinuation.deleteMany();
    await db.taskAssistantMessage.deleteMany();
    await db.taskPlanProviderApprovalResolution.deleteMany();
    await db.taskPlanProviderApproval.deleteMany();
    await db.taskPlanProviderRun.deleteMany();
    await db.taskPlanNodeAttempt.deleteMany();
    await db.taskPlanLayer.deleteMany();
    await db.taskPlanRun.deleteMany();
    await db.taskPlan.deleteMany();
    await db.graphMutationRecord.deleteMany();
    await db.graphVersion.deleteMany();
    await db.reconciliationEvent.deleteMany();
    await db.schedulerEvent.deleteMany();
    await db.scheduleProposal.deleteMany();
    await db.toolInvocation.deleteMany();
    await db.conversationEntry.deleteMany();
    await db.runtimeCursor.deleteMany();
    await db.taskTimelineItem.deleteMany();
    await db.event.deleteMany();
    await db.rawEventLog.deleteMany();
    await db.approval.deleteMany();
    await db.artifact.deleteMany();
    await db.taskOccurrence.deleteMany();
    await db.triggerDelivery.deleteMany();
    await db.taskTrigger.deleteMany();
    await db.executionSession.deleteMany();
    await db.workBlock.deleteMany();
    await db.taskProjection.deleteMany();
    await db.run.deleteMany();
    await db.taskSession.deleteMany();
    await db.taskDependency.deleteMany();
    await db.memory.deleteMany();
    await db.goal.deleteMany();
    await db.task.deleteMany();
    await db.schedulerLease.deleteMany();
    await db.workspace.deleteMany();
  } finally {
    await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  }
}

export interface SeedWorkspaceResult {
  workspaceId: string;
}

export async function seedWorkspace(name?: string): Promise<SeedWorkspaceResult> {
  const workspace = await db.workspace.create({
    data: { name: name ?? "Test Workspace", status: "Active" },
  });
  return { workspaceId: workspace.id };
}

export interface SeedTaskResult {
  workspaceId: string;
  taskId: string;
}

export async function seedTask(
  workspaceId: string,
  overrides?: {
    title?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    parentTaskId?: string;
    dueAt?: Date;
  },
): Promise<SeedTaskResult> {
  const task = await db.task.create({
    data: {
      workspaceId,
      title: overrides?.title ?? "Test Task",
      status: overrides?.status ?? "Ready",
      priority: overrides?.priority ?? "Medium",
      parentTaskId: overrides?.parentTaskId ?? null,
      dueAt: overrides?.dueAt ?? null,
      executionConfig: {},
    },
  });
  return { workspaceId, taskId: task.id };
}
