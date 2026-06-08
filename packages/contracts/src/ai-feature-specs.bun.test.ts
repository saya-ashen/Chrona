import { describe, expect, it } from "bun:test";

import {
  SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
  buildSuggestFeatureSpec,
  GENERATE_PLAN_BLUEPRINT_TOOL_NAME,
  buildGeneratePlanFeatureSpec,
  validatePreparedFeaturePayload,
} from "./ai";

describe("generate_plan feature spec", () => {
  it("builds a provider-agnostic feature spec that delegates persistence to MCP", () => {
    const spec = buildGeneratePlanFeatureSpec({
      taskId: "task-1",
      title: "制作一个汉堡",
      description: "准备食材并完成烹饪",
      estimatedMinutes: 60,
    });

    expect(spec).toMatchObject({
      feature: "generate_plan",
    });
    expect(spec.structuredOutputSchema).toBeUndefined();
    expect(GENERATE_PLAN_BLUEPRINT_TOOL_NAME).toBe("chrona_plan_generate");
    expect(spec.instructions).toContain("You MUST call the chrona_plan_generate tool.");
    expect(spec.instructions).toContain("A simple task may be a SINGLE task node that both does the work and delivers the result.");
    expect(spec.instructions).toContain("A plan must NOT end on a checkpoint, approval, confirmation, review, condition, wait, or routing node");
    expect(spec.inputText).toContain("Title: 制作一个汉堡");
    expect(spec.inputText).toContain("Estimated duration: 60 minutes");
  });

  it("includes both the editable Chrona note and the read-only calendar source context as distinct sections", () => {
    const spec = buildGeneratePlanFeatureSpec({
      taskId: "task-cal",
      title: "获取今天的github trendings",
      description: "我的本地笔记",
      sourceContext: "读取今天最新的github trendings，并总结成一份markdown报告",
    });

    expect(spec.inputText).toContain("Description: 我的本地笔记");
    expect(spec.inputText).toContain(
      "Calendar event details (read-only, from the external calendar source):",
    );
    expect(spec.inputText).toContain(
      "读取今天最新的github trendings，并总结成一份markdown报告",
    );
  });

  it("omits the calendar source context section when no source context is present", () => {
    const spec = buildGeneratePlanFeatureSpec({
      title: "Plain task",
      description: "Just a note",
    });

    expect(spec.inputText).not.toContain("Calendar event details");
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

  it("does not expose provider structured output schema for generate_plan", () => {
    const spec = buildGeneratePlanFeatureSpec({
      title: "制作一个汉堡",
    });

    expect(spec.structuredOutputSchema).toBeUndefined();
  });
});

describe("structured feature specs", () => {
  it("builds suggest as a shared structured feature contract", () => {
    const spec = buildSuggestFeatureSpec();

    expect(spec).toMatchObject({
      feature: "suggest",
      structuredOutputSchema: {
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
