/* eslint-disable complexity -- Review context projection explicitly redacts and normalizes every source variant. */
import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { aiArtifactRef } from "../plan-execution/use-cases/register-generated-plan-output-artifacts";

export async function getTaskReviewContext(input: { taskId: string; workBlockId?: string | null }) {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: {
      artifacts: {
        where: { run: { workBlockId: input.workBlockId ?? null } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, title: true, type: true, uri: true },
      },
      approvals: {
        where: { run: { workBlockId: input.workBlockId ?? null } },
        orderBy: { requestedAt: "desc" },
        take: 5,
      },
      scheduleProposals: {
        where: { status: "Pending" },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }
  if (input.workBlockId) {
    const ownedWorkBlock = await db.workBlock.findFirst({
      where: { id: input.workBlockId, taskId: input.taskId },
      select: { id: true },
    });
    if (!ownedWorkBlock) {
      throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Work block not found");
    }
  }

  const latestRun = await db.run.findFirst({
    where: { taskId: input.taskId, workBlockId: input.workBlockId ?? null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const acceptance = latestRun
    ? await db.event.findFirst({
        where: {
          taskId: input.taskId,
          runId: latestRun.id,
          eventType: "task.result_accepted",
        },
        orderBy: { ingestedAt: "desc" },
      })
    : null;
  const acceptancePayload = acceptance?.payload as { accepted_at?: unknown } | null;

  return {
    latestRunSummary: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt?.toISOString() ?? null,
          syncStatus: latestRun.syncStatus,
        }
      : null,
    resultReview: latestRun
      ? {
          status: acceptance ? "accepted" as const : "pending_acceptance" as const,
          runId: latestRun.id,
          acceptedAt: acceptance
            ? typeof acceptancePayload?.accepted_at === "string"
              ? acceptancePayload.accepted_at
              : acceptance.ingestedAt.toISOString()
            : null,
        }
      : null,
    artifacts: task.artifacts.map((artifact) => ({
      ...artifact,
      artifactRef: aiArtifactRef(artifact.id),
    })),
    scheduleProposals: task.scheduleProposals.map((proposal) => ({
      id: proposal.id,
      source: proposal.source,
      proposedBy: proposal.proposedBy,
      summary: proposal.summary,
      status: proposal.status,
      dueAt: proposal.dueAt?.toISOString() ?? null,
      scheduledStartAt: proposal.scheduledStartAt?.toISOString() ?? null,
      scheduledEndAt: proposal.scheduledEndAt?.toISOString() ?? null,
    })),
    approvals: task.approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      status: approval.status,
      riskLevel: approval.riskLevel,
      requestedAt: approval.requestedAt.toISOString(),
    })),
  };
}
