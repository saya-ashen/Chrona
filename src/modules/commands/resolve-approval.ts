import { ApprovalStatus, RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { resumeRun } from "@/modules/commands/resume-run";
import type { OpenClawAdapter } from "@/modules/runtime/openclaw/adapter";

export async function resolveApproval(input: {
  approvalId: string;
  decision: "Approved" | "Rejected" | "EditedAndApproved";
  resolutionNote?: string;
  editedContent?: string;
  adapter?: OpenClawAdapter;
}) {
  const approval = await db.approval.findUniqueOrThrow({
    where: { id: input.approvalId },
    include: { task: true },
  });

  if (approval.status !== ApprovalStatus.Pending) {
    throw new Error("Only pending approvals can be resolved.");
  }

  await db.approval.update({
    where: { id: approval.id },
    data: {
      status: input.decision,
      resolvedAt: new Date(),
      resolvedBy: "server-action",
      resolutionNote: input.resolutionNote ?? null,
    },
  });

  await appendCanonicalEvent({
    eventType: "approval.resolved",
    workspaceId: approval.workspaceId,
    taskId: approval.taskId,
    runId: approval.runId,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      approval_id: approval.id,
      resolution:
        input.decision === "Rejected"
          ? "rejected"
          : input.decision === "EditedAndApproved"
            ? "edited_and_approved"
            : "approved",
      resolution_note: input.resolutionNote ?? null,
    },
    dedupeKey: `approval.resolved:${approval.id}`,
  });

  if (input.decision === "Rejected") {
    await db.run.update({
      where: { id: approval.runId },
      data: {
        status: RunStatus.Failed,
        retryable: true,
        errorSummary: input.resolutionNote ?? "Approval rejected",
        endedAt: new Date(),
      },
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

  return resumeRun({
    runId: approval.runId,
    approvalId: approval.id,
    inputText: input.decision === "EditedAndApproved" ? input.editedContent : undefined,
    adapter: input.adapter,
  });
}
