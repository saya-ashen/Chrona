import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

export async function getTaskReviewContext(input: { taskId: string }) {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: {
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
      approvals: { orderBy: { requestedAt: "desc" }, take: 5 },
      scheduleProposals: {
        where: { status: "Pending" },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      events: {
        where: { eventType: "task.result_accepted" },
        orderBy: { ingestedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }

  const latestRun = task.runs[0] ?? null;
  const acceptance = task.events[0] ?? null;
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
          status:
            acceptance?.runId === latestRun.id
              ? "accepted" as const
              : "pending_acceptance" as const,
          runId: latestRun.id,
          acceptedAt:
            acceptance?.runId === latestRun.id
              ? typeof acceptancePayload?.accepted_at === "string"
                ? acceptancePayload.accepted_at
                : acceptance.ingestedAt.toISOString()
              : null,
        }
      : null,
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
