import { describe, expect, it } from "bun:test";

import {
  graphNodeStateSchema,
  reconciliationResultSchema,
  taskExecutionSummarySchema,
} from "./task-orchestrator";

describe("task orchestrator contracts", () => {
  it("accepts authoritative execution summary states", () => {
    const parsed = taskExecutionSummarySchema.parse({
      taskId: "task_1",
      executionState: "degraded",
      stateLabel: "Degraded",
      stateReason: "Runtime sync timed out",
      graphVersion: 2,
      currentNodeId: "sync",
      primaryAction: { type: "retry_sync", enabled: true, label: "Retry sync" },
      progress: { completed: 1, total: 3, percent: 33 },
      readiness: { runnable: true, reason: null },
      degraded: { reason: "Runtime sync timed out", retryAt: null },
      blocking: null,
      waiting: null,
      recoveryActions: [{ type: "repair_inconsistency", enabled: true, label: "Repair state" }],
    });

    expect(parsed.executionState).toBe("degraded");
  });

  it("rejects non-contract node states while allowing explicit wait states", () => {
    expect(() =>
      graphNodeStateSchema.parse({
        id: "sync",
        type: "task",
        status: "degraded",
        reachable: true,
        current: true,
        requiresAction: true,
        result: null,
        stateReason: "Sync failed",
        invalidatedByMutationId: null,
      }),
    ).toThrow();

    expect(
      graphNodeStateSchema.parse({
        id: "input",
        type: "task",
        status: "waiting_for_user",
        reachable: true,
        current: true,
        requiresAction: true,
        result: null,
        stateReason: "Need input",
        invalidatedByMutationId: null,
      }).status,
    ).toBe("waiting_for_user");
  });

  it("accepts reconciliation result with repair actions", () => {
    expect(
      reconciliationResultSchema.parse({
        taskId: "task_1",
        graphVersion: 1,
        executionState: "blocked",
        currentNodeId: "ship",
        primaryAction: { type: "replan", enabled: true, label: "Replan" },
        progress: { completed: 1, total: 2, percent: 50 },
        issues: [
          {
            code: "terminal_completed_with_pending_prerequisite",
            severity: "error",
            message: "Terminal node completed while a reachable prerequisite is still incomplete.",
            nodeId: null,
          },
        ],
        repairActions: [{ type: "repair_inconsistency", enabled: true, label: "Repair state" }],
        createdAt: "2026-05-17T00:00:00.000Z",
      }).repairActions,
    ).toHaveLength(1);
  });
});
