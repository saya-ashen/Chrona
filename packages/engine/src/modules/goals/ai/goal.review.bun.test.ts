import { describe, expect, it } from "bun:test";
import { createAiRunResultSchema } from "@chrona/contracts/ai-feature-runtime";
import {
  goalReviewFeature,
  goalReviewFeatureInput,
  goalReviewOutputV2Schema,
  goalReviewSnapshotHash,
  mapGoalReviewActionsToProposalItems,
  validateGoalReviewCompletedTerminal,
  type GoalReviewSnapshot,
} from "./goal.review";

const at = "2026-07-28T12:00:00.000Z";
const overviewId = `goal-review-overview-${"a".repeat(64)}`;
const evidence = [{ observationId: overviewId }];
const observations = [{ observationId: overviewId, type: { id: "goal.review.overview", version: 3 }, key: "proposal-1", revision: "r1", observedAt: at, canonicalizerId: "chrona.stable-json.v1", hashAlgorithm: "sha256" as const, contentHash: `sha256:${"a".repeat(64)}`, data: { source: "test" } }];

const snapshot: GoalReviewSnapshot = {
  schemaVersion: 2,
  capturedAt: at,
  mode: "progress" as const,
  goal: { id: "goal-1", title: "Ship review coverage", description: null, operationalBrief: null, nextReviewAt: null, successCriteria: [], updatedAt: at },
  tasks: [{ id: "task-1", title: "Produce accepted evidence", description: null, status: "Done", updatedAt: at, acceptedResult: { artifacts: [{ id: "artifact-1", title: "accepted.txt" }] } }],
  evidenceCatalog: [{ type: "goal" as const, id: "goal-1" }, { type: "artifact" as const, id: "artifact-1" }],
};

const input = {
  proposalId: "proposal-1",
  proposalStateVersion: 3,
  snapshotHash: goalReviewSnapshotHash(snapshot),
  snapshot,
  answerLineage: [],
};

const output = {
  schemaVersion: 2 as const,
  summary: "A bounded review finding.",
  findings: [{ findingId: "finding-1", rationale: "Accepted artifact supports the update.", evidence }],
};

function action(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: "finding-1",
    action: { id: "goal.guidance.update", version: 1 },
    input: { findingId: "finding-1", evidenceRefs: [{ type: "artifact", id: "artifact-1" }], field: "currentFocus", value: "Review accepted evidence" },
    rationale: "Accepted artifact supports the update.",
    evidence,
    ...overrides,
  };
}


