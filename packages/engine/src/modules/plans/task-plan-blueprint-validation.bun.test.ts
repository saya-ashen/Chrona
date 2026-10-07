import { describe, expect, it } from "bun:test";

import { PlanCompileError, type PlanBlueprint } from "@chrona/contracts";
import { compilePlanBlueprint } from "@chrona/domain";

import { validateTaskPlanBlueprint } from "./task-plan-blueprint-validation";

function previewBlueprint(): PlanBlueprint {
  return {
    title: "Preview workflow",
    goal: "Present the available preview or explain why it is blocked",
    nodes: [
      { id: "analyze", type: "task", title: "Analyze", executor: "ai", mode: "auto" },
      {
        id: "preview_available",
        type: "condition",
        title: "Is a preview available?",
        condition: "Preview can be generated",
        branches: [
          { label: "blocked", nextNodeId: "report_blocked_preview" },
          { label: "ready", nextNodeId: "publish_preview_report" },
        ],
      },
      { id: "report_blocked_preview", type: "task", title: "Report blocked preview", executor: "ai", mode: "auto" },
      { id: "publish_preview_report", type: "task", title: "Publish preview", executor: "ai", mode: "auto" },
    ],
    edges: [{ from: "analyze", to: "preview_available" }],
  };
}

describe("validateTaskPlanBlueprint", () => {
  it("accepts the reported XOR workflow and compiles both task exits", () => {
    const blueprint = previewBlueprint();

    expect(validateTaskPlanBlueprint(blueprint)).toMatchObject({ ok: true, issues: [] });
    const { compiledPlan } = compilePlanBlueprint({ taskId: "task-preview", blueprint });
    expect(compiledPlan.terminalNodeIds).toHaveLength(2);
    expect(
      compiledPlan.terminalNodeIds.map((id) => compiledPlan.nodes.find((node) => node.id === id)?.localId),
    ).toEqual(["report_blocked_preview", "publish_preview_report"]);
  });

  it("rejects the same invalid references, cycles, and non-task exits as compilation", () => {
    const invalidBlueprints: unknown[] = [
      {
        ...previewBlueprint(),
        edges: [{ from: "analyze", to: "missing_task" }],
      },
      {
        ...previewBlueprint(),
        edges: [
          { from: "analyze", to: "preview_available" },
          { from: "publish_preview_report", to: "analyze" },
        ],
      },
      {
        title: "Incomplete exit",
        goal: "Wait forever",
        nodes: [{ id: "wait_for_input", type: "wait", title: "Wait", waitFor: "input" }],
        edges: [],
      },
    ];

    for (const blueprint of invalidBlueprints) {
      expect(validateTaskPlanBlueprint(blueprint as PlanBlueprint).ok).toBe(false);
      expect(() => compilePlanBlueprint({
        taskId: "task-invalid",
        blueprint: blueprint as PlanBlueprint,
      })).toThrow(PlanCompileError);
    }
  });

  it("normalizes malformed node types as validation errors at both boundaries", () => {
    const blueprint = {
      title: "Unsupported node type",
      goal: "Reject malformed provider output",
      nodes: [{ id: "unsupported", type: "unsupported", title: "Unsupported" }],
      edges: [],
    } as unknown as PlanBlueprint;

    expect(validateTaskPlanBlueprint(blueprint)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "schema_invalid", path: "/nodes/0/type" })],
    });

    try {
      compilePlanBlueprint({ taskId: "task-invalid", blueprint });
      throw new Error("Expected malformed blueprint compilation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PlanCompileError);
      expect((error as PlanCompileError).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "nodes.0.type" })]),
      );
    }
  });
});
