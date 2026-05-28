import { describe, expect, test } from "bun:test";
import type { AiProposalPreview, AiSidebarPageContextSummary } from "@chrona/contracts";
import { canConfirmProposal, replacePendingProposal, syncProposalConfirmability } from "../ai-sidebar/proposal-state";

const context: AiSidebarPageContextSummary = {
  type: "task",
  fingerprint: "task:a",
  title: "Task",
  primaryObjectLabel: "Task",
  taskId: "task-1",
  taskTitle: "Task",
  highlights: [],
  capabilities: ["smart-schedule"],
};

function proposal(overrides: Partial<AiProposalPreview> = {}): AiProposalPreview {
  return {
    id: "proposal-1",
    contextFingerprint: "task:a",
    createdAt: new Date(0).toISOString(),
    kind: "schedule",
    summary: "Schedule task",
    affectedAreas: ["schedule"],
    riskLevel: "low",
    explanation: "Synthetic schedule proposal",
    confirmability: "confirmable",
    taskPreview: null,
    schedulePreview: {
      selectedDate: "2026-05-28",
      placements: [],
      unplacedItems: [],
      conflictsResolved: [],
      conflictsRemaining: [],
    },
    ...overrides,
  };
}

describe("schedule proposal boundaries", () => {
  test("context changes make pending schedule proposals stale", () => {
    const synced = syncProposalConfirmability(proposal({ contextFingerprint: "task:old" }), context);

    expect(synced?.confirmability).toBe("stale");
    expect(canConfirmProposal(synced)).toBe(false);
  });

  test("applying and applied proposals are not downgraded by context drift", () => {
    expect(syncProposalConfirmability(proposal({ confirmability: "applying", contextFingerprint: "task:old" }), context)?.confirmability)
      .toBe("applying");
    expect(syncProposalConfirmability(proposal({ confirmability: "applied", contextFingerprint: "task:old" }), context)?.confirmability)
      .toBe("applied");
  });

  test("replacement proposal takes over stale pending decision", () => {
    const stale = proposal({ id: "stale", contextFingerprint: "task:old", confirmability: "stale" });
    const next = proposal({ id: "fresh", contextFingerprint: "task:a", confirmability: "confirmable" });

    expect(replacePendingProposal(stale, next)).toMatchObject({
      id: "fresh",
      contextFingerprint: "task:a",
      confirmability: "confirmable",
    });
  });
});
