import { describe, expect, it } from "bun:test";

import { PlanCompileError } from "@chrona/contracts/ai";

import { compilePlanBlueprint, compileBlueprintToCompiledPlan } from "./plan-blueprint-compiler";

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
            executor: "system",
            mode: "auto",
            expectedOutput: "Reservation created",
          },
        ],
        edges: [{ from: "review_budget", to: "book_trip" }],
      },
    });

    expect(result.compiledPlan.completionPolicy).toEqual({ type: "all_tasks_completed" });
    expect(result.compiledPlan.entryNodeIds).toHaveLength(1);
    expect(result.compiledPlan.terminalNodeIds).toHaveLength(1);
    expect(result.compiledPlan.nodes).toHaveLength(2);
    expect(result.planId).toBeDefined();
    expect(result.initialLayer.nodeStates[result.compiledPlan.entryNodeIds[0]].status).toBe("ready");

    const checkpoint = result.compiledPlan.nodes.find((node) => node.localId === "review_budget");
    const task = result.compiledPlan.nodes.find((node) => node.localId === "book_trip");

    expect(checkpoint?.id).not.toBe(checkpoint?.localId);
    expect(task?.id).not.toBe(task?.localId);
    expect(result.compiledPlan.entryNodeIds).toEqual([checkpoint!.id]);
    expect(result.compiledPlan.terminalNodeIds).toEqual([task!.id]);
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

describe("compileBlueprintToCompiledPlan", () => {
  it("compiles a blueprint into a CompiledPlan with localId mapping", () => {
    const compiled = compileBlueprintToCompiledPlan({
      title: "Test",
      goal: "Achieve goal",
      nodes: [
        { id: "approve_step", type: "checkpoint", title: "Approve", checkpointType: "approve", prompt: "OK?" },
        { id: "do_work", type: "task", title: "Work", executor: "ai", mode: "auto" },
      ],
      edges: [{ from: "approve_step", to: "do_work" }],
    });

    expect(compiled.editablePlanId).toBeDefined();
    expect(compiled.sourceVersion).toBe(1);
    expect(compiled.completionPolicy).toEqual({ type: "all_tasks_completed" });
    expect(compiled.nodes).toHaveLength(2);
    expect(compiled.entryNodeIds).toHaveLength(1);
    expect(compiled.terminalNodeIds).toHaveLength(1);

    const entry = compiled.nodes.find((n) => n.localId === "approve_step");
    const terminal = compiled.nodes.find((n) => n.localId === "do_work");
    expect(entry).toBeDefined();
    expect(terminal).toBeDefined();
    expect(compiled.entryNodeIds).toEqual([entry!.id]);
    expect(compiled.terminalNodeIds).toEqual([terminal!.id]);
  });

  it("throws on invalid blueprints", () => {
    expect(() => compileBlueprintToCompiledPlan({
      title: "Bad",
      goal: "Bad",
      nodes: [
        { id: "a", type: "task", title: "A", executor: "ai", mode: "auto" },
        { id: "b", type: "task", title: "B", executor: "ai", mode: "auto" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    })).toThrow(PlanCompileError);
  });
});