describe("Goal Review v3 feature contract", () => {
  it("declares six typed frozen seeds and three proposal actions", () => {
    const seeds = goalReviewFeature.manifest.observations.filter(({ delivery }) => delivery.kind === "seed");

    expect(goalReviewFeature.feature).toEqual({ id: "goal.review", version: 3 });
    expect(seeds.map(({ observation }) => observation.id)).toEqual([
      "goal.review.overview", "goal.review.guidance", "goal.review.criteria", "goal.review.tasks", "goal.review.execution_summaries", "goal.review.accepted_artifacts",
    ]);
    expect(goalReviewFeature.manifest.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: { id: "goal.guidance.update", version: 1 }, mode: "propose" }),
      expect.objectContaining({ action: { id: "task.create_for_goal", version: 1 }, mode: "propose" }),
      expect.objectContaining({ action: { id: "goal.review.schedule", version: 1 }, mode: "propose" }),
    ]));
    expect(goalReviewFeature.actions.filter(({ binding }) => binding.mode === "propose").every(({ execute }) => execute === undefined)).toBe(true);
  });

  it("strictly parses frozen v3 input, answer lineage, and its stale-apply version precondition", () => {
    const parsed = goalReviewFeatureInput({ ...input, answerLineage: [{ questionId: "scope", answer: { scope: "narrow" }, answeredAt: at }] });

    expect(parsed).toMatchObject({ proposalStateVersion: 3, answerLineage: [{ questionId: "scope", answer: { scope: "narrow" } }] });
    expect(() => goalReviewFeatureInput({ ...input, snapshotHash: "sha256:not-a-hash" })).toThrow();
    expect(() => goalReviewFeatureInput({ ...input, proposalStateVersion: -1 })).toThrow();
    expect(() => goalReviewFeatureInput({ ...input, unexpected: true })).toThrow();
    expect(() => goalReviewFeatureInput({ ...input, snapshot: { ...input.snapshot, schemaVersion: 1 } })).toThrow();
  });

  it("validates the immutable input snapshot and catalog during completion", () => {
    const completed = { status: "completed" as const, output, artifacts: [], proposedActions: [action()], evidence };
    const valid = goalReviewFeature.validateCompletion({ workspaceId: "workspace-1", subject: { type: "goal_review_proposal", id: "proposal-1" }, input, result: completed, observations });
    const hashMismatch = goalReviewFeature.validateCompletion({ workspaceId: "workspace-1", subject: { type: "goal_review_proposal", id: "proposal-1" }, input: { ...input, snapshotHash: `sha256:${"b".repeat(64)}` }, result: completed, observations });
    const snapshotWithoutArtifact = { ...snapshot, evidenceCatalog: [{ type: "goal" as const, id: "goal-1" }] };
    const catalogMismatch = goalReviewFeature.validateCompletion({ workspaceId: "workspace-1", subject: { type: "goal_review_proposal", id: "proposal-1" }, input: { ...input, snapshot: snapshotWithoutArtifact, snapshotHash: goalReviewSnapshotHash(snapshotWithoutArtifact) }, result: completed, observations });

    expect(valid).toMatchObject({ valid: true, issues: [] });
    expect(hashMismatch.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "snapshot_invalid" })]));
    expect(catalogMismatch.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "action_evidence_invalid" })]));
  });


  it("accepts strict V2 completed, NeedsInput, and CannotComplete terminal envelopes", () => {
    const terminalSchema = createAiRunResultSchema(goalReviewOutputV2Schema, goalReviewOutputV2Schema);

    expect(goalReviewOutputV2Schema.safeParse({ ...output, extra: true }).success).toBe(false);
    expect(goalReviewOutputV2Schema.safeParse({ ...output, findings: [...output.findings, output.findings[0]] }).success).toBe(false);
    expect(terminalSchema.safeParse({ status: "completed", output, artifacts: [], proposedActions: [action()], evidence }).success).toBe(true);
    expect(terminalSchema.safeParse({ status: "needs_input", questions: [{ questionId: "scope", prompt: "What is in scope?", answerSchema: { type: "object" }, reason: "Bound the review." }] }).success).toBe(true);
    expect(terminalSchema.safeParse({ status: "cannot_complete", reason: { code: "missing_evidence", message: "Accepted evidence is unavailable." }, missingObservations: [{ id: "goal.review.accepted_artifacts", version: 3 }] }).success).toBe(true);
  });

  it("rejects fabricated evidence, unallowed or malformed actions, stale catalog evidence, and non-1:1 findings", () => {
    const valid = validateGoalReviewCompletedTerminal({ output, proposedActions: [action()], observations: evidence, snapshot: input.snapshot });
    const fabricated = validateGoalReviewCompletedTerminal({ output, proposedActions: [action()], observations: [], snapshot: input.snapshot });
    const unallowed = validateGoalReviewCompletedTerminal({ output, proposedActions: [action({ action: { id: "goal.delete", version: 1 } })], observations: evidence, snapshot: input.snapshot });
    const malformed = validateGoalReviewCompletedTerminal({ output, proposedActions: [action({ input: { findingId: "finding-1" } })], observations: evidence, snapshot: input.snapshot });
    const invalidConstraints = validateGoalReviewCompletedTerminal({ output, proposedActions: [action({ input: { ...action().input, field: "constraints", value: "No external writes" } })], observations: evidence, snapshot: input.snapshot });
    const validConstraints = validateGoalReviewCompletedTerminal({ output, proposedActions: [action({ input: { ...action().input, field: "constraints", value: ["No external writes"] } })], observations: evidence, snapshot: input.snapshot });
    const staleCatalog = validateGoalReviewCompletedTerminal({ output, proposedActions: [action({ input: { ...action().input, evidenceRefs: [{ type: "artifact", id: "not-frozen" }] } })], observations: evidence, snapshot: input.snapshot });
    const missing = validateGoalReviewCompletedTerminal({ output, proposedActions: [], observations: evidence, snapshot: input.snapshot });

    expect(valid).toEqual({ valid: true, issues: [] });
    expect(fabricated.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "finding_evidence_invalid" })]));
    expect(unallowed.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "action_not_allowed" })]));
    expect(malformed.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "action_not_allowed" })]));
    expect(invalidConstraints.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "action_not_allowed" })]));
    expect(validConstraints).toEqual({ valid: true, issues: [] });
    expect(staleCatalog.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "action_evidence_invalid" })]));
    expect(missing.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "finding_action_alignment" })]));
  });

  it("deterministically maps valid actions to sorted legacy proposal materializations", () => {
    const secondOutput = { ...output, findings: [{ findingId: "finding-2", rationale: "Schedule the review.", evidence }, ...output.findings] };
    const schedule = action({ proposalId: "finding-2", action: { id: "goal.review.schedule", version: 1 }, input: { findingId: "finding-2", evidenceRefs: [{ type: "goal", id: "goal-1" }], nextReviewAt: "2026-08-01T00:00:00.000Z" }, rationale: "Schedule the review." });

    const materialized = mapGoalReviewActionsToProposalItems({ output: secondOutput, proposedActions: [schedule, action()], snapshot: input.snapshot });

    expect(materialized.map(({ itemId, kind }) => ({ itemId, kind }))).toEqual([
      { itemId: "finding-1", kind: "brief_field" },
      { itemId: "finding-2", kind: "next_review_at" },
    ]);
    expect(materialized[0]).toMatchObject({ payload: { field: "currentFocus", value: "Review accepted evidence" }, evidenceRefs: [{ type: "artifact", id: "artifact-1" }] });
    expect(materialized[1]).toMatchObject({ payload: { value: "2026-08-01T00:00:00.000Z" }, dependencySnapshot: { value: null } });
  });
});
