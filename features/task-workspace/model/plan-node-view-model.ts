import type { CheckpointActionKind,
ExecutionActionInput,
ExecutionCheckpoint,
NodeResult,
NodeResultEvidence, } from "@chrona/contracts"

export type PlanNodeKind = "task" | "checkpoint" | "condition" | "wait" | "step" | "user_input";

export type PlanNodeStatus =
  | "idle"
  | "pending"
  | "ready"
  | "active"
  | "in_progress"
  | "waiting"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "degraded"
  | "done"
  | "completed"
  | "cancelled"
  | "invalidated"
  | "skipped";

export type PlanNodeIntent = "execution" | "approval" | "input" | "decision" | "pause";

export type PlanNodeInteractionType =
  | "execute"
  | "confirm"
  | "choose"
  | "input"
  | "edit"
  | "approve"
  | "wait"
  | "retry"
  | "observe";

export type PlanNodeGroup = "active" | "attention" | "upcoming" | "done" | "idle";

export type PlanNodeField = {
  key: string;
  label: string;
  value: string;
  control?: "text" | "textarea" | "select" | "approval";
  required?: boolean;
  options?: string[];
};

export type PlanNodeAction = {
  id: string;
  label: string;
  kind: "input" | "approve" | "confirm" | "choose" | "edit" | "resolve" | "retry" | "observe" | "open" | "trigger";
  emphasis?: "default" | "primary" | "warning" | "danger";
  checkpointId?: string;
  checkpointAction?: CheckpointActionKind;
  executionAction?: ExecutionActionInput;
  requiresPayload?: boolean;
};

export type PlanNodeDataModel = {
  id: string;
  title: string;
  summary?: string;
  objective: string;
  phase: string;
  type?: PlanNodeKind;
  displayType?: PlanNodeKind;
  kind?: PlanNodeKind;
  status: PlanNodeStatus;
  intent?: PlanNodeIntent;
  interactionType?: PlanNodeInteractionType;
  group?: PlanNodeGroup;
  statusLabel?: string;
  badges?: string[];
  executionMode?: string | null;
  executor?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
  linkedTaskId?: string | null;
  readiness?: "ready" | "blocked" | "waiting";
  reachable?: boolean;
  requiresHumanInput?: boolean;
  dependencies?: string[];
  requiredInfo?: string[];
  nextAction?: string | null;
  completionSummary?: string | null;
  result?: NodeResult | null;
  inputFields?: Record<string, string>;
  resultEvidence?: NodeResultEvidence | null;
  branchLabels?: string[];
  options?: string[];
  active?: boolean;
  blocked?: boolean;
  actionable?: boolean;
  checkpoint?: ExecutionCheckpoint | null;
  interactiveFields?: PlanNodeField[];
  availableActions?: PlanNodeAction[];
  metadata?: Record<string, unknown>;
};

export type PlanEdgeKind =
  | "sequential"
  | "dependency"
  | "branch_true"
  | "branch_false"
  | "branch_option"
  | "resume";

export type PlanEdgeEmphasis = "normal" | "active" | "blocked" | "inactive";

export type PlanEdgeDataModel = {
  id: string;
  from?: string;
  to?: string;
  fromNodeId?: string;
  toNodeId?: string;
  type?: string;
  kind?: PlanEdgeKind;
  label?: string | null;
  active?: boolean;
  emphasis?: PlanEdgeEmphasis;
};

export type PlanGraphAnalytics = {
  entryNodeIds: string[];
  terminalNodeIds: string[];
  activeNodeIds: string[];
  reachableFromActiveIds: string[];
  criticalPathNodeIds: string[];
  attentionNodeIds: string[];
  blockedNodeIds: string[];
  rankByNodeId: Record<string, number>;
  laneByNodeId: Record<string, number>;
  upstreamByNodeId: Record<string, string[]>;
  downstreamByNodeId: Record<string, string[]>;
};

export type TaskPlanGraphPlan = {
  state: "empty" | "ready";
  graphTitle?: string | null;
  graphSummary?: string | null;
  revision?: string | null;
  generatedBy?: string | null;
  updatedAt?: string | null;
  nodes: PlanNodeDataModel[];
  edges: PlanEdgeDataModel[];
  currentStepId?: string | null;
  steps: PlanNodeDataModel[];
  analytics: PlanGraphAnalytics;
  summary?: string | null;
  changeSummary?: string | null;
  isMock?: boolean;
};
