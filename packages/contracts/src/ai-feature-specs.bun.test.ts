import { describe, expect, it } from "bun:test";

import {
  SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
  buildSuggestFeatureSpec,
  GENERATE_TASK_PLAN_GRAPH_TOOL_NAME,
  buildGeneratePlanFeatureSpec,
  validatePreparedFeaturePayload,
} from "./ai";

describe("generate_plan feature spec", () => {
  it("builds a provider-agnostic feature spec with structured tool requirements", () => {
    const spec = buildGeneratePlanFeatureSpec({
      taskId: "task-1",
      title: "制作一个汉堡",
      description: "准备食材并完成烹饪",
      estimatedMinutes: 60,
    });

    expect(spec).toMatchObject({
      feature: "generate_plan",
      toolChoice: "required",
      requiredTool: {
        type: "function",
        name: GENERATE_TASK_PLAN_GRAPH_TOOL_NAME,
      },
    });
    expect(spec.instructions).toContain("You MUST call the business tool generate_task_plan_graph.");
    expect(spec.inputText).toContain("Title: 制作一个汉堡");
    expect(spec.inputText).toContain("Estimated duration: 60 minutes");
  });

  it("validates generate_plan tool payloads through the shared contract", () => {
    const spec = buildGeneratePlanFeatureSpec({
      title: "制作一个汉堡",
    });

    expect(
      validatePreparedFeaturePayload(spec, {
        title: "汉堡制作计划",
        goal: "完成汉堡制作",
        nodes: [{ id: "prepare", type: "task", title: "准备食材" }],
        edges: [],
      }),
    ).toEqual({ ok: true });

    expect(
      validatePreparedFeaturePayload(spec, {
        title: "",
        goal: "",
        nodes: [],
        edges: [],
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("structured feature specs", () => {
  it("builds suggest as a shared structured feature contract", () => {
    const spec = buildSuggestFeatureSpec();

    expect(spec).toMatchObject({
      feature: "suggest",
      toolChoice: "required",
      requiredTool: {
        type: "function",
        name: SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
      },
    });
    expect(spec.instructions).toContain("You MUST call the business tool suggest_task_completions.");
  });

  it("validates suggest payloads through the shared contract", () => {
    const spec = buildSuggestFeatureSpec();

    expect(
      validatePreparedFeaturePayload(spec, {
        suggestions: [{ title: "Plan groceries" }],
      }),
    ).toEqual({ ok: true });

    expect(
      validatePreparedFeaturePayload(spec, {
        suggestions: [{}],
      }),
    ).toMatchObject({ ok: false });
  });
});
