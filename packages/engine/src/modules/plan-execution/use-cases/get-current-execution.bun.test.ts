import { describe, expect, it } from "bun:test";
import type { EffectivePlanGraph } from "@chrona/contracts/ai";
import { currentExecutionStatusFromEffectiveGraph } from "./get-current-execution";

function effectiveGraph(overrides: Partial<EffectivePlanGraph>): EffectivePlanGraph {
  return {
    nodes: [{ id: "node-1", status: "ready", reachable: true } as never],
    edges: [],
    readyNodeIds: [],
    runningNodeIds: [],
    completedNodeIds: [],
    failedNodeIds: [],
    blockedNodeIds: [],
    waitingNodeIds: [],
    ...overrides,
  } as EffectivePlanGraph;
}

describe("currentExecutionStatusFromEffectiveGraph", () => {
  it("returns started only for an accepted graph with no execution evidence", () => {
    expect(currentExecutionStatusFromEffectiveGraph({
      effective: effectiveGraph({ readyNodeIds: ["node-1"] }),
      hasActiveExecutionSession: false,
    })).toBe("started");
  });

  it("treats an active provider run as execution evidence before node state advances", () => {
    expect(currentExecutionStatusFromEffectiveGraph({
      effective: effectiveGraph({ readyNodeIds: ["node-1"] }),
      hasActiveExecutionSession: false,
      hasActiveRun: true,
    })).toBe("running");
  });

  it("preserves failed evidence after the active execution session closes", () => {
    expect(currentExecutionStatusFromEffectiveGraph({
      effective: effectiveGraph({
        nodes: [{ id: "node-1", status: "failed", reachable: true } as never],
        failedNodeIds: ["node-1"],
      }),
      hasActiveExecutionSession: false,
    })).toBe("failed");
  });

  it("preserves blocked evidence after the active execution session closes", () => {
    expect(currentExecutionStatusFromEffectiveGraph({
      effective: effectiveGraph({
        nodes: [{ id: "node-1", status: "blocked", reachable: true } as never],
        blockedNodeIds: ["node-1"],
      }),
      hasActiveExecutionSession: false,
    })).toBe("blocked");
  });

  it("preserves waiting evidence after the active execution session closes", () => {
    expect(currentExecutionStatusFromEffectiveGraph({
      effective: effectiveGraph({
        nodes: [{ id: "node-1", status: "waiting_for_user", reachable: true } as never],
        waitingNodeIds: ["node-1"],
      }),
      hasActiveExecutionSession: false,
    })).toBe("waiting_for_user");
  });

  it("lets cancelled task lifecycle override stale waiting graph evidence", () => {
    expect(currentExecutionStatusFromEffectiveGraph({
      effective: effectiveGraph({
        nodes: [{ id: "node-1", status: "waiting_for_user", reachable: true } as never],
        waitingNodeIds: ["node-1"],
      }),
      hasActiveExecutionSession: false,
      taskStatus: "Cancelled",
    })).toBe("cancelled");
  });
});
