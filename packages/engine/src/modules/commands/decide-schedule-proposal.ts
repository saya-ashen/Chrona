import { db } from "@/lib/db";
import { applySchedule } from "@/modules/commands/apply-schedule";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function decideScheduleProposal(input: {
  proposalId: string;
  decision: "Accepted" | "Rejected";
  resolutionNote?: string;
}) {
  const proposal = await db.scheduleProposal.findUniqueOrThrow({
    where: { id: input.proposalId },
    include: { task: true },
  });

  if (proposal.status !== "Pending") {
    throw new Error("Only pending schedule proposals can be resolved.");
  }

  const resolvedProposal = await db.scheduleProposal.update({
    where: { id: proposal.id },
    data: {
      status: input.decision,
      resolvedAt: new Date(),
      resolutionNote: input.resolutionNote ?? null,
    },
  });

  if (input.decision === "Accepted") {
    const result = await applySchedule({
      taskId: proposal.taskId,
      dueAt: proposal.dueAt,
      scheduledStartAt: proposal.scheduledStartAt,
      scheduledEndAt: proposal.scheduledEndAt,
      scheduleSource: proposal.source,
    });

    return {
      ...result,
      proposalId: resolvedProposal.id,
    };
  }

  await rebuildTaskProjection(proposal.taskId);

  return {
    taskId: proposal.taskId,
    workspaceId: proposal.task.workspaceId,
    proposalId: resolvedProposal.id,
  };
}
