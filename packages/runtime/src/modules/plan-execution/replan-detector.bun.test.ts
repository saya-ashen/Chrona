import { describe, expect, it } from "bun:test";
import { detectPlanDrift } from "./replan-detector";
import type { TaskPlanGraph } from "@/modules/ai/types";
import type { NodeExecutionResult } from "./node-executor";

function makeNode(overrides: Partial<TaskPlanGraph["nodes"][number]> & { id: string }): TaskPlanGraph["nodes"][number] {
  return {
    id: overrides.id,
    type: "step",
    title: overrides.title ?? `Node ${overrides.id}`,
    objective: overrides.objective ?? `Objective for ${overrides.id}`,
    description: null,
    status: "pending",
    phase: null,
    estimatedMinutes: null,
    priority: null,
    executionMode: "automatic",
    requiresHumanInput: false,
    requiresHumanApproval: false,
    autoRunnable: true,
    blockingReason: null,
    linkedTaskId: null,
    completionSummary: null,
    metadata: null,
    ...overrides,
  };
}

describe("detectPlanDrift", () => {
  it("no drift when node completes normally", () => {
    const node = makeNode({ id: "a" });
    const result: NodeExecutionResult = { status: "done", summary: "ok", evidence: {} };
    const plan = {
      id: "p1", taskId: "t1", status: "accepted" as const, revision: 1,
      source: "ai" as const, generatedBy: null, prompt: null, summary: null,
      changeSummary: null, createdAt: "", updatedAt: "", nodes: [node], edges: [],
    };
    const d = detectPlanDrift({ node, nodeResult: result, plan, mainSessionSummary: null });
    expect(d.needsReplan).toBe(false);
  });

  it("replan_required result triggers replan", () => {
    const node = makeNode({ id: "a" });
    const result: NodeExecutionResult = {
      status: "replan_required",
      reason: "Plan is outdated",
      evidence: {},
    };
    const plan = {
      id: "p1", taskId: "t1", status: "accepted" as const, revision: 1,
      source: "ai" as const, generatedBy: null, prompt: null, summary: null,
      changeSummary: null, createdAt: "", updatedAt: "", nodes: [node], edges: [],
    };
    const d = detectPlanDrift({ node, nodeResult: result, plan, mainSessionSummary: null });
    expect(d.needsReplan).toBe(true);
    if (d.needsReplan) {
      expect(d.risk).toBe("medium");
      expect(d.requiresUserConfirmation).toBe(true);
    }
  });

  it("failed node triggers replan", () => {
    const node = makeNode({ id: "a" });
    const result: NodeExecutionResult = {
      status: "failed",
      error: "Execution error",
      evidence: {},
    };
    const plan = {
      id: "p1", taskId: "t1", status: "accepted" as const, revision: 1,
      source: "ai" as const, generatedBy: null, prompt: null, summary: null,
      changeSummary: null, createdAt: "", updatedAt: "", nodes: [node], edges: [],
    };
    const d = detectPlanDrift({ node, nodeResult: result, plan, mainSessionSummary: null });
    expect(d.needsReplan).toBe(true);
    if (d.needsReplan) {
      expect(d.risk).toBe("high");
    }
  });

  it("waiting_for_user does not trigger replan", () => {
    const node = makeNode({ id: "a" });
    const result: NodeExecutionResult = {
      status: "waiting_for_user",
      prompt: "What is your name?",
      reason: "Needs user input",
    };
    const plan = {
      id: "p1", taskId: "t1", status: "accepted" as const, revision: 1,
      source: "ai" as const, generatedBy: null, prompt: null, summary: null,
      changeSummary: null, createdAt: "", updatedAt: "", nodes: [node], edges: [],
    };
    const d = detectPlanDrift({ node, nodeResult: result, plan, mainSessionSummary: null });
    expect(d.needsReplan).toBe(false);
  });
});
