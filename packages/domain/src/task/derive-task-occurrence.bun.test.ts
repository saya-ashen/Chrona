import { describe, expect, it } from "bun:test";

import {
  assertOccurrenceTransition,
  deriveOccurrenceNextAction,
  deriveTaskDefinitionStatus,
  selectFocusedOccurrence,
} from "./derive-task-occurrence";

const occurrence = (id: string, status: Parameters<typeof deriveOccurrenceNextAction>[0], eligibleAt: string) => ({
  id,
  status: status!,
  eligibleAt,
  materializedAt: eligibleAt,
});

describe("task occurrence derivation", () => {
  it("keeps a series active after a completed occurrence", () => {
    expect(deriveTaskDefinitionStatus({
      current: "Active",
      executionMode: "series",
      occurrences: [occurrence("done", "Completed", "2026-07-01T00:00:00.000Z")],
      hasAcceptedResult: true,
    })).toBe("Active");
  });

  it("completes a single definition only after accepted result", () => {
    expect(deriveTaskDefinitionStatus({ current: "Active", executionMode: "single", occurrences: [], hasAcceptedResult: true })).toBe("Completed");
    expect(deriveTaskDefinitionStatus({ current: "Active", executionMode: "single", occurrences: [], hasAcceptedResult: false })).toBe("Active");
  });

  it("focuses active then actionable then latest occurrences", () => {
    const rows = [
      occurrence("latest-ready", "Ready", "2026-07-03T00:00:00.000Z"),
      occurrence("waiting", "WaitingForApproval", "2026-07-01T00:00:00.000Z"),
      occurrence("completed", "Completed", "2026-07-04T00:00:00.000Z"),
    ];
    expect(selectFocusedOccurrence(rows)?.id).toBe("waiting");
    expect(selectFocusedOccurrence(rows.filter((row) => row.id !== "waiting"))?.id).toBe("latest-ready");
  });

  it("keeps input and approval actions distinct", () => {
    expect(deriveOccurrenceNextAction("WaitingForInput")).toBe("provide_input");
    expect(deriveOccurrenceNextAction("WaitingForApproval")).toBe("review_approval");
  });

  it("rejects terminal mutation and illegal simultaneous states", () => {
    expect(() => assertOccurrenceTransition("Completed", "Running")).toThrow(/Terminal occurrence/);
    expect(() => assertOccurrenceTransition("Ready", "WaitingForInput")).toThrow(/Invalid occurrence transition/);
  });
});
