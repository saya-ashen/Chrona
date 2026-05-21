import { describe, expect, it } from "bun:test";
import {
  executionSessionStatusForRuntimeProgress,
  planGraphStatusForRuntimeProgress,
  planRunStatusForRuntimeProgress,
  runtimeProgressStatusForNodes,
  runtimeProgressStatusForWaitKind,
  taskStatusForRuntimeProgress,
  webPlanNodeStatusForRuntimeStatus,
} from "./ai-plan-runtime";

describe("runtime status model", () => {
  it("maps wait kinds to node-level runtime progress", () => {
    expect(runtimeProgressStatusForWaitKind("user_input")).toBe("waiting_for_user");
    expect(runtimeProgressStatusForWaitKind("approval")).toBe("waiting_for_approval");
    expect(runtimeProgressStatusForWaitKind("review")).toBe("waiting_for_approval");
    expect(runtimeProgressStatusForWaitKind("manual_action")).toBe("blocked");
    expect(runtimeProgressStatusForWaitKind(undefined)).toBe("blocked");
  });

  it("summarizes graph progress from node runtime state", () => {
    expect(runtimeProgressStatusForNodes({
      readyNodeIds: ["ready"],
      runningNodeIds: [],
      nodes: [{ id: "ready", status: "ready", reachable: true }],
      blockedNodeIds: [],
      failedNodeIds: [],
      completedNodeIds: [],
    })).toBe("running");

    expect(runtimeProgressStatusForNodes({
      readyNodeIds: [],
      runningNodeIds: [],
      nodes: [{ id: "input", status: "waiting_for_user", reachable: true }],
      blockedNodeIds: [],
      failedNodeIds: [],
      completedNodeIds: [],
    })).toBe("waiting_for_user");

    expect(runtimeProgressStatusForNodes({
      readyNodeIds: [],
      runningNodeIds: [],
      nodes: [{ id: "done", status: "completed", reachable: true }],
      blockedNodeIds: [],
      failedNodeIds: [],
      completedNodeIds: ["done"],
    })).toBe("completed");
  });

  it("projects runtime progress to run, graph, session, task, and web states", () => {
    expect(planRunStatusForRuntimeProgress("waiting_for_user")).toBe("paused");
    expect(planGraphStatusForRuntimeProgress("waiting_for_user")).toBe("paused");
    expect(executionSessionStatusForRuntimeProgress("waiting_for_user")).toBe("Paused");
    expect(taskStatusForRuntimeProgress("waiting_for_user")).toBe("WaitingForInput");
    expect(webPlanNodeStatusForRuntimeStatus("waiting_for_user")).toBe("waiting_for_user");

    expect(planRunStatusForRuntimeProgress("running")).toBe("running");
    expect(planGraphStatusForRuntimeProgress("running")).toBe("active");
    expect(executionSessionStatusForRuntimeProgress("running")).toBe("Active");
    expect(taskStatusForRuntimeProgress("running")).toBe("Running");
    expect(webPlanNodeStatusForRuntimeStatus("running")).toBe("active");

    expect(webPlanNodeStatusForRuntimeStatus("completed")).toBe("done");
    expect(webPlanNodeStatusForRuntimeStatus(undefined)).toBe("idle");
  });
});
