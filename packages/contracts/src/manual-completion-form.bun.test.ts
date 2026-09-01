import { describe, expect, it } from "bun:test";
import {
  manualCompletionFormSchema,
  planBlueprintSchema,
} from "./ai-plan-blueprint";

const form = {
  instructions: "Record what you completed.",
  submitLabel: "Complete and continue",
  inputFields: [
    {
      kind: "text" as const,
      name: "completionSummary",
      label: "Completion summary",
      multiline: true,
      required: true,
    },
  ],
};

function blueprint(node: Record<string, unknown>) {
  return {
    title: "Manual plan",
    goal: "Complete the task",
    assumptions: [],
    nodes: [{ id: "manual_step", type: "task", title: "Manual step", ...node }],
    edges: [],
  };
}

describe("manual completion form contracts", () => {
  it("requires a completion form for new manual task blueprints", () => {
    const parsed = planBlueprintSchema.safeParse(blueprint({ executor: "user", mode: "manual" }));
    expect(parsed.success).toBe(false);
  });

  it("forbids completion forms on automatic task blueprints", () => {
    const parsed = planBlueprintSchema.safeParse(blueprint({ executor: "ai", mode: "auto", completionForm: form }));
    expect(parsed.success).toBe(false);
  });

  it("accepts a structured completion form on a manual task blueprint", () => {
    const parsed = planBlueprintSchema.safeParse(blueprint({ executor: "user", mode: "manual", completionForm: form }));
    expect(parsed.success).toBe(true);
  });

  it("rejects duplicate fields and sensitive requests", () => {
    const duplicate = manualCompletionFormSchema.safeParse({
      ...form,
      inputFields: [form.inputFields[0], form.inputFields[0]],
    });
    const sensitive = manualCompletionFormSchema.safeParse({
      ...form,
      inputFields: [{ kind: "text", name: "apiKey", label: "API key", required: true }],
    });
    expect(duplicate.success).toBe(false);
    expect(sensitive.success).toBe(false);
  });
});
