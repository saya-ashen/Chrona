export type UserFacingFailureCategory =
  | "input"
  | "approval"
  | "provider"
  | "tool"
  | "runtime"
  | "chrona";

export type RecoveryAction = {
  id: "provide_input" | "review_approval" | "retry" | "restart" | "diagnostics";
  label: string;
};

export type UserFacingFailure = {
  category: UserFacingFailureCategory;
  summary: string;
  technicalDetail: string | null;
  completedScope: string[];
  retainedProgress: string[];
  retryFrom: string | null;
  duplicateSideEffectRisk: string | null;
  safeActions: RecoveryAction[];
  diagnosticRef: string | null;
};

export type UserFacingFailureInput = {
  state: "waiting_for_input" | "waiting_for_approval" | "blocked" | "failed" | "cancelled";
  reason?: string | null;
  scope?: string | null;
  currentNodeId?: string | null;
  currentNodeLabel?: string | null;
  completedNodeLabels?: string[];
  diagnosticRef?: string | null;
};

function categoryFor(input: UserFacingFailureInput): UserFacingFailureCategory {
  if (input.state === "waiting_for_input") return "input";
  if (input.state === "waiting_for_approval") return "approval";
  const reason = input.reason?.toLowerCase() ?? "";
  if (/provider|model|ai client|connection|stream/.test(reason)) return "provider";
  if (/tool|command|shell|mcp/.test(reason)) return "tool";
  if (/chrona|database|persistence|internal/.test(reason)) return "chrona";
  return "runtime";
}

export function deriveUserFacingFailure(input: UserFacingFailureInput): UserFacingFailure {
  const category = categoryFor(input);
  const completedScope = input.completedNodeLabels?.filter(Boolean) ?? [];
  const retryFrom = input.currentNodeLabel ?? input.currentNodeId ?? null;
  const waiting = input.state === "waiting_for_input" || input.state === "waiting_for_approval";
  const summary = input.state === "waiting_for_input"
    ? "Chrona needs information from you before it can continue."
    : input.state === "waiting_for_approval"
      ? "Chrona is paused until you approve or reject the requested action."
      : input.state === "cancelled"
        ? "This execution was cancelled. Completed work remains available."
        : category === "provider"
          ? "The selected AI stopped responding before this step completed."
          : category === "tool"
            ? "A tool could not complete the current step."
            : category === "chrona"
              ? "Chrona could not safely save or continue this execution."
              : "Execution stopped before the current step completed.";

  return {
    category,
    summary,
    technicalDetail: input.reason?.trim() || null,
    completedScope,
    retainedProgress: completedScope.length > 0
      ? ["Completed steps and their recorded results are retained."]
      : ["Task, accepted plan, and execution history are retained."],
    retryFrom,
    duplicateSideEffectRisk: waiting
      ? null
      : "The interrupted step may have started an external action. Check its destination before retrying.",
    safeActions: input.state === "waiting_for_input"
      ? [{ id: "provide_input", label: "Provide input" }, { id: "diagnostics", label: "View diagnostics" }]
      : input.state === "waiting_for_approval"
        ? [{ id: "review_approval", label: "Review approval" }, { id: "diagnostics", label: "View diagnostics" }]
        : [{ id: "retry", label: "Retry current step" }, { id: "restart", label: "Restart from beginning" }, { id: "diagnostics", label: "View diagnostics" }],
    diagnosticRef: input.diagnosticRef ?? null,
  };
}
