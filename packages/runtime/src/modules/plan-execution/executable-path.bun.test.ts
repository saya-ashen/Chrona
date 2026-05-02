import { describe, expect, it } from "bun:test";
import { computeExecutablePath, type PlanExecutablePath } from "./executable-path";
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

function makeEdge(fromNodeId: string, toNodeId: string, type = "sequential" as const): TaskPlanGraph["edges"][number] {
  return { id: `e-${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId, type, metadata: null };
}

function makePlan(nodes: ReturnType<typeof makeNode>[], edges: TaskPlanGraph["edges"] = []): TaskPlanGraph {
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
    edges,
  };
}

function pick(path: PlanExecutablePath) {
  return {
    ready: path.readyNodeIds.sort(),
    waitingForUser: path.waitingForUserNodeIds.sort(),
    waitingForApproval: path.waitingForApprovalNodeIds.sort(),
    blocked: path.blockedNodeIds.sort(),
    done: path.doneNodeIds.sort(),
    skipped: path.skippedNodeIds.sort(),
    inProgress: path.inProgressNodeIds.sort(),
    pending: path.pendingNodeIds.sort(),
    currentNode: path.currentNodeId,
    reason: path.terminalReason,
  };
}

describe("computeExecutablePath", () => {
  it("empty plan -> empty_plan", () => {
    const plan = makePlan([]);
    const path = computeExecutablePath(plan);
    expect(path.terminalReason).toBe("empty_plan");
    expect(path.readyNodeIds).toEqual([]);
  });

  it("linear plan: first node is ready, subsequent blocked by dependency", () => {
    const plan = makePlan(
      [makeNode({ id: "a" }), makeNode({ id: "b" })],
      [makeEdge("a", "b")],
    );
    const path = pick(computeExecutablePath(plan));
    expect(path.ready).toEqual(["a"]);
    expect(path.blocked).toEqual(["b"]);
    expect(path.reason).toBe("has_ready_nodes");
  });

  it("when predecessor is done, next node becomes ready", () => {
    const plan = makePlan(
      [
        makeNode({ id: "a", status: "done" }),
        makeNode({ id: "b" }),
      ],
      [makeEdge("a", "b")],
    );
    const path = pick(computeExecutablePath(plan));
    expect(path.ready).toEqual(["b"]);
    expect(path.blocked).toEqual([]);
    expect(path.reason).toBe("has_ready_nodes");
  });

  it("skipped predecessor also unblocks", () => {
    const plan = makePlan(
      [
        makeNode({ id: "a", status: "skipped" }),
        makeNode({ id: "b" }),
      ],
      [makeEdge("a", "b")],
    );
    const path = pick(computeExecutablePath(plan));
    expect(path.ready).toEqual(["b"]);
  });

  it("all nodes done -> all_done", () => {
    const plan = makePlan([
      makeNode({ id: "a", status: "done" }),
      makeNode({ id: "b", status: "done" }),
      makeNode({ id: "c", status: "skipped" }),
    ]);
    const path = computeExecutablePath(plan);
    expect(path.terminalReason).toBe("all_done");
  });

  it("requiresHumanInput -> waiting_for_user", () => {
    const plan = makePlan([makeNode({ id: "a", requiresHumanInput: true })]);
    const path = pick(computeExecutablePath(plan));
    expect(path.waitingForUser).toEqual(["a"]);
    expect(path.ready).toEqual([]);
    expect(path.reason).toBe("waiting_for_user");
  });

  it("requiresHumanApproval -> waiting_for_approval", () => {
    const plan = makePlan([makeNode({ id: "a", requiresHumanApproval: true })]);
    const path = pick(computeExecutablePath(plan));
    expect(path.waitingForApproval).toEqual(["a"]);
    expect(path.reason).toBe("waiting_for_approval");
  });

  it("autoRunnable=false -> blocked", () => {
    const plan = makePlan([makeNode({ id: "a", autoRunnable: false })]);
    const path = pick(computeExecutablePath(plan));
    expect(path.blocked).toEqual(["a"]);
    expect(path.reason).toBe("blocked");
  });

  it("executionMode manual -> blocked", () => {
    const plan = makePlan([makeNode({ id: "a", executionMode: "manual" })]);
    const path = pick(computeExecutablePath(plan));
    expect(path.blocked).toEqual(["a"]);
    expect(path.reason).toBe("blocked");
  });

  it("predecessor blocked causes downstream blocked", () => {
    const plan = makePlan(
      [
        makeNode({ id: "a", autoRunnable: false }),
        makeNode({ id: "b" }),
        makeNode({ id: "c" }),
      ],
      [makeEdge("a", "b"), makeEdge("b", "c")],
    );
    const path = pick(computeExecutablePath(plan));
    expect(path.blocked).toEqual(["a", "b", "c"]);
    expect(path.reason).toBe("blocked");
  });

  it("human input present but unblocked with ready nodes -> has_ready_nodes", () => {
    const plan = makePlan([
      makeNode({ id: "a" }),
      makeNode({ id: "b", requiresHumanInput: true }),
    ]);
    const path = computeExecutablePath(plan);
    expect(path.terminalReason).toBe("has_ready_nodes");
    expect(path.readyNodeIds).toContain("a");
    expect(path.waitingForUserNodeIds).toContain("b");
  });

  it("node in progress is excluded from ready set", () => {
    const plan = makePlan([makeNode({ id: "a", status: "in_progress" })]);
    const path = pick(computeExecutablePath(plan));
    expect(path.inProgress).toEqual(["a"]);
    expect(path.ready).toEqual([]);
    expect(path.currentNode).toBe("a");
    expect(path.reason).toBe("blocked");
  });

  it("all blocked -> blocked", () => {
    const plan = makePlan([
      makeNode({ id: "a", autoRunnable: false }),
      makeNode({ id: "b", autoRunnable: false }),
    ]);
    const path = computeExecutablePath(plan);
    expect(path.terminalReason).toBe("blocked");
  });

  it("linear chain all ready when all predecessors done", () => {
    const plan = makePlan(
      [
        makeNode({ id: "a", status: "done" }),
        makeNode({ id: "b", status: "done" }),
        makeNode({ id: "c" }),
      ],
      [makeEdge("a", "b"), makeEdge("b", "c")],
    );
    const path = pick(computeExecutablePath(plan));
    expect(path.ready).toEqual(["c"]);
  });
});
