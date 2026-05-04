import { db } from "@/lib/db";

export async function ensureProposalInWorkspace(proposalId: string, workspaceId: string) {
  const proposal = await db.scheduleProposal.findUnique({
    where: { id: proposalId },
    select: { id: true, workspaceId: true },
  });

  if (!proposal) {
    throw new Error("Schedule proposal not found");
  }

  if (proposal.workspaceId !== workspaceId) {
    throw new Error("Schedule proposal not found");
  }

  return proposal;
}
