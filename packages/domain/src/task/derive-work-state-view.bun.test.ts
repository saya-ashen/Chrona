import { describe, expect, it } from "bun:test";

import { deriveWorkStateView, type WorkStateCanonical } from "./derive-work-state-view";

const cases: Array<{
  name: string;
  input: Parameters<typeof deriveWorkStateView>[0];
  state: WorkStateCanonical;
  label: string;
  primaryActionId: ReturnType<typeof deriveWorkStateView>["primaryActionId"];
}> = [
  { name: "no plan", input: { taskStatus: "Draft", hasPlan: false }, state: "no_plan", label: "Needs plan", primaryActionId: "generate_plan" },
  { name: "planning", input: { taskStatus: "Draft", planGenerationStatus: "generating" }, state: "planning", label: "Planning", primaryActionId: "stop_generation" },
  { name: "plan review", input: { hasPlan: true, hasAcceptedPlan: false }, state: "plan_review", label: "Plan ready", primaryActionId: "accept_plan" },
  { name: "ready to run", input: { planStatus: "accepted", hasAcceptedPlan: true }, state: "ready_to_run", label: "Ready to run", primaryActionId: "start_execution" },
  { name: "queued", input: { executionStatus: "queued" }, state: "queued", label: "Queued", primaryActionId: "open_execution" },
  { name: "running", input: { executionStatus: "running" }, state: "running", label: "Running", primaryActionId: "monitor_execution" },
  { name: "waiting for input", input: { executionStatus: "waiting_for_user" }, state: "waiting_for_input", label: "Input needed", primaryActionId: "provide_input" },
  { name: "waiting for approval", input: { executionStatus: "waiting_for_approval" }, state: "waiting_for_approval", label: "Approval needed", primaryActionId: "review_approval" },
  { name: "blocked", input: { taskStatus: "Blocked" }, state: "blocked", label: "Blocked", primaryActionId: "resolve_blocker" },
  { name: "failed", input: { executionStatus: "failed" }, state: "failed", label: "Failed", primaryActionId: "retry" },
  { name: "cancelled", input: { executionStatus: "cancelled" }, state: "cancelled", label: "Cancelled", primaryActionId: "inspect_audit" },
  { name: "result ready", input: { taskStatus: "Completed", executionStatus: "completed" }, state: "result_ready", label: "Result ready", primaryActionId: "accept_result" },
  { name: "done", input: { taskStatus: "Done", executionStatus: "completed" }, state: "done", label: "Task done", primaryActionId: "ask_follow_up" },
];

describe("deriveWorkStateView", () => {
  for (const stateCase of cases) {
    it(`maps ${stateCase.name}`, () => {
      const view = deriveWorkStateView(stateCase.input);
      expect(view.state).toBe(stateCase.state);
      expect(view.label).toBe(stateCase.label);
      expect(view.primaryActionId).toBe(stateCase.primaryActionId);
    });
  }

  it("keeps completed result review distinct from accepted done", () => {
    expect(deriveWorkStateView({ taskStatus: "Completed", executionStatus: "completed" }).state).toBe("result_ready");
    expect(deriveWorkStateView({ taskStatus: "Done", executionStatus: "completed" }).state).toBe("done");
  });

  it("keeps approval and input waits distinct", () => {
    expect(deriveWorkStateView({ executionStatus: "waiting_for_user" }).state).toBe("waiting_for_input");
    expect(deriveWorkStateView({ executionStatus: "waiting_for_approval" }).state).toBe("waiting_for_approval");
  });

  it("converts blocker classes to user-recoverable states", () => {
    const failed = deriveWorkStateView({ blockReason: { blockType: "run_failed", detail: "Provider failed", scope: "run" } });
    expect(failed.state).toBe("failed");
    expect(failed.blocker).toEqual({ kind: "run_failed", reason: "Provider failed", scope: "run" });

    const approval = deriveWorkStateView({ blockReason: { blockType: "approval_required", actionRequired: "Approve checkpoint", nodeId: "n2" } });
    expect(approval.state).toBe("waiting_for_approval");
    expect(approval.currentNodeId).toBe("n2");
  });

  it("removes primary action when the task is not runnable", () => {
    const view = deriveWorkStateView({ planStatus: "accepted", isRunnable: false, disabledReason: "Choose an AI provider." });
    expect(view.state).toBe("ready_to_run");
    expect(view.primaryActionId).toBeNull();
    expect(view.primaryActionDisabledReason).toBe("Choose an AI provider.");
  });
});
