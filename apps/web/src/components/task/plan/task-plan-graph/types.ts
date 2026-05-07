import type { Edge, Node } from "@xyflow/react";

export type PlanStep = {
  id: string;
  title: string;
  objective: string;
  phase: string;
  status:
    | "pending"
    | "in_progress"
    | "waiting_for_child"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "done"
    | "blocked"
    | "skipped";
  requiresHumanInput: boolean;
  requiresHumanApproval?: boolean;
  type?: string;
  displayType?: string;
  linkedTaskId?: string | null;
  executionMode?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
  completionSummary?: string | null;
  metadata?: Record<string, unknown> | null;
  readiness?: "ready" | "blocked" | "waiting";
  dependencies?: string[];
  executionClassification?:
    | "automatic_chainable"
    | "automatic_standalone"
    | "human_dependent"
    | "review_gate";
  nextAction?: string | null;
  requiredInfo?: string[];
};

export type PlanEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
  label?: string;
};

export type TaskPlanGraphMode = "full" | "compact" | "auto";

export type TaskPlanGraphPlan = {
  state: "empty" | "ready";
  currentStepId: string | null;
  steps: PlanStep[];
  edges?: PlanEdge[];
  revision?: string | null;
  generatedBy?: string | null;
  isMock?: boolean;
  summary?: string | null;
  updatedAt?: string | null;
  changeSummary?: string | null;
};

export type TaskPlanGraphProps = {
  mode?: TaskPlanGraphMode;
  maxViewportHeight?: number;
  plan: TaskPlanGraphPlan;
};

export type NodeTone =
  | "child-task"
  | "waiting"
  | "checkpoint"
  | "checkpoint-approve"
  | "condition"
  | "wait"
  | "done"
  | "blocked"
  | "current"
  | "default";

export type NodeShape = "rounded" | "diamond" | "pill" | "parallelogram";

export type GraphCopy = {
  ariaLabel: string;
  statusInProgress: string;
  statusWaitingForChild: string;
  statusWaitingForUser: string;
  statusWaitingForApproval: string;
  statusDone: string;
  statusBlocked: string;
  statusSkipped: string;
  statusPending: string;
  edgeDependsOn: string;
  edgeSequential: string;
  requiresHumanInput: string;
  detailType: string;
  detailExecutionMode: string;
  detailPriority: string;
  detailEstimatedDuration: string;
  detailLinkedTask: string;
  detailDescription: string;
  detailCompletionSummary: string;
  detailExecutionClassification: string;
  detailReadiness: string;
  detailNextAction: string;
  detailDependencies: string;
  detailRequiredInfo: string;
  nodeTypeTask: string;
  nodeTypeCheckpoint: string;
  nodeTypeCondition: string;
  nodeTypeWait: string;
  badgeAuto: string;
  badgeManual: string;
  badgeAssist: string;
  badgeAi: string;
  badgeUser: string;
  badgeSystem: string;
  badgeConfirm: string;
  badgeChoose: string;
  badgeInput: string;
  badgeEdit: string;
  badgeApprove: string;
  badgeRequired: string;
  badgeOptional: string;
};

export type FlowNodeData = {
  step: PlanStep;
  tone: NodeTone;
  isCurrent: boolean;
  isSelected: boolean;
  graphCopy: GraphCopy;
  onToggle: (nodeId: string) => void;
};

export type FlowGraphNode = Node<FlowNodeData, "taskPlanNode">;

export type FlowGraphEdge = Edge;

export type EdgeLegendItem = {
  type: string;
  label: string;
  stroke: string;
  dash: string | undefined;
  width: number;
};

export type NodeLegendItem = {
  type: string;
  label: string;
  shape: NodeShape;
  tone: NodeTone;
};
