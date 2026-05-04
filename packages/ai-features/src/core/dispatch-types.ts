import type { TaskPlanEdge, TaskPlanNode } from "@chrona/contracts/ai";

export type TaskDispatchAction =
  | "run_node"
  | "materialize_node"
  | "ask_user"
  | "revise_plan"
  | "summarize_context"
  | "mark_task_done"
  | "stop";

export interface TaskPlanPatch {
  basePlanId: string;
  baseRevision: number;
  reason: string;
  changeSummary: string;
  sourceRunId?: string;
  sourceNodeId?: string;
  nodesToAdd?: TaskPlanNode[];
  nodesToUpdate?: Array<{
    nodeId: string;
    patch: Partial<TaskPlanNode>;
  }>;
  nodeIdsToRemove?: string[];
  edgesToAdd?: TaskPlanEdge[];
  edgeIdsToRemove?: string[];
}

export interface TaskDispatchDecision {
  schemaName: "task_dispatch_decision";
  schemaVersion: "1.0.0";
  action: TaskDispatchAction;
  targetNodeId?: string;
  createNewContext?: boolean;
  runtimePrompt?: string;
  planPatch?: TaskPlanPatch;
  contextInstruction?: {
    summarize: boolean;
    retainKeys: string[];
  };
  safety: {
    requiresHumanApproval: boolean;
    riskLevel: "low" | "medium" | "high";
  };
  confidence: number;
  reason: string;
  rationale?: string;
}

export type DispatchDecisionParseIssue = {
  path: string;
  message: string;
};

export type ParseResult<T> =
  | { ok: true; value: T; issues: [] }
  | { ok: false; issues: DispatchDecisionParseIssue[] };

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasActionTarget(action: TaskDispatchAction) {
  return action === "run_node" || action === "materialize_node";
}

function requiresPlanPatch(action: TaskDispatchAction) {
  return action === "revise_plan";
}

export function parseTaskDispatchDecision(raw: unknown): ParseResult<TaskDispatchDecision> {
  const issues: DispatchDecisionParseIssue[] = [];
  const obj = asObject(raw);

  if (!obj) {
    return { ok: false, issues: [{ path: "root", message: "decision must be an object" }] };
  }

  if (obj.schemaName !== "task_dispatch_decision") {
    issues.push({ path: "schemaName", message: "schemaName must be task_dispatch_decision" });
  }
  if (obj.schemaVersion !== "1.0.0") {
    issues.push({ path: "schemaVersion", message: "schemaVersion must be 1.0.0" });
  }

  const action = obj.action;
  const allowedActions: TaskDispatchAction[] = [
    "run_node",
    "materialize_node",
    "ask_user",
    "revise_plan",
    "summarize_context",
    "mark_task_done",
    "stop",
  ];
  if (typeof action !== "string" || !allowedActions.includes(action as TaskDispatchAction)) {
    issues.push({ path: "action", message: "action must be a supported task dispatch action" });
  }

  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
    issues.push({ path: "confidence", message: "confidence must be a number between 0 and 1" });
  }
  if (typeof obj.reason !== "string" || obj.reason.trim().length === 0) {
    issues.push({ path: "reason", message: "reason must be a non-empty string" });
  }

  const safety = asObject(obj.safety);
  if (!safety) {
    issues.push({ path: "safety", message: "safety must be an object" });
  } else {
    if (typeof safety.requiresHumanApproval !== "boolean") {
      issues.push({ path: "safety.requiresHumanApproval", message: "must be boolean" });
    }
    if (
      safety.riskLevel !== "low" &&
      safety.riskLevel !== "medium" &&
      safety.riskLevel !== "high"
    ) {
      issues.push({
        path: "safety.riskLevel",
        message: "riskLevel must be one of low | medium | high",
      });
    }
  }

  if (
    typeof action === "string" &&
    allowedActions.includes(action as TaskDispatchAction) &&
    hasActionTarget(action as TaskDispatchAction)
  ) {
    if (typeof obj.targetNodeId !== "string" || obj.targetNodeId.trim().length === 0) {
      issues.push({ path: "targetNodeId", message: "targetNodeId is required for node actions" });
    }
  }

  if (
    typeof action === "string" &&
    allowedActions.includes(action as TaskDispatchAction) &&
    requiresPlanPatch(action as TaskDispatchAction)
  ) {
    const patch = asObject(obj.planPatch);
    if (!patch) {
      issues.push({ path: "planPatch", message: "planPatch is required for revise_plan" });
    } else {
      if (typeof patch.basePlanId !== "string" || patch.basePlanId.trim().length === 0) {
        issues.push({ path: "planPatch.basePlanId", message: "basePlanId must be a non-empty string" });
      }
      if (
        typeof patch.baseRevision !== "number" ||
        !Number.isInteger(patch.baseRevision) ||
        patch.baseRevision < 1
      ) {
        issues.push({ path: "planPatch.baseRevision", message: "baseRevision must be a positive integer" });
      }
      if (typeof patch.reason !== "string" || patch.reason.trim().length === 0) {
        issues.push({ path: "planPatch.reason", message: "reason must be a non-empty string" });
      }
      if (
        typeof patch.changeSummary !== "string" ||
        patch.changeSummary.trim().length === 0
      ) {
        issues.push({ path: "planPatch.changeSummary", message: "changeSummary must be a non-empty string" });
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: obj as unknown as TaskDispatchDecision, issues: [] };
}

export interface TaskDispatchPolicy {
  minConfidenceForAutoExecute: number;
  allowedAutoActions: TaskDispatchAction[];
  requireHumanApprovalByDefault: boolean;
}

export function isAutoExecutableDispatchDecision(
  decision: TaskDispatchDecision,
  policy: TaskDispatchPolicy,
): boolean {
  if (decision.confidence < policy.minConfidenceForAutoExecute) {
    return false;
  }
  if (!policy.allowedAutoActions.includes(decision.action)) {
    return false;
  }
  if (decision.safety.riskLevel !== "low") {
    return false;
  }
  if (policy.requireHumanApprovalByDefault || decision.safety.requiresHumanApproval) {
    return false;
  }
  return true;
}
