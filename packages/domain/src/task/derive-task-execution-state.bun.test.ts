import { describe, expect, it } from "bun:test";
import { deriveTaskExecutionState, taskExecutionStateToRunStatus, type TaskExecutionStateInput } from "./derive-task-execution-state";

function graph(overrides: Partial<NonNullable<TaskExecutionStateInput["graph"]>> = {}): NonNullable<TaskExecutionStateInput["graph"]> {
  return {
    nodes: [{ status: "ready" }],
    readyNodeIds: [],
    runningNodeIds: [],
    completedNodeIds: [],
    failedNodeIds: [],
    blockedNodeIds: [],
    degradedNodeIds: [],
    waitingNodeIds: [],
    waitingForUserNodeIds: [],
    waitingForApprovalNodeIds: [],
    cancelledNodeIds: [],
    ...overrides,
  };
}

describe("deriveTaskExecutionState", () => {
  it("keeps terminal graph completion ahead of a late failed provider run", () => {
    expect(deriveTaskExecutionState({
      graph: graph({
        nodes: [{ status: "completed" }, { status: "completed" }],
        completedNodeIds: ["node-1", "node-2"],
      }),
      runStatus: "Failed",
    })).toBe("completed");
  });

  it("prioritizes failed graph evidence over completed nodes", () => {
    expect(deriveTaskExecutionState({
      graph: graph({
        nodes: [{ status: "completed" }, { status: "failed" }],
        completedNodeIds: ["node-1"],
        failedNodeIds: ["node-2"],
      }),
      taskStatus: "Completed",
      runStatus: "Completed",
    })).toBe("failed");
  });
  it("lets an active run override stale failed graph evidence", () => {
    expect(deriveTaskExecutionState({
      graph: graph({
        nodes: [{ status: "failed" }],
        failedNodeIds: ["node-1"],
      }),
      taskStatus: "Running",
      runStatus: "Running",
      hasActiveRun: true,
    })).toBe("running");
  });


  it("keeps terminal task completion ahead of a late failed provider run", () => {
    expect(deriveTaskExecutionState({
      taskStatus: "Completed",
      runStatus: "Failed",
    })).toBe("completed");
  });

  it("surfaces failed run when no terminal graph or task state exists", () => {
    expect(deriveTaskExecutionState({
      taskStatus: "Running",
      runStatus: "Failed",
    })).toBe("failed");
  });

  it("keeps stale sync task block ahead of queued graph readiness", () => {
    expect(deriveTaskExecutionState({
      graph: graph({ readyNodeIds: ["sync"] }),
      blockReason: { blockType: "stale_sync", actionRequired: "Re-sync", scope: "run", nodeId: "sync" },
    })).toBe("blocked");
  });

  it("maps display execution state to run-like labels", () => {
    expect(taskExecutionStateToRunStatus("completed")).toBe("Completed");
    expect(taskExecutionStateToRunStatus("waiting_for_user")).toBe("WaitingForInput");
  });
});
