import { describe, expect, it } from "bun:test";
import { z } from "zod";

import {
  actionBindingSchema,
  aiContractRefSchema,
  aiFeatureManifestSchema,
  aiFeatureRunDtoSchema,
  aiJsonObjectSchema,
  aiObservationEnvelopeSchema,
  aiObjectiveSchema,
  aiRunResultSchema,
  aiFeatureRuntimeErrorCodeSchema,
  artifactBindingSchema,
  createAiRunResultSchema,
  evidenceReferenceSchema,
  observationBindingSchema,
  userQuestionSchema,
} from "./index";

const ref = { id: "goal.overview", version: 1 };
const now = "2026-03-20T12:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;

const manifest: z.input<typeof aiFeatureManifestSchema> = {
  schemaVersion: 1,
  feature: { id: "goal.review", version: 2 },
  description: "Review a goal from its frozen observations.",
  input: { id: "goal.review.input", version: 2 },
  observations: [],
  actions: [],
  artifacts: [],
  output: { id: "goal.review.output", version: 2 },
  completion: { id: "goal.review.completion", version: 2 },
  supportedTerminalStatuses: ["completed", "needs_input", "cannot_complete"],
};

describe("AI feature runtime contracts", () => {
  it("enforces stable contract IDs, positive bounded versions, and closed objects", () => {
    expect(aiContractRefSchema.parse(ref)).toEqual(ref);
    expect(aiContractRefSchema.safeParse({ ...ref, version: 0 }).success).toBeFalse();
    expect(aiContractRefSchema.safeParse({ id: "Goal.overview", version: 1 }).success).toBeFalse();
    expect(aiContractRefSchema.safeParse({ ...ref, provider: "codex" }).success).toBeFalse();
  });

  it("parses only strict manifests and retains explicit versioned bindings", () => {
    expect(aiFeatureManifestSchema.parse(manifest)).toEqual(manifest);
    expect(aiFeatureManifestSchema.safeParse({ ...manifest, unknown: true }).success).toBeFalse();
    expect(
      aiObjectiveSchema.safeParse({
        statement: "Review the goal.",
        expectedOutcome: "A bounded recommendation.",
        successCriteria: [],
        constraints: [],
      }).success,
    ).toBeFalse();
    expect(
      aiFeatureManifestSchema.safeParse({
        ...manifest,
        supportedTerminalStatuses: ["completed", "completed"],
      }).success,
    ).toBeFalse();
  });

  it("enforces observation delivery and bounded, hashed observation envelopes", () => {
    expect(
      observationBindingSchema.parse({
        observation: ref,
        delivery: { kind: "on_demand", viaAction: { id: "goal.detail.read", version: 1 } },
        required: true,
        maxItems: 10,
        maxBytes: 1024,
      }),
    ).toMatchObject({ delivery: { kind: "on_demand" } });
    expect(
      observationBindingSchema.safeParse({
        observation: ref,
        delivery: { kind: "seed", fromAction: ref },
        required: true,
      }).success,
    ).toBeFalse();
    expect(
      aiObservationEnvelopeSchema.parse({
        observationId: "observation-1",
        type: ref,
        key: "goal:1",
        revision: "revision-1",
        observedAt: now,
        canonicalizerId: "chrona.stable-json.v1",
        hashAlgorithm: "sha256",
        contentHash: hash,
        data: { title: "Goal" },
      }),
    ).toMatchObject({ data: { title: "Goal" } });
    expect(
      aiObservationEnvelopeSchema.safeParse({
        observationId: "observation-1",
        type: ref,
        key: "goal:1",
        revision: "revision-1",
        observedAt: now,
        canonicalizerId: "chrona.stable-json.v1",
        hashAlgorithm: "sha256",
        contentHash: hash,
        data: ["not an object"],
      }).success,
    ).toBeFalse();
  });

  it("separates invoke from propose bindings and closes artifact bindings", () => {
    expect(
      actionBindingSchema.parse({
        action: { id: "goal.detail.read", version: 1 },
        mode: "invoke",
        executionSemantics: "read_only",
      }),
    ).toMatchObject({ mode: "invoke" });
    expect(
      actionBindingSchema.safeParse({ action: ref, mode: "invoke" }).success,
    ).toBeFalse();
    expect(
      actionBindingSchema.safeParse({
        action: ref,
        mode: "propose",
        executionSemantics: "read_only",
      }).success,
    ).toBeFalse();
    expect(
      artifactBindingSchema.safeParse({
        artifactType: { id: "task.report", version: 1 },
        provenancePolicy: { id: "task.run.provenance", version: 1 },
        requireContentHash: true,
        extra: "rejected",
      }).success,
    ).toBeFalse();
  });

  it("accepts only the three terminal result branches and excludes cross-branch fields", () => {
    expect(
      aiRunResultSchema.parse({
        status: "completed",
        output: { summary: "Done" },
        artifacts: [
          {
            artifactRef: "artifact-1",
            artifactType: { id: "task.report", version: 1 },
            title: "Report",
            contentHash: hash,
          },
        ],
        proposedActions: [],
        evidence: [{ observationId: "observation-1", path: "/summary", quoteHash: hash }],
      }),
    ).toMatchObject({ status: "completed" });
    expect(
      aiRunResultSchema.parse({
        status: "needs_input",
        questions: [
          {
            questionId: "audience",
            prompt: "Who is the intended audience?",
            answerSchema: { type: "object", properties: {} },
            reason: "The audience changes the recommendation.",
          },
        ],
        partialOutput: { outline: "Prepared" },
      }),
    ).toMatchObject({ status: "needs_input" });
    expect(
      aiRunResultSchema.parse({
        status: "cannot_complete",
        reason: { code: "missing_scope", message: "No source scope was provided." },
        missingObservations: [{ id: "goal.source-scope", version: 1 }],
      }),
    ).toMatchObject({ status: "cannot_complete" });
    expect(
      aiRunResultSchema.safeParse({
        status: "cannot_complete",
        reason: { code: "provider_unsupported", message: "The selected provider cannot satisfy the action contract." },
        missingObservations: [],
      }).success,
    ).toBeTrue();
    expect(
      aiRunResultSchema.safeParse({
        status: "needs_input",
        questions: [
          {
            questionId: "duplicate",
            prompt: "One?",
            answerSchema: { type: "object" },
            reason: "Needed.",
          },
          {
            questionId: "duplicate",
            prompt: "Two?",
            answerSchema: { type: "object" },
            reason: "Needed.",
          },
        ],
      }).success,
    ).toBeFalse();
    expect(
      aiRunResultSchema.safeParse({
        status: "cannot_complete",
        reason: { code: "missing_scope", message: "No scope." },
        missingObservations: [ref],
        artifacts: [],
      }).success,
    ).toBeFalse();
  });

  it("supports bounded JSON answer roots and validates generic output and partial schemas independently", () => {
    expect(
      userQuestionSchema.safeParse({
        questionId: "audience",
        prompt: "Who is the intended audience?",
        answerSchema: { type: "string" },
        reason: "Needed for a useful answer.",
      }).success,
    ).toBeTrue();
    expect(
      userQuestionSchema.safeParse({
        questionId: "priorities",
        prompt: "Which priorities matter?",
        answerSchema: { type: "array", items: { type: "string" } },
        reason: "Needed for prioritization.",
      }).success,
    ).toBeTrue();
    expect(
      evidenceReferenceSchema.safeParse({ observationId: "observation-1", path: "summary" }).success,
    ).toBeFalse();
    const resultSchema = createAiRunResultSchema(
      z.object({ summary: z.string().min(1) }).strict(),
      z.object({ draft: z.string().min(1) }).strict(),
    );
    expect(
      resultSchema.safeParse({
        status: "completed",
        output: { summary: "Ready" },
        artifacts: [],
        proposedActions: [],
        evidence: [],
      }).success,
    ).toBeTrue();
    expect(
      resultSchema.safeParse({
        status: "needs_input",
        questions: [
          {
            questionId: "audience",
            prompt: "Who is the intended audience?",
            answerSchema: { type: "object" },
            reason: "Needed.",
          },
        ],
        partialOutput: { summary: "wrong schema" },
      }).success,
    ).toBeFalse();
  });

  it("uses stable runtime errors and strict run/action/status DTOs", () => {
    expect(aiFeatureRuntimeErrorCodeSchema.parse("provider_capability_mismatch")).toBe(
      "provider_capability_mismatch",
    );
    expect(aiFeatureRuntimeErrorCodeSchema.safeParse("provider exploded").success).toBeFalse();
    expect(
      aiFeatureRunDtoSchema.safeParse({
        id: "run-1",
        workspaceId: "workspace-1",
        feature: { id: "goal.review", version: 2 },
        manifest,
        subject: { type: "goal_review_proposal", id: "proposal-1" },
        operation: { kind: "initial", operationId: "operation-1" },
        status: "running",
        stateVersion: 1,
        attempt: 1,
        objective: {
          statement: "Review the goal.",
          expectedOutcome: "A complete recommendation.",
          successCriteria: ["Use frozen observations."],
          constraints: ["Do not change the goal."],
        },
        createdAt: now,
        updatedAt: now,
        providerRef: "must not leak",
      }).success,
    ).toBeFalse();
  });

  it("keeps the generic JSON object root bounded", () => {
    expect(aiJsonObjectSchema.safeParse({ nested: { value: true } }).success).toBeTrue();
    expect(aiJsonObjectSchema.safeParse(["array roots are rejected"]).success).toBeFalse();
  });
});
