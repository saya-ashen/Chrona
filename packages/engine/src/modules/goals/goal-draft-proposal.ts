import { db, withDatabaseTransaction } from "@/lib/db";
import { goalDraftProposalSchema, type GoalDraftProposal } from "@chrona/contracts/api";
import { appendCanonicalEvent } from "../events";

/** Capture only: no Task, trigger, provider session, policy grant or review run. */
export async function proposeGoalDraft(input: {
  workspaceId: string;
  proposal: GoalDraftProposal;
  actorId: string;
  commandId: string;
}) {
  const proposal = goalDraftProposalSchema.parse(input.proposal);
  return withDatabaseTransaction(async () => {
    const goal = await db.goal.create({
      data: {
        workspaceId: input.workspaceId,
        title: proposal.title,
        description: proposal.description ?? null,
        status: "Draft",
        nextReviewAt: null,
        operationalBrief: {
          outcome: proposal.expectedOutcome,
          currentFocus: proposal.firstStep,
          strategy: proposal.rationale,
          constraints: [proposal.permissionRequest],
        },
        successCriteria: [{
          id: "proposed-outcome", kind: "user_confirmed",
          description: proposal.expectedOutcome, satisfied: false,
          confirmedAt: null, proposalStatus: "proposed",
        }],
      },
      select: { id: true },
    });
    await appendCanonicalEvent({
      eventType: "goal.created", workspaceId: input.workspaceId,
      actorType: "agent", actorId: input.actorId, source: "management_mcp",
      correlationId: input.commandId, dedupeKey: `management:${input.commandId}:goal-proposed`,
      summary: "Captured a proposed Goal; review required, no execution authorized",
      payload: { goal_id: goal.id, proposal_only: true, source_summary: proposal.sourceSummary },
    });
    return goal.id;
  });
}
