import { describe, expect, it } from "bun:test";
import { managementGoalProposeSchema, managementGoalReadSchema, managementGoalSearchSchema, managementGoalUpdateSchema } from "./management-goals.schema";
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
    expect(MANAGEMENT_ACCESS_PRESETS["assistant-edit"]).toEqual(["goals:read", "goals:propose", "goals:write"]);
  });
});

describe("Goal editing contracts", () => {
  const input = { requestId: proposal.requestId, goalId: "existing", expectedRevision: "goal-config-v1:1", reason: "User narrowed the region", patch: { brief: { currentFocus: "Europe" } } };
  it("accepts partial edits and standalone notes, not empty operations or snapshot revisions", () => {
    expect(managementGoalUpdateSchema.parse(input).dryRun).toBe(false);
    const { patch: _, ...base } = input;
    expect(managementGoalUpdateSchema.safeParse({ ...base, note: { kind: "decision", text: "Focus on Europe" } }).success).toBe(true);
    for (const invalid of [base, { ...input, patch: {} }, { ...input, patch: { brief: {} } }, { ...input, expectedRevision: "goal-snapshot-v1:abc" }, { ...input, reason: " " }]) expect(managementGoalUpdateSchema.safeParse(invalid).success).toBe(false);
  });
  it("rejects injected grants, execution, lifecycle and confirmation fields at every level", () => {
    for (const name of ["workspaceId", "approved", "status", "schedule", "permissions", "aiClientId"]) {
      expect(managementGoalUpdateSchema.safeParse({ ...input, [name]: "injected" }).success).toBe(false);
      expect(managementGoalUpdateSchema.safeParse({ ...input, patch: { [name]: "injected" } }).success).toBe(false);
    }
    for (const name of ["satisfied", "confirmedAt", "evidenceArtifactIds", "proposalStatus"]) expect(managementGoalUpdateSchema.safeParse({ ...input, patch: { criteria: [{ operation: "revise", id: "fit", description: "New meaning", [name]: true }] } }).success).toBe(false);
    expect(managementGoalUpdateSchema.safeParse({ ...input, patch: { brief: { currentFocus: "Europe", policyGrant: true } } }).success).toBe(false);
  });
  it("bounds text, criterion operations, IDs and history pagination", () => {
    for (const patch of [{ title: "x".repeat(201) }, { description: "x".repeat(5_001) }, { brief: { constraints: Array(17).fill("bound") } }, { criteria: [{ operation: "add", id: "same", description: "One" }, { operation: "remove", id: "same" }] }, { criteria: [] }]) expect(managementGoalUpdateSchema.safeParse({ ...input, patch }).success).toBe(false);
    expect(managementGoalReadSchema.safeParse({ goalId: "goal", view: "history", pageSize: 21 }).success).toBe(false);
    expect(managementGoalUpdateSchema.safeParse({ ...input, note: { kind: "progress", text: "x".repeat(2_001) } }).success).toBe(false);
  });
});
