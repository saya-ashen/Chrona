import { describe, expect, test } from "bun:test";
import type { EditablePlan, EditableNode } from "@chrona/contracts/ai";
import { PlanCompileError } from "@chrona/contracts/ai";
import { compileEditablePlan } from "./compile";
import { validateEditablePlan } from "./validate";

function task(id: string, title = id): EditableNode {
  return {
    id,
    type: "task",
    title,
    executor: "ai",
    mode: "auto",
    userInteraction: { level: "not_expected" },
    expectedOutput: `${title} done`,
  };
}

function plan(overrides: Partial<EditablePlan> = {}): EditablePlan {
  return {
    id: "plan_1",
    version: 1,
    title: "Boundary plan",
    goal: "Protect plan boundaries",
    nodes: [task("collect"), task("publish_report", "Publish report")],
    edges: [{ from: "collect", to: "publish_report" }],
    assumptions: [],
    ...overrides,
  };
}

describe("plan state boundaries", () => {
  test("text-only high-risk heuristics do not produce plan warnings", () => {
    const result = validateEditablePlan(plan());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("cycle is rejected before compilation can accept stale graph state", () => {
    const cyclic = plan({
      nodes: [task("collect"), task("review")],
      edges: [{ from: "collect", to: "review" }, { from: "review", to: "collect" }],
    });

    const validation = validateEditablePlan(cyclic);

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContainEqual({
      path: "edges",
      message: "Plan graph must be a DAG (no cycles allowed)",
    });
    expect(() => compileEditablePlan(cyclic)).toThrow(PlanCompileError);
  });
});
