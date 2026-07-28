import { describe, expect, it } from "bun:test";

import {
  SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
  buildGoalAssetOwnershipFeatureSpec,
  buildResultFinalizationFeatureSpec,
  buildSuggestFeatureSpec,
  GENERATE_PLAN_BLUEPRINT_TOOL_NAME,
  buildGeneratePlanFeatureSpec,
  validatePreparedFeaturePayload,
} from "./ai";

describe("task result finalization feature spec", () => {
  it("requires an adaptive semantic workspace and exposes the strict result catalog schema", () => {
    const feature = buildResultFinalizationFeatureSpec({
      manifest: {
        outcome: { title: "Research package", summary: "Ready for review" },
        readiness: {
          status: "ready_with_caveats",
          summary: "Confirm one source",
        },
      },
    });

    expect(feature.feature).toBe("task.result_finalization");
    expect(feature.instructions).toContain(
      "manifest is semantic source material, not a page outline",
    );
    expect(feature.instructions).toContain("not as the default first block");
    expect(feature.instructions).toContain("At most one may have role primary");
    expect(feature.instructions).toContain("do not recreate the sequence Hero");
    expect(feature.instructions).toContain("MUST set sourceKeys");
    expect(feature.instructions).toContain("ResultComparison");
    expect(feature.instructions).toContain("ResultChangeSummary");
    expect(feature.instructions).toContain("sourceKeys");
    expect(feature.instructions).toContain("These are examples, not templates");
    expect(feature.instructions).toContain(
      "Do not reproduce it as a linear report",
    );
    const schema = feature.structuredOutputSchema?.schema as {
      properties?: {
        elements?: {
          additionalProperties?: {
            oneOf?: Array<{
              properties?: {
                type?: { enum?: string[] };
                props?: { properties?: Record<string, unknown> };
              };
            }>;
          };
        };
      };
    };
    const componentVariants =
      schema.properties?.elements?.additionalProperties?.oneOf ?? [];
    const componentNames = componentVariants.flatMap(
      (variant) => variant.properties?.type?.enum ?? [],
    );
    const evidenceVariant = componentVariants.find((variant) =>
      variant.properties?.type?.enum?.includes("ResultEvidence"),
    );
    expect(componentNames).toContain("ResultOverview");
    expect(componentNames).toContain("ResultReadiness");
    expect(componentNames).toContain("ResultSection");
    expect(componentNames).toContain("ResultComparison");
    expect(componentNames).toContain("ResultTimeline");
    expect(componentNames).toContain("ResultChecklist");
    expect(componentNames).toContain("ResultChangeSummary");
    expect(componentNames).toContain("ResultDeliverable");
    expect(componentNames).toContain("ResultEvidence");
    expect(componentNames).not.toContain("Button");
    expect(evidenceVariant?.properties?.props?.properties).toHaveProperty(
      "summary",
    );
  });
});

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
    expect(spec.terminalToolName).toBe("chrona_plan_generate");
    expect(GENERATE_PLAN_BLUEPRINT_TOOL_NAME).toBe("chrona_plan_generate");
    expect(spec.instructions).toContain(
      "You MUST call the chrona_plan_generate tool.",
    );
    expect(spec.instructions).toContain("A simple task may be one task node");
    expect(spec.instructions).toContain(
      "Choose the graph structure from execution dependencies, not a target node count.",
    );
    expect(spec.instructions).toContain(
      "Personalized, factual, submission-ready, identity-dependent, or user-specific deliverables require a checkpoint",
    );
    expect(spec.instructions).toContain(
      "A generic template, placeholders, assumptions about the user, or a list of missing information does NOT satisfy",
    );
    expect(spec.instructions).toContain(
      "A plan must NOT end on a checkpoint, approval, confirmation, review, condition, wait, or routing node",
    );
    expect(spec.inputText).toContain(
      "Choose nodes from real execution work and state transitions",
    );
    expect(spec.inputText).toContain(
      "never omit required human input merely to make the plan shorter",
    );
    expect(spec.inputText).not.toContain("Use the fewest nodes possible");
    expect(spec.inputText).not.toContain("use more than two only");
    expect(spec.instructions).toContain("complete frozen Goal asset catalog");
    expect(spec.instructions).toContain("never traverse the entire catalog indiscriminately");
    expect(spec.instructions).toContain("do not ask the user to select assets or versions");
    expect(spec.instructions).toContain("chrona_goal_results_read");
  });

  it("adds Codex-only tool discovery guidance", () => {
    const generic = buildGeneratePlanFeatureSpec({ title: "Build plan" });
    const codex = buildGeneratePlanFeatureSpec(
      { title: "Build plan" },
      { providerType: "codex" },
    );
    const claudeCode = buildGeneratePlanFeatureSpec(
      { title: "Build plan" },
      { providerType: "claude_code" },
    );

    expect(codex.instructions).toContain("first call tool_search");
    expect(codex.instructions).toContain("chrona_plan_generate");
    expect(generic.instructions).not.toContain("tool_search");
    expect(claudeCode.instructions).not.toContain("tool_search");
  });

  it("keeps the editable task description separate from read-only source context", () => {
    const spec = buildGeneratePlanFeatureSpec({
      taskId: "task-cal",
      title: "获取今天的github trendings",
      description: "我的本地笔记",
      sourceContext: "读取今天最新的github trendings，并总结成一份markdown报告",
    });

    expect(spec.inputText).toContain("Description: 我的本地笔记");
    expect(spec.inputText).toContain(
      "Source context (read-only; provenance is preserved in the payload):",
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

  it("does not expose structured output fallback for generate_plan", () => {
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
    expect(spec.instructions).toContain(
      "You MUST call the business tool suggest_task_completions.",
    );
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

  it("builds and validates the bounded asset ownership contract", () => {
    const spec = buildGoalAssetOwnershipFeatureSpec();
    expect(spec).toMatchObject({
      feature: "goal.asset_ownership",
      structuredOutputSchema: { name: "goal_asset_ownership_result" },
    });
    expect(
      validatePreparedFeaturePayload(spec, {
        schemaVersion: 1,
        decision: "append_version",
        targetAssetId: "asset-1",
        proposedLabel: "Launch brief",
        rationale: "The accepted result updates the same deliverable.",
        differenceSummary: "Adds final launch details.",
        certainty: "high",
        evidence: ["Same deliverable and asset type."],
        counterEvidence: [],
      }),
    ).toEqual({ ok: true });
    expect(
      validatePreparedFeaturePayload(spec, {
        schemaVersion: 1,
        decision: "append_version",
        targetAssetId: null,
        proposedLabel: "Launch brief",
        rationale: "Missing target.",
        differenceSummary: "Missing target.",
        certainty: "low",
        evidence: ["Insufficient evidence."],
        counterEvidence: [],
      }),
    ).toMatchObject({ ok: false });
  });
});
