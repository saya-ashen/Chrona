import { describe, expect, it } from "bun:test";
import { decideNodeExecutionSession } from "./session-policy";
import type { TaskPlanGraph } from "@/modules/ai/types";

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

function makePlan(nodes: ReturnType<typeof makeNode>[]): TaskPlanGraph {
  return {
    id: "plan-1",
    taskId: "task-1",
    status: "accepted",
    revision: 1,
    source: "ai",
    generatedBy: null,
    prompt: null,
    summary: null,
    changeSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes,
    edges: [],
  };
}

function decide(nodeOverrides: Partial<TaskPlanGraph["nodes"][number]> & { id: string }): ReturnType<typeof decideNodeExecutionSession> {
  const node = makeNode(nodeOverrides);
  const plan = makePlan([node]);
  return decideNodeExecutionSession({ node, plan, parentTaskId: "parent-1" });
}

describe("decideNodeExecutionSession", () => {
  it("short auto node -> main_session", () => {
    const d = decide({ id: "a", estimatedMinutes: 5 });
    expect(d.kind).toBe("main_session");
  });

  it("requiresHumanInput -> wait_for_user", () => {
    const d = decide({ id: "a", requiresHumanInput: true });
    expect(d.kind).toBe("wait_for_user");
  });

  it("autoRunnable false -> manual_only", () => {
    const d = decide({ id: "a", autoRunnable: false });
    expect(d.kind).toBe("manual_only");
  });

  it("requiresHumanApproval -> manual_only", () => {
    const d = decide({ id: "a", requiresHumanApproval: true });
    expect(d.kind).toBe("manual_only");
  });

  it("executionMode manual -> manual_only", () => {
    const d = decide({ id: "a", executionMode: "manual" });
    expect(d.kind).toBe("manual_only");
  });

  it("estimatedMinutes >= 20 -> child_session", () => {
    const d = decide({ id: "a", estimatedMinutes: 20 });
    expect(d.kind).toBe("child_session");
  });

  it("sessionStrategy per_subtask -> child_session", () => {
    const d = decide({ id: "a", metadata: { sessionStrategy: "per_subtask" } });
    expect(d.kind).toBe("child_session");
  });

  it("type deliverable -> child_session", () => {
    const d = decide({ id: "a", type: "deliverable" });
    expect(d.kind).toBe("child_session");
  });

  it("type tool_action -> child_session", () => {
    const d = decide({ id: "a", type: "tool_action" });
    expect(d.kind).toBe("child_session");
  });

  it("node with linkedTaskId -> child_session", () => {
    const d = decide({ id: "a", linkedTaskId: "child-1" });
    expect(d.kind).toBe("child_session");
  });

  it("already done node -> main_session", () => {
    const d = decide({ id: "a", status: "done" });
    expect(d.kind).toBe("main_session");
  });

  it("already in_progress node -> main_session", () => {
    const d = decide({ id: "a", status: "in_progress" });
    expect(d.kind).toBe("main_session");
  });

  it("multi-step looking node -> child_session", () => {
    const d = decide({ id: "a", title: "Implement the new authentication system" });
    expect(d.kind).toBe("child_session");
  });
});
