import { ApprovalStatus, RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { resumeRun } from "@/modules/commands/resume-run";
import { createRuntimeAdapter, type OpenClawAdapter } from "@/modules/runtime/openclaw/adapter";

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
  adapter?: OpenClawAdapter;
}) {
  const approval = await db.approval.findUniqueOrThrow({
    where: { id: input.approvalId },
    include: { task: true, run: true },
  });

  if (approval.status !== ApprovalStatus.Pending) {
    throw new Error("Only pending approvals can be resolved.");
  }

  if (input.decision === "Rejected") {
    const adapter = input.adapter ?? (await createRuntimeAdapter());

    if (!approval.run.runtimeSessionRef) {
      throw new Error("Cannot reject approval without a runtime session key.");
    }

    const resumed = await adapter.resumeRun({
      runtimeSessionKey: approval.run.runtimeSessionRef,
      approvalId: approval.id,
      decision: "reject",
    });

    if (!resumed.accepted) {
      throw new Error("Runtime rejected the approval resolution.");
    }

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

  const result = await resumeRun({
    runId: approval.runId,
    approvalId: approval.id,
    inputText: input.decision === "EditedAndApproved" ? input.editedContent : undefined,
    adapter: input.adapter,
  });

  await markApprovalResolved({
    approval,
    decision: input.decision,
    resolutionNote: input.resolutionNote,
  });

  return result;
}
