import { describe, expect, it } from "bun:test";

import {
  buildDispatchTaskFeatureSpec,
  buildEditPlanPatchFeatureSpec,
  SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
  buildSuggestFeatureSpec,
  GENERATE_PLAN_BLUEPRINT_TOOL_NAME,
  buildGeneratePlanFeatureSpec,
  validatePreparedFeaturePayload,
} from "./ai";

describe("generate_plan feature spec", () => {
  it("builds a provider-agnostic feature spec with structured output schema", () => {
    const spec = buildGeneratePlanFeatureSpec({
      taskId: "task-1",
      title: "制作一个汉堡",
      description: "准备食材并完成烹饪",
      estimatedMinutes: 60,
    });

    expect(spec).toMatchObject({
      feature: "generate_plan",
      structuredOutputSchema: {
        name: GENERATE_PLAN_BLUEPRINT_TOOL_NAME,
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

  it("derives generate_plan tool schema from the strict PlanBlueprint zod schema", () => {
    const spec = buildGeneratePlanFeatureSpec({
      title: "制作一个汉堡",
    });

    const parameters = spec.structuredOutputSchema.schema as {
      additionalProperties?: unknown;
      properties?: {
        nodes?: {
          items?: {
            oneOf?: Array<Record<string, unknown>>;
          };
        };
      };
    };

    expect(parameters.additionalProperties).toBe(false);

    const nodeVariants = parameters.properties?.nodes?.items?.oneOf;
    expect(Array.isArray(nodeVariants)).toBe(true);
    expect(nodeVariants).toHaveLength(4);

    const conditionVariant = nodeVariants?.find(
      (variant) =>
        (variant.properties as { type?: { const?: string } } | undefined)?.type
          ?.const === "condition",
    ) as {
      additionalProperties?: unknown;
      properties?: Record<string, unknown>;
    } | undefined;

    expect(conditionVariant?.additionalProperties).toBe(false);
    expect(conditionVariant?.properties?.branches).toBeTruthy();
    expect(conditionVariant?.properties?.executor).toBeUndefined();
  });

  it("omits provider-incompatible metaschema declarations from generate_plan tool schema", () => {
    const spec = buildGeneratePlanFeatureSpec({
      title: "制作一个汉堡",
    });

    const parameters = spec.structuredOutputSchema.schema as {
      $schema?: unknown;
    };

    expect(parameters.$schema).toBeUndefined();
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

  it("validates edit_plan payloads through the shared PlanPatch schema", () => {
    const spec = buildEditPlanPatchFeatureSpec({
      planId: "plan-1",
      version: 1,
      title: "Plan",
      goal: "Goal",
      nodes: [{ id: "task_one", type: "task", title: "Task one" }],
      edges: [],
      userInstruction: "Rename the plan",
    });

    expect(
      validatePreparedFeaturePayload(spec, {
        basePlanId: "plan-1",
        baseVersion: 1,
        operations: [
          {
            op: "update_plan",
            patch: { title: "Updated plan" },
          },
        ],
      }),
    ).toEqual({ ok: true });

    expect(
      validatePreparedFeaturePayload(spec, {
        basePlanId: "plan-1",
        baseVersion: 1,
        operations: [],
      }),
    ).toMatchObject({ ok: false });
  });

  it("validates dispatch_task payloads through the shared decision schema", () => {
    const spec = buildDispatchTaskFeatureSpec();

    expect(
      validatePreparedFeaturePayload(spec, {
        schemaName: "task_dispatch_decision",
        schemaVersion: "1.0.0",
        action: "run_node",
        targetNodeId: "node-1",
        safety: { requiresHumanApproval: false, riskLevel: "low" },
        confidence: 0.9,
        reason: "Node is ready",
      }),
    ).toEqual({ ok: true });

    expect(
      validatePreparedFeaturePayload(spec, {
        schemaName: "task_dispatch_decision",
        schemaVersion: "1.0.0",
        action: "run_node",
        safety: { requiresHumanApproval: false, riskLevel: "low" },
        confidence: 0.9,
        reason: "Node is ready",
      }),
    ).toMatchObject({ ok: false });
  });
});
