import { describe, expect, it } from "bun:test";
import {
  manualCompletionFormReviewFeature,
  manualCompletionFormReviewInputSchema,
} from "./manual-completion-form-review";

const form = {
  instructions: "Record the result of the manual step.",
  submitLabel: "Complete and continue",
  inputFields: [{
    kind: "text" as const,
    name: "resultSummary",
    label: "Result summary",
    multiline: true,
    required: true,
  }],
};

function input(candidateForm: typeof form | null) {
  return manualCompletionFormReviewInputSchema.parse({
    task: { id: "task-1", title: "Water balcony plants", description: null },
    plan: { title: "Plant care", goal: "Water and inspect plants", assumptions: [] },
    node: {
      id: "node-1",
      title: "Inspect every plant",
      objective: "Inspect soil and leaves",
      expectedOutput: "Per-plant inspection results",
      completionCriteria: "Every plant has been checked",
    },
    candidateForm,
    relevantPreviousResults: [],
  });
}

async function validate(candidateForm: typeof form | null, output: unknown) {
  const featureInput = input(candidateForm);
  const observations = await Promise.all(manualCompletionFormReviewFeature.observations.map((definition) =>
    definition.build({ workspaceId: "workspace-1", subject: { type: "task_node_attempt", id: "attempt-1" }, input: featureInput }),
  ));
  return manualCompletionFormReviewFeature.validateCompletion({
    workspaceId: "workspace-1",
    subject: { type: "task_node_attempt", id: "attempt-1" },
    input: featureInput,
    result: {
      status: "completed",
      output: output as never,
      artifacts: [],
      proposedActions: [],
      evidence: [],
    },
    observations,
  });
}

describe("manual completion form AI review contract", () => {
  it("keeps a valid candidate when the provider says it is sufficient", async () => {
    expect((await validate(form, { verdict: "sufficient" })).valid).toBe(true);
  });

  it("requires a full replacement when the historical plan has no form", async () => {
    expect((await validate(null, { verdict: "sufficient" })).valid).toBe(false);
    expect((await validate(null, { verdict: "replace", form })).valid).toBe(true);
  });

  it("rejects policy-invalid replacement forms", async () => {
    const result = await validate(null, {
      verdict: "replace",
      form: {
        ...form,
        inputFields: [{ kind: "text", name: "password", label: "Password", required: true }],
      },
    });
    expect(result.valid).toBe(false);
  });
});
