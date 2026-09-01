import { describe, expect, it } from "bun:test";
import type { CheckpointForm } from "@chrona/contracts/ai";
import { validateManualCompletionSubmission } from "./manual-completion-submission";

const form: CheckpointForm = {
  revision: "sha256:form-v1",
  source: "runtime_ai",
  validated: true,
  instructions: "Record the plant inspection.",
  submitLabel: "Complete and continue",
  inputFields: [
    { kind: "text", name: "inspection", label: "Inspection results", multiline: true, required: true },
    {
      kind: "choice",
      name: "watering",
      label: "Watering performed",
      selection: "single",
      required: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
    { kind: "boolean", name: "allChecked", label: "All plants checked" },
  ],
};

describe("manual completion submission", () => {
  it("validates the persisted schema and builds a bounded readable summary", () => {
    const result = validateManualCompletionSubmission({
      form,
      payload: {
        formRevision: form.revision,
        inputFields: {
          inspection: "Basil dry; mint healthy",
          watering: "yes",
          allChecked: true,
        },
      },
    });
    expect(result.inputFields).toEqual({
      inspection: "Basil dry; mint healthy",
      watering: "yes",
      allChecked: true,
    });
    expect(result.summary).toContain("Inspection results: Basil dry; mint healthy");
  });

  it("rejects stale revisions", () => {
    expect(() => validateManualCompletionSubmission({
      form,
      payload: { formRevision: "sha256:old", inputFields: { inspection: "Done", watering: "yes" } },
    })).toThrow("form changed");
  });

  it("rejects missing, unknown, and invalid choice fields", () => {
    expect(() => validateManualCompletionSubmission({
      form,
      payload: { formRevision: form.revision, inputFields: { watering: "yes" } },
    })).toThrow("Inspection results");
    expect(() => validateManualCompletionSubmission({
      form,
      payload: { formRevision: form.revision, inputFields: { inspection: "Done", watering: "yes", extra: "x" } },
    })).toThrow("Unknown manual completion field");
    expect(() => validateManualCompletionSubmission({
      form,
      payload: { formRevision: form.revision, inputFields: { inspection: "Done", watering: "maybe" } },
    })).toThrow("invalid choice");
  });
});
