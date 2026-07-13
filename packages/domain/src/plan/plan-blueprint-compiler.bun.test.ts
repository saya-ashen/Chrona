import { describe, expect, it } from "bun:test";

import { PlanCompileError } from "@chrona/contracts";

import { compilePlanBlueprint } from "./plan-blueprint-compiler";

describe("compilePlanBlueprint", () => {
  it("compiles a blueprint, derives graph metadata, and preserves local ids", () => {
    const result = compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Trip plan",
        goal: "Book a safe trip",
        nodes: [
          {
            id: "review_budget",
            type: "checkpoint",
            title: "Review budget",
            checkpointType: "approve",
            prompt: "Approve the budget",
          },
          {
            id: "book_trip",
            type: "task",
            title: "Book trip",
            executor: "ai",
            mode: "auto",
          },
        ],
        edges: [{ from: "review_budget", to: "book_trip" }],
      },
      planId: "plan-1",
    });

    expect(result.planId).toBe("plan-1");
    expect(result.compiledPlan.editablePlanId).toBe("plan-1");
    expect(result.compiledPlan.nodes.map((node) => node.localId)).toEqual([
      "review_budget",
      "book_trip",
    ]);
    expect(result.compiledPlan.edges).toHaveLength(1);
  });

  it("fails on invalid edge references", () => {
    expect(() => compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Broken plan",
        goal: "Fail fast",
        nodes: [
          {
            id: "start",
            type: "task",
            title: "Start",
            executor: "ai",
            mode: "auto",
          },
        ],
        edges: [{ from: "start", to: "missing" }],
      },
    })).toThrow(PlanCompileError);
  });

  it("reports each invalid edge reference", () => {
    try {
      compilePlanBlueprint({
        taskId: "task-1",
        blueprint: {
          title: "Broken plan",
          goal: "Fail fast",
          nodes: [
            {
              id: "start",
              type: "task",
              title: "Start",
              executor: "ai",
              mode: "auto",
            },
          ],
          edges: [{ from: "missing_source", to: "missing_target" }],
        },
      });
      throw new Error("Expected blueprint compilation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PlanCompileError);
      expect((error as PlanCompileError).issues).toEqual(
        expect.arrayContaining([
          {
            path: "edges.0.from",
            message: "Unknown source node 'missing_source'",
          },
          {
            path: "edges.0.to",
            message: "Unknown target node 'missing_target'",
          },
        ]),
      );
    }
  });

  it("fails on invalid condition branch references", () => {
    expect(() => compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Branch plan",
        goal: "Fail fast",
        nodes: [
          {
            id: "choose_path",
            type: "condition",
            title: "Choose path",
            condition: "Need approval?",
            branches: [{ label: "yes", nextNodeId: "missing" }],
          },
        ],
        edges: [],
      },
    })).toThrow(PlanCompileError);
  });

  it("fails on cycles", () => {
    expect(() => compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Cycle plan",
        goal: "Fail fast",
        nodes: [
          {
            id: "first",
            type: "task",
            title: "First",
            executor: "ai",
            mode: "auto",
          },
          {
            id: "second",
            type: "task",
            title: "Second",
            executor: "ai",
            mode: "auto",
          },
        ],
        edges: [
          { from: "first", to: "second" },
          { from: "second", to: "first" },
        ],
      },
    })).toThrow(PlanCompileError);
  });

  it("does not reject tasks based on text-only high-risk heuristics", () => {
    const result = compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Action plan",
        goal: "Delete old temporary files",
        nodes: [
          {
            id: "delete_temp_files",
            type: "task",
            title: "Delete temporary files",
            executor: "system",
            mode: "auto",
          },
        ],
        edges: [],
      },
    });

    expect(result.compiledPlan.nodes).toHaveLength(1);
  });

  it("does not require a checkpoint for schedule analysis or result delivery", () => {
    const result = compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Schedule fix plan",
        goal: "Analyze schedule and send a result",
        nodes: [
          {
            id: "analyze_schedule",
            type: "task",
            title: "Analyze schedule",
            executor: "ai",
            mode: "auto",
          },
          {
            id: "deliver_result",
            type: "task",
            title: "Deliver result",
            executor: "ai",
            mode: "auto",
          },
        ],
        edges: [{ from: "analyze_schedule", to: "deliver_result" }],
      },
    });

    expect(result.compiledPlan.nodes).toHaveLength(2);
  });

  it("does not reject calendar wording without structural violations", () => {
    const result = compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Calendar update",
        goal: "Move the meeting",
        nodes: [
          {
            id: "reschedule_meeting",
            type: "task",
            title: "Reschedule calendar meeting",
            executor: "system",
            mode: "auto",
          },
        ],
        edges: [],
      },
    });

    expect(result.compiledPlan.nodes).toHaveLength(1);
  });
});
