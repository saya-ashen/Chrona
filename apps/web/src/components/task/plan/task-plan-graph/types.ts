import type { Edge, Node } from "@xyflow/react";
import type { NodeResult, NodeResultEvidence, NodeResultOutput } from "@chrona/contracts/ai";

export type PlanNodeKind = "task" | "checkpoint" | "condition" | "wait" | "step" | "user_input";

export type PlanNodeStatus =
  | "idle"
  | "pending"
  | "ready"
  | "active"
  | "in_progress"
  | "waiting"
  | "waiting_for_user"
  | "blocked"
  | "done"
  | "completed"
  | "skipped";

export type PlanNodeIntent =
  | "execution"
  | "approval"
  | "input"
  | "decision"
  | "pause";

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

export type PlanEdgeKind =
  | "sequential"
  | "dependency"
  | "branch_true"
  | "branch_false"
  | "branch_option"
  | "resume";

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
  kind: "input" | "approve" | "confirm" | "choose" | "edit" | "retry" | "observe" | "open" | "trigger";
  emphasis?: "default" | "primary" | "warning";
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
  requiresHumanInput?: boolean;
  dependencies?: string[];
  requiredInfo?: string[];
  nextAction?: string | null;
  completionSummary?: string | null;
  result?: NodeResult | null;
  resultOutputs?: NodeResultOutput[];
  resultEvidence?: NodeResultEvidence | null;
  branchLabels?: string[];
  options?: string[];
  active?: boolean;
  blocked?: boolean;
  actionable?: boolean;
  interactiveFields?: PlanNodeField[];
  availableActions?: PlanNodeAction[];
  metadata?: Record<string, unknown>;
};

export type PlanEdgeDataModel = {
  id: string;
  from?: string;
  to?: string;
  fromNodeId?: string;
  toNodeId?: string;
  type?: string;
  kind?: PlanEdgeKind;
  label?: string | null;
  emphasis?: "normal" | "active" | "blocked";
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

export type TaskPlanGraphMode = "full" | "compact" | "auto";

export type TaskPlanGraphProps = {
  mode?: TaskPlanGraphMode;
  fillHeight?: boolean;
  className?: string;
  plan: TaskPlanGraphPlan;
  inspectorPlacement?: "overlay" | "none";
  onSelectedNodeChange?: (node: PlanNodeDataModel | null, nodes: PlanNodeDataModel[]) => void;
  dismissSelectionOnOutsideClick?: boolean;
};

export type NodeTone =
  | "active"
  | "attention"
  | "blocked"
  | "done"
  | "upcoming"
  | "idle";

export type NodeShape = "rounded" | "diamond" | "pill" | "parallelogram";

export type GraphCopy = {
  ariaLabel: string;
  openFullGraph: string;
  compactTitle: string;
  compactDescription: string;
  fullTitle: string;
  fullDescription: string;
  closeDialog: string;
  overviewNodes: string;
  overviewActive: string;
  overviewAttention: string;
  overviewDone: string;
  overviewEstimate: string;
  focusTitle: string;
  focusDescription: string;
  inspectorTitle: string;
  inspectorEmpty: string;
  inspectorWhy: string;
  inspectorDependencies: string;
  inspectorExecution: string;
  inspectorOutcomes: string;
  inspectorFields: string;
  legendStates: string;
  legendEdges: string;
  detailObjective: string;
  detailPhase: string;
  detailExecutionMode: string;
  detailPriority: string;
  detailEstimatedDuration: string;
  detailLinkedTask: string;
  detailReadiness: string;
  detailNextAction: string;
  detailDependencies: string;
  detailRequiredInfo: string;
  detailCompletionSummary: string;
  statusIdle: string;
  statusReady: string;
  statusActive: string;
  statusWaiting: string;
  statusBlocked: string;
  statusDone: string;
  statusSkipped: string;
  edgeSequential: string;
  edgeDependency: string;
  edgeBranch: string;
  edgeResume: string;
  nodeTypeTask: string;
  nodeTypeCheckpoint: string;
  nodeTypeCondition: string;
  nodeTypeWait: string;
  intentExecution: string;
  intentApproval: string;
  intentInput: string;
  intentDecision: string;
  intentPause: string;
};

export type FlowNodeData = {
  node: PlanNodeDataModel;
  tone: NodeTone;
  shape: NodeShape;
  isSelected: boolean;
  isFocus: boolean;
  graphCopy: GraphCopy;
  onSelect: (nodeId: string) => void;
};

export type FlowGraphNode = Node<FlowNodeData, "taskPlanNode">;
export type FlowEdgeData = {
  stableLabel?: string;
};

export type FlowGraphEdge = Edge<FlowEdgeData, "taskPlanEdge">;

export type EdgeLegendItem = {
  label: string;
  stroke: string;
  dash?: string;
  width: number;
};

export type NodeLegendItem = {
  label: string;
  shape: NodeShape;
  tone: NodeTone;
};

export type CompactStage = {
  id: string;
  title: string;
  nodeIds: string[];
  activeCount: number;
  attentionCount: number;
  doneCount: number;
};

export type CompactFocusItem = {
  id: string;
  title: string;
  statusLabel: string;
  summary: string;
  tone: NodeTone;
  relationLabel: string | null;
};
