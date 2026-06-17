import { describe, expect, it } from "bun:test";

import { PlanCompileError } from "@chrona/contracts/ai";

import { compilePlanBlueprint } from "@/modules/plans/plan-blueprint-compiler";

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

  it("does not reject tasks based on text-only high-risk heuristics", () => {
    const result = compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Action plan",
        goal: "Do the requested work",
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
    });

    expect(result.compiledPlan.nodes).toHaveLength(1);
  });

  it("does not require a checkpoint for schedule analysis or result delivery", () => {
    const result = compilePlanBlueprint({
      taskId: "task-1",
      blueprint: {
        title: "Schedule fix plan",
        goal: "Review unscheduled cards and present a fix",
        nodes: [
          {
            id: "task_inspect_unscheduled_cards",
            type: "task",
            title: "Inspect unscheduled cards",
            expectedOutput: "List cards that need schedule fixes",
          },
          {
            id: "task_present_schedule_fix_result",
            type: "task",
            title: "Present schedule fix result",
            expectedOutput: "User-facing summary of proposed schedule fixes",
          },
        ],
        edges: [
          {
            from: "task_inspect_unscheduled_cards",
            to: "task_present_schedule_fix_result",
          },
        ],
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
