import { ApprovalStatus, RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { updateTaskSessionStateFromRun } from "@/modules/task-execution/task-sessions";
import type { RuntimeAdapter } from "@chrona/providers-core";
import { Prisma } from "@/generated/prisma/client";

async function markApprovalResolved(input: {
  approval: {
    id: string;
    workspaceId: string;
    taskId: string;
    runId: string;
  };
  decision: "Approved" | "Rejected" | "EditedAndApproved";
  resolutionNote?: string;
}) {
  await db.approval.update({
    where: { id: input.approval.id },
    data: {
      status: input.decision,
      resolvedAt: new Date(),
      resolvedBy: "server-action",
      resolutionNote: input.resolutionNote ?? null,
    },
  });

  await appendCanonicalEvent({
    eventType: "approval.resolved",
    workspaceId: input.approval.workspaceId,
    taskId: input.approval.taskId,
    runId: input.approval.runId,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      approval_id: input.approval.id,
      resolution:
        input.decision === "Rejected"
          ? "rejected"
          : input.decision === "EditedAndApproved"
            ? "edited_and_approved"
            : "approved",
      resolution_note: input.resolutionNote ?? null,
    },
    dedupeKey: `approval.resolved:${input.approval.id}`,
  });
}

export async function resolveApproval(input: {
  approvalId: string;
  decision: "Approved" | "Rejected" | "EditedAndApproved";
  resolutionNote?: string;
  editedContent?: string;
  adapter?: RuntimeAdapter;
}) {
  const approval = await db.approval.findUnique({
    where: { id: input.approvalId },
    include: { task: true, run: { include: { taskSession: true } } },
  });

  if (!approval) {
    throw new Error("The approval request no longer exists. Refresh the work page and try again.");
  }

  if (approval.status !== ApprovalStatus.Pending) {
    throw new Error("Only pending approvals can be resolved.");
  }

  if (input.decision === "Rejected") {
    await markApprovalResolved({
      approval,
      decision: input.decision,
      resolutionNote: input.resolutionNote,
    });

    await db.run.update({
      where: { id: approval.runId },
      data: {
        status: RunStatus.Failed,
        retryable: true,
        errorSummary: input.resolutionNote ?? "Approval rejected",
        endedAt: new Date(),
        lastSyncedAt: new Date(),
        syncStatus: "healthy",
      },
    });
    await updateTaskSessionStateFromRun({
      taskSessionId: approval.run.taskSessionId,
      runId: approval.runId,
      runStatus: RunStatus.Failed,
      runtimeRunRef: approval.run.runtimeRunRef,
    });
    await db.task.update({
      where: { id: approval.taskId },
      data: {
        status: "Blocked",
        blockReason: {
          blockType: "approval_rejected",
          scope: "task",
          actionRequired: "Re-plan / Create New Run",
        },
      },
    });
    await rebuildTaskProjection(approval.taskId);

    return {
      taskId: approval.taskId,
      workspaceId: approval.task.workspaceId,
      runId: approval.runId,
    };
  }

  await markApprovalResolved({
    approval,
    decision: input.decision,
    resolutionNote: input.resolutionNote,
  });

  await db.task.update({
    where: { id: approval.taskId },
    data: {
      status: "Ready",
      blockReason: Prisma.DbNull,
    },
  });

  await rebuildTaskProjection(approval.taskId);

  return {
    taskId: approval.taskId,
    workspaceId: approval.task.workspaceId,
    runId: approval.runId,
  };
}
