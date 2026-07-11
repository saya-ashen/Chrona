import type {
  WorkStateCanonical,
  WorkStatePrimaryActionId,
  WorkStateTone,
  WorkStateView,
} from "./derive-work-state-view";

export type AttentionKind =
  | "approval_required"
  | "input_required"
  | "execution_failed"
  | "execution_blocked"
  | "result_review"
  | "schedule_decision"
  | "schedule_risk"
  | "informational";

export type AttentionSeverity = "critical" | "high" | "medium" | "low";
export type AttentionGroup = "critical" | "review" | "waiting" | "resolved";

export type AttentionDescriptor = {
  kind: AttentionKind;
  severity: AttentionSeverity;
  group: AttentionGroup;
  label: string;
  tone: WorkStateTone;
  nextActionLabel: string;
  primaryActionId: WorkStatePrimaryActionId | "accept_schedule" | "open_schedule" | "open_task" | null;
  attentionRequired: boolean;
};

export type DeriveAttentionDescriptorInput = {
  stateView?: WorkStateView | null;
  itemKind?: string | null;
  riskLevel?: string | null;
};

const STATE_KIND: Partial<Record<WorkStateCanonical, AttentionKind>> = {
  waiting_for_approval: "approval_required",
  waiting_for_input: "input_required",
  failed: "execution_failed",
  blocked: "execution_blocked",
  result_ready: "result_review",
};

function severityForRisk(riskLevel: string | null | undefined): AttentionSeverity {
  const risk = riskLevel?.trim().toLowerCase();
  if (risk === "critical") return "critical";
  if (risk === "high") return "high";
  if (risk === "medium") return "medium";
  return "low";
}

function groupForState(state: WorkStateCanonical): AttentionGroup {
  switch (state) {
    case "failed":
    case "blocked":
    case "waiting_for_approval":
      return "critical";
    case "waiting_for_input":
      return "waiting";
    case "result_ready":
    case "no_plan":
    case "planning":
    case "plan_review":
    case "ready_to_run":
    case "queued":
    case "running":
      return "review";
    case "done":
    case "cancelled":
      return "resolved";
  }
}

function descriptorFromState(view: WorkStateView): AttentionDescriptor {
  return {
    kind: STATE_KIND[view.state] ?? "informational",
    severity:
      view.state === "failed" || view.state === "blocked"
        ? "critical"
        : view.attentionRequired
          ? "high"
          : "low",
    group: groupForState(view.state),
    label: view.label,
    tone: view.tone,
    nextActionLabel: view.nextActionLabel,
    primaryActionId: view.primaryActionId,
    attentionRequired: view.attentionRequired,
  };
}

export function deriveAttentionDescriptor(
  input: DeriveAttentionDescriptorInput,
): AttentionDescriptor {
  if (input.stateView) return descriptorFromState(input.stateView);

  const severity = severityForRisk(input.riskLevel);
  switch (input.itemKind) {
    case "approval":
      return { kind: "approval_required", severity, group: "critical", label: "Approval needed", tone: "warning", nextActionLabel: "Review the request, then approve, reject, or request changes", primaryActionId: "review_approval", attentionRequired: true };
    case "input":
      return { kind: "input_required", severity, group: "waiting", label: "Input needed", tone: "warning", nextActionLabel: "Provide the requested input so execution can continue", primaryActionId: "provide_input", attentionRequired: true };
    case "recovery":
      return { kind: "execution_failed", severity, group: "critical", label: "Failed", tone: "danger", nextActionLabel: "Review the failure reason, then retry or stop", primaryActionId: "retry", attentionRequired: true };
    case "blocked":
      return { kind: "execution_blocked", severity, group: "critical", label: "Blocked", tone: "danger", nextActionLabel: "Resolve the blocker before execution can continue", primaryActionId: "resolve_blocker", attentionRequired: true };
    case "execution_completed":
      return { kind: "result_review", severity, group: "review", label: "Result ready", tone: "info", nextActionLabel: "Accept result or request changes", primaryActionId: "accept_result", attentionRequired: true };
    case "schedule_proposal":
      return { kind: "schedule_decision", severity, group: "waiting", label: "Schedule proposal", tone: "warning", nextActionLabel: "Accept, reject, or adjust the proposed time", primaryActionId: "accept_schedule", attentionRequired: true };
    case "task_overdue":
    case "task_due_now":
      return { kind: "schedule_risk", severity, group: "critical", label: input.itemKind === "task_overdue" ? "Overdue" : "Due now", tone: "danger", nextActionLabel: "Open the task and decide the next action", primaryActionId: "open_task", attentionRequired: true };
    case "task_due_soon":
      return { kind: "schedule_risk", severity, group: "review", label: "Due soon", tone: "warning", nextActionLabel: "Review the task before it becomes urgent", primaryActionId: "open_task", attentionRequired: true };
    case "auto_execution_skipped":
      return { kind: "schedule_risk", severity, group: "review", label: "Could not start", tone: "warning", nextActionLabel: "Prepare the task so it can start", primaryActionId: "open_task", attentionRequired: true };
    default:
      return { kind: "informational", severity, group: "resolved", label: "Update", tone: "neutral", nextActionLabel: "Open the task for details", primaryActionId: "open_task", attentionRequired: false };
  }
}
