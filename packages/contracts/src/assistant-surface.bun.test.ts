import { describe, expect, it } from "bun:test";
import type { AssistantActionResult, AssistantSurfaceState } from "./assistant-surface";

describe("assistant surface contracts", () => {
  it("represents surface state with summaries and quick actions", () => {
    const state: AssistantSurfaceState = {
      pageType: "schedule",
      fingerprint: "schedule:today",
      title: "Schedule context",
      primaryObjectLabel: "2026-05-19",
      status: "ready",
      topSummary: { id: "conflicts", label: "Conflicts", value: "1", severity: "critical" },
      summaries: [{ id: "conflicts", label: "Conflicts", value: "1", severity: "critical" }],
      quickActions: [{
        id: "handle-conflict",
        label: "Handle conflict",
        description: "Preview conflict resolution.",
        kind: "proposal",
        enabled: true,
        previewRequired: true,
        previewSurface: "schedule.timeline",
      }],
      recentProposals: [],
      requestInputEnabled: true,
    };

    expect(state.quickActions[0]?.previewSurface).toBe("schedule.timeline");
  });

  it("represents informational and proposal action results", () => {
    const informational: AssistantActionResult = { kind: "informational", message: "No blocker" };
    const proposal: AssistantActionResult = {
      kind: "proposal",
      message: "Preview created",
      route: { id: "p1", surface: "task.graph", label: "Retry node", href: "/tasks?p=p1", createdAt: "2026-05-19T00:00:00.000Z" },
    };

    expect(informational.kind).toBe("informational");
    expect(proposal.route.surface).toBe("task.graph");
  });
});
