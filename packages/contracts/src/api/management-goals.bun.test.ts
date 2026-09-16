import { describe, expect, it } from "bun:test";
import { managementGoalProposeSchema, managementGoalReadSchema, managementGoalSearchSchema } from "./management-goals.schema";
import { MANAGEMENT_ACCESS_PRESETS, MANAGEMENT_LEGACY_SCOPES, managementTools } from "./management.schema";

const proposal = {
  requestId: "7d657210-528a-4bca-9930-9ff462e3d471", title: "Research opportunities",
  rationale: "Sources change over time", firstStep: "Review the source list",
  expectedOutcome: "A verified shortlist", permissionRequest: "Ask before outreach",
  sourceSummary: "The user requested ongoing help",
};

describe("Goal capture contracts", () => {
  it("exposes a bounded proposal rather than arbitrary execution input", () => {
    expect(managementGoalProposeSchema.parse(proposal)).toMatchObject({ ...proposal, dryRun: false });
    expect(managementTools.chrona_goal_propose).toBe(managementGoalProposeSchema);
    for (const forbidden of ["workspaceId", "goalId", "approved", "scopes", "status", "start", "schedule", "aiClientId", "autoExecute"]) {
      expect(managementGoalProposeSchema.safeParse({ ...proposal, [forbidden]: "injected" }).success).toBe(false);
    }
  });

  it.each([
    ["title", 200], ["description", 5_000], ["rationale", 2_000], ["firstStep", 2_000],
    ["expectedOutcome", 2_000], ["permissionRequest", 2_000], ["sourceSummary", 1_000],
  ] as const)("bounds %s without silently truncating the saved proposal", (field, limit) => {
    expect(managementGoalProposeSchema.safeParse({ ...proposal, [field]: "x".repeat(limit) }).success).toBe(true);
    expect(managementGoalProposeSchema.safeParse({ ...proposal, [field]: "x".repeat(limit + 1) }).success).toBe(false);
  });

  it("rejects empty provenance, arbitrary statuses, invalid IDs and unbounded views", () => {
    expect(managementGoalProposeSchema.safeParse({ ...proposal, sourceSummary: " " }).success).toBe(false);
    expect(managementGoalProposeSchema.safeParse({ ...proposal, requestId: "retry" }).success).toBe(false);
    for (const invalid of [{ page: 0 }, { page: 1_001 }, { pageSize: 21 }, { status: "Running" }, { workspaceId: "other" }]) {
      expect(managementGoalSearchSchema.safeParse(invalid).success).toBe(false);
    }
    expect(managementGoalReadSchema.safeParse({ goalId: "goal", view: "raw" }).success).toBe(false);
    expect(managementGoalReadSchema.parse({ goalId: "goal" }).view).toBe("compact");
  });

  it("keeps historical read/full privileges fixed and assistant privileges non-executing", () => {
    expect(MANAGEMENT_ACCESS_PRESETS.full).toEqual(MANAGEMENT_LEGACY_SCOPES);
    expect(MANAGEMENT_ACCESS_PRESETS.read).toEqual(["tasks:read"]);
    expect(MANAGEMENT_ACCESS_PRESETS["assistant-read"]).toEqual(["goals:read"]);
    expect(MANAGEMENT_ACCESS_PRESETS.assistant).toEqual(["goals:read", "goals:propose"]);
    expect(MANAGEMENT_LEGACY_SCOPES).not.toContain("goals:read");
    expect(MANAGEMENT_LEGACY_SCOPES).not.toContain("goals:propose");
  });
});
