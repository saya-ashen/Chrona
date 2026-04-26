import { describe, expect, it } from "bun:test";
import {
  isAutoExecutableDispatchDecision,
  parseTaskDispatchDecision,
} from "@/modules/tasks/task-dispatch-types";

const baseDecision = {
  schemaName: "task_dispatch_decision" as const,
  schemaVersion: "1.0.0" as const,
  safety: {
    requiresHumanApproval: false,
    riskLevel: "low" as const,
  },
  confidence: 0.92,
  reason: "Next node is ready",
};

describe("parseTaskDispatchDecision", () => {
  it("accepts valid run_node decision", () => {
    const result = parseTaskDispatchDecision({
      ...baseDecision,
      action: "run_node",
      targetNodeId: "node-1",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts valid materialize_node decision", () => {
    const result = parseTaskDispatchDecision({
      ...baseDecision,
      action: "materialize_node",
      targetNodeId: "node-2",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts valid ask_user decision", () => {
    const result = parseTaskDispatchDecision({
      ...baseDecision,
      action: "ask_user",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts valid revise_plan decision", () => {
    const result = parseTaskDispatchDecision({
      ...baseDecision,
      action: "revise_plan",
      planPatch: {
        basePlanId: "plan-1",
        baseRevision: 2,
        reason: "Missing dependency discovered",
        changeSummary: "Insert validation node",
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing action", () => {
    const result = parseTaskDispatchDecision({
      ...baseDecision,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects node action without targetNodeId", () => {
    const result = parseTaskDispatchDecision({
      ...baseDecision,
      action: "run_node",
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.some((issue) => issue.path === "targetNodeId")).toBe(true);
  });

  it("rejects invalid patch revision", () => {
    const result = parseTaskDispatchDecision({
      ...baseDecision,
      action: "revise_plan",
      planPatch: {
        basePlanId: "plan-1",
        baseRevision: 0,
        reason: "reason",
        changeSummary: "summary",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("supports low confidence but auto-execution helper returns false", () => {
    const parsed = parseTaskDispatchDecision({
      ...baseDecision,
      action: "materialize_node",
      targetNodeId: "node-1",
      confidence: 0.2,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      isAutoExecutableDispatchDecision(parsed.value, {
        minConfidenceForAutoExecute: 0.8,
        allowedAutoActions: ["materialize_node"],
        requireHumanApprovalByDefault: false,
      }),
    ).toBe(false);
  });
});

