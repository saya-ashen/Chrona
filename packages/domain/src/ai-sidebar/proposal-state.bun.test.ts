import { describe, expect, test } from "vitest";
import { canConfirmProposal, isProposalStale, syncProposalConfirmability } from "./proposal-state";
import type { AiProposalPreview, AiSidebarPageContextSummary } from "@chrona/contracts";

const context: AiSidebarPageContextSummary = {
  type: "unsupported",
  fingerprint: "a",
  title: "Context",
  primaryObjectLabel: "Page",
  highlights: [],
  capabilities: ["general-help"],
};

const proposal: AiProposalPreview = {
  id: "p1",
  contextFingerprint: "a",
  createdAt: new Date(0).toISOString(),
  kind: "informational",
  summary: "Summary",
  affectedAreas: [],
  riskLevel: "low",
  explanation: "Explanation",
  confirmability: "confirmable",
  taskPreview: null,
  schedulePreview: null,
};

describe("proposal state", () => {
  test("compares proposal and context fingerprints", () => {
    expect(isProposalStale(proposal, context)).toBe(false);
    expect(isProposalStale({ ...proposal, contextFingerprint: "b" }, context)).toBe(true);
  });

  test("marks pending proposals stale on material context changes", () => {
    expect(syncProposalConfirmability({ ...proposal, contextFingerprint: "b" }, context)?.confirmability).toBe("stale");
  });

  test("confirms only confirmable proposals", () => {
    expect(canConfirmProposal(proposal)).toBe(true);
    expect(canConfirmProposal({ ...proposal, confirmability: "stale" })).toBe(false);
  });
});
