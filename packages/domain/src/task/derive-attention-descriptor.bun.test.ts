import { describe, expect, it } from "bun:test";

import { deriveAttentionDescriptor } from "./derive-attention-descriptor";
import { deriveWorkStateView } from "./derive-work-state-view";

const stateCases = [
  ["waiting_for_approval", "approval_required", "critical", "review_approval"],
  ["waiting_for_input", "input_required", "waiting", "provide_input"],
  ["blocked", "execution_blocked", "critical", "resolve_blocker"],
  ["failed", "execution_failed", "critical", "retry"],
  ["result_ready", "result_review", "review", "accept_result"],
  ["done", "informational", "resolved", "ask_follow_up"],
] as const;

describe("attention descriptor", () => {
  for (const [taskStatus, kind, group, primaryActionId] of stateCases) {
    it(`maps ${taskStatus} consistently across attention surfaces`, () => {
      const stateView = deriveWorkStateView({ taskStatus });
      expect(deriveAttentionDescriptor({ stateView })).toMatchObject({
        kind,
        group,
        primaryActionId,
        label: stateView.label,
        nextActionLabel: stateView.nextActionLabel,
        attentionRequired: stateView.attentionRequired,
      });
    });
  }

  it.each([
    ["approval", "approval_required", "critical", "review_approval"],
    ["input", "input_required", "waiting", "provide_input"],
    ["recovery", "execution_failed", "critical", "retry"],
    ["blocked", "execution_blocked", "critical", "resolve_blocker"],
    ["execution_completed", "result_review", "review", "accept_result"],
    ["schedule_proposal", "schedule_decision", "waiting", "accept_schedule"],
    ["task_overdue", "schedule_risk", "critical", "open_task"],
    ["auto_execution_skipped", "schedule_risk", "review", "open_task"],
  ] as const)("maps legacy %s items without a canonical state", (itemKind, kind, group, primaryActionId) => {
    expect(deriveAttentionDescriptor({ itemKind, riskLevel: "high" })).toMatchObject({
      kind,
      group,
      primaryActionId,
      attentionRequired: true,
    });
  });

  it("lets canonical state override a stale queue kind", () => {
    const stateView = deriveWorkStateView({ taskStatus: "Done", executionStatus: "failed" });
    expect(deriveAttentionDescriptor({ stateView, itemKind: "recovery", riskLevel: "critical" })).toMatchObject({
      kind: "informational",
      group: "resolved",
      primaryActionId: "ask_follow_up",
      attentionRequired: false,
    });
  });
});
