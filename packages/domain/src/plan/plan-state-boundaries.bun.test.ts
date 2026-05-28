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
  test("high-risk task behind a normal task produces advisory warning only", () => {
    const result = validateEditablePlan(plan());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual({
      path: "nodes.publish_report",
      message: "High-risk task 'publish_report' should be preceded by an approve/confirm checkpoint",
    });
  });

  test("approve checkpoint clears high-risk task warning", () => {
    const checkpoint: EditableNode = {
      id: "approve",
      type: "checkpoint",
      title: "Approve publish",
      checkpointType: "approve",
      prompt: "Approve publishing?",
      required: true,
    };

    const result = validateEditablePlan(plan({
      nodes: [task("collect"), checkpoint, task("publish_report", "Publish report")],
      edges: [{ from: "collect", to: "approve" }, { from: "approve", to: "publish_report" }],
    }));

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test("cycle is rejected before compilation can accept stale graph state", () => {
    const cyclic = plan({
      nodes: [task("collect"), task("review")],
      edges: [{ from: "collect", to: "review" }, { from: "review", to: "collect" }],
    });

    expect(validateEditablePlan(cyclic)).toMatchObject({
      ok: false,
      errors: [{ path: "edges", message: "Plan graph must be a DAG (no cycles allowed)" }],
    });
    expect(() => compileEditablePlan(cyclic)).toThrow(PlanCompileError);
  });
});
