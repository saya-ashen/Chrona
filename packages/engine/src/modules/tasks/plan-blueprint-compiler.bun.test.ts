import { describe, expect, it } from "bun:test";

import { PlanCompileError } from "@chrona/contracts/ai";

import { compilePlanBlueprint } from "./plan-blueprint-compiler";

describe("compilePlanBlueprint", () => {
  it("compiles a blueprint, derives graph metadata, and preserves local ids", () => {
    const graph = compilePlanBlueprint({
      taskId: "task-1",
      graphId: "graph-1",
      now: "2026-05-04T00:00:00.000Z",
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
            executor: "system",
            mode: "auto",
            expectedOutput: "Reservation created",
          },
        ],
        edges: [{ from: "review_budget", to: "book_trip" }],
      },
    });

    expect(graph.completionPolicy).toEqual({ type: "all_tasks_completed" });
    expect(graph.blueprint?.title).toBe("Trip plan");
    expect(graph.entryNodeIds).toHaveLength(1);
    expect(graph.terminalNodeIds).toHaveLength(1);

    const checkpoint = graph.nodes.find((node) => node.localId === "review_budget");
    const task = graph.nodes.find((node) => node.localId === "book_trip");

    expect(checkpoint?.id).not.toBe(checkpoint?.localId);
    expect(task?.id).not.toBe(task?.localId);
    expect(graph.entryNodeIds).toEqual([checkpoint!.id]);
    expect(graph.terminalNodeIds).toEqual([task!.id]);
  });

  it("fails on invalid edge references", () => {
    expect(() => compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Broken plan",
        goal: "Fail fast",
        nodes: [{ id: "start_here", type: "task", title: "Start" }],
        edges: [{ from: "start_here", to: "missing_node" }],
      },
    })).toThrow(PlanCompileError);

    try {
      compilePlanBlueprint({
        taskId: "task-1",
        blueprint: {
          title: "Broken plan",
          goal: "Fail fast",
          nodes: [{ id: "start_here", type: "task", title: "Start" }],
          edges: [{ from: "start_here", to: "missing_node" }],
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PlanCompileError);
      expect((error as PlanCompileError).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "edges.0.to" }),
        ]),
      );
    }
  });

  it("fails on invalid condition branch references", () => {
    expect(() => compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Branch plan",
        goal: "Validate branches",
        nodes: [
          {
            id: "check_status",
            type: "condition",
            title: "Check status",
            condition: "Status known",
            branches: [{ label: "yes", nextNodeId: "missing_branch" }],
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
        goal: "Reject cycles",
        nodes: [
          { id: "first_step", type: "task", title: "First" },
          { id: "second_step", type: "task", title: "Second" },
        ],
        edges: [
          { from: "first_step", to: "second_step" },
          { from: "second_step", to: "first_step" },
        ],
      },
    })).toThrow(PlanCompileError);
  });

  it("requires a checkpoint immediately before high-risk tasks", () => {
    expect(() => compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Risky plan",
        goal: "Protect risky actions",
        nodes: [
          {
            id: "send_email",
            type: "task",
            title: "Send email to vendor",
            executor: "system",
            mode: "auto",
          },
        ],
        edges: [],
      },
    })).toThrow(PlanCompileError);
  });
});
