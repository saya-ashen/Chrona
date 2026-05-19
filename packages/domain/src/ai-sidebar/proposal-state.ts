import type { AiProposalPreview, AiSidebarPageContextSummary } from "@chrona/contracts";

export function isProposalStale(
  proposal: Pick<AiProposalPreview, "contextFingerprint"> | null,
  context: Pick<AiSidebarPageContextSummary, "fingerprint">,
) {
  return Boolean(proposal && proposal.contextFingerprint !== context.fingerprint);
}

export function syncProposalConfirmability(
  proposal: AiProposalPreview | null,
  context: Pick<AiSidebarPageContextSummary, "fingerprint">,
): AiProposalPreview | null {
  if (!proposal) return null;
  if (proposal.confirmability === "applying" || proposal.confirmability === "applied") return proposal;
  return isProposalStale(proposal, context)
    ? { ...proposal, confirmability: "stale" }
    : { ...proposal, confirmability: "confirmable" };
}

export function canConfirmProposal(proposal: AiProposalPreview | null) {
  return proposal?.confirmability === "confirmable";
}

export function replacePendingProposal(
  current: AiProposalPreview | null,
  next: AiProposalPreview,
) {
  if (!current) return next;
  return { ...next, contextFingerprint: next.contextFingerprint };
}
