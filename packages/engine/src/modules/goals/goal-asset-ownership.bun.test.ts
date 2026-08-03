import { describe, expect, it } from "bun:test";
import { __goalAssetOwnershipTestHooks } from "./goal-asset-ownership";

const input = {
  schemaVersion: 1,
  snapshotHash: `sha256:${"a".repeat(64)}`,
  snapshot: {
    candidate: {
      id: "candidate-1",
      goalId: "goal-1",
      kind: "document",
      label: "Accepted report",
      content: { summary: "Completed" },
      contentHash: "content-hash-1",
      ruleRecommendation: {
        action: "create_asset",
        targetAssetId: null,
        reason: "No equivalent asset exists.",
      },
    },
    provenance: {
      acceptedTaskId: "task-1",
      acceptedTaskTitle: "Complete report",
      acceptedRunId: "run-1",
      artifactId: null,
      artifactTitle: null,
      artifactType: null,
      artifactContentPreview: null,
    },
    candidateAssets: [],
  },
};

describe("goal asset ownership provider protocol", () => {
  it("requires a bounded snapshot before provider invocation", () => {
    expect(__goalAssetOwnershipTestHooks.parseInput(input)).toMatchObject({
      snapshotHash: input.snapshotHash,
      schemaVersion: 1,
    });
    expect(() => __goalAssetOwnershipTestHooks.parseInput({
      ...input,
      snapshotHash: "not-a-hash",
    })).toThrow();
  });

  it("rejects malformed provider payloads before proposal persistence", () => {
    expect(() => __goalAssetOwnershipTestHooks.parsePayload({
      parsed: {
        schemaVersion: 1,
        decision: "append_version",
        targetAssetId: null,
        proposedLabel: "Report",
        rationale: "Matches an existing asset.",
        differenceSummary: "Adds details.",
        certainty: "high",
        evidence: ["Same title"],
      },
    })).toThrow();
  });
});
