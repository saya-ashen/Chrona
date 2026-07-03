import { describe, expect, it } from "bun:test";

import { deriveWorkItemStateView, type WorkItemUserState } from "./derive-work-item-state-view";

const stateCases: Array<{
  name: string;
  input: Parameters<typeof deriveWorkItemStateView>[0];
  state: WorkItemUserState;
  primaryAction: ReturnType<typeof deriveWorkItemStateView>["primaryAction"];
}> = [
  { name: "unscheduled", input: { isScheduled: false, hasPlan: true }, state: "unscheduled", primaryAction: "schedule" },
  { name: "scheduled", input: { scheduleStatus: "Scheduled", hasPlan: true }, state: "scheduled", primaryAction: "generate_plan" },
  { name: "ready to plan", input: { planStatus: "no_plan", isScheduled: true }, state: "ready_to_plan", primaryAction: "generate_plan" },
  { name: "ready to execute", input: { planStatus: "accepted", isScheduled: true }, state: "ready_to_execute", primaryAction: "start_execution" },
  { name: "running", input: { executionStatus: "Running", planStatus: "accepted" }, state: "running", primaryAction: "open_execution" },
  { name: "waiting for input", input: { nodeStatus: "waiting_for_user", executionStatus: "Running" }, state: "waiting_for_input", primaryAction: "provide_input" },
  { name: "waiting for approval", input: { nodeStatus: "waiting_for_approval", executionStatus: "Running" }, state: "waiting_for_approval", primaryAction: "review_approval" },
  { name: "blocked", input: { taskStatus: "Blocked", executionStatus: "Running" }, state: "blocked", primaryAction: "resolve_blocker" },
  { name: "failed", input: { providerStatus: "failed", taskStatus: "Running" }, state: "failed", primaryAction: "retry" },
  { name: "completed", input: { taskStatus: "Completed", executionStatus: "Completed" }, state: "completed", primaryAction: "review_result" },
  { name: "cancelled", input: { taskStatus: "Cancelled", executionStatus: "Cancelled" }, state: "cancelled", primaryAction: "review_result" },
];

describe("deriveWorkItemStateView", () => {
  for (const item of stateCases) {
    it(`derives ${item.name}`, () => {
      const view = deriveWorkItemStateView(item.input);
      expect(view.state).toBe(item.state);
      expect(view.primaryAction).toBe(item.primaryAction);
    });
  }

  it("keeps waiting for input and approval distinct", () => {
    expect(deriveWorkItemStateView({ taskStatus: "WaitingForInput" }).state).toBe("waiting_for_input");
    expect(deriveWorkItemStateView({ taskStatus: "WaitingForApproval" }).state).toBe("waiting_for_approval");
  });

  it("does not collapse cancelled into completed", () => {
    const cancelled = deriveWorkItemStateView({ taskStatus: "Cancelled" });
    const completed = deriveWorkItemStateView({ taskStatus: "Completed" });

    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.label).not.toBe(completed.label);
  });

  it("prioritizes failed and blocked over running", () => {
    expect(deriveWorkItemStateView({ taskStatus: "Running", providerStatus: "failed" }).state).toBe("failed");
    expect(deriveWorkItemStateView({ taskStatus: "Running", nodeStatus: "blocked" }).state).toBe("blocked");
  });

  it("removes primary action when disabled reason exists", () => {
    const view = deriveWorkItemStateView({ planStatus: "accepted", disabledReason: "Plan missing runtime" });

    expect(view.state).toBe("ready_to_execute");
    expect(view.primaryAction).toBeNull();
    expect(view.disabledReason).toBe("Plan missing runtime");
  });
});
