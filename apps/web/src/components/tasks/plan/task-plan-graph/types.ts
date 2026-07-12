import type { Edge, Node } from "@xyflow/react";
import type {
  PlanNodeDataModel,
  TaskPlanGraphPlan,
} from "@features/task-workspace/contract";

export type {
  PlanEdgeDataModel,
  PlanEdgeEmphasis,
  PlanEdgeKind,
  PlanGraphAnalytics,
  PlanNodeAction,
  PlanNodeDataModel,
  PlanNodeField,
  PlanNodeGroup,
  PlanNodeInteractionType,
  PlanNodeIntent,
  PlanNodeKind,
  PlanNodeStatus,
  TaskPlanGraphPlan,
} from "@features/task-workspace/contract";


export type TaskPlanGraphMode = "full" | "compact" | "auto";

export type TaskPlanGraphProps = {
  mode?: TaskPlanGraphMode;
  fillHeight?: boolean;
  className?: string;
  plan: TaskPlanGraphPlan;
  onSelectedNodeChange?: (node: PlanNodeDataModel | null, nodes: PlanNodeDataModel[]) => void;
  showOverview?: boolean;
};

export type NodeTone =
  | "active"
  | "attention"
  | "blocked"
  | "done"
  | "skipped"
  | "upcoming"
  | "idle";

export type NodeShape = "rounded" | "diamond" | "pill" | "parallelogram";

export type GraphCopy = {
  ariaLabel: string;
  overviewTitle: string;
  controlPanel: string;
  currentNode: string;
  selectedNode: string;
  needsAction: string;
  criticalPath: string;
  primaryPath: string;
  inactivePath: string;
  graphStageMap: string;
  fullScreen: string;
  zoomIn: string;
  zoomOut: string;
  fitGraph: string;
  centerCurrentNode: string;
  expandGraph: string;
  wheelZoomHint: string;
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
  compactEntryLabel: string;
  compactStageLabel: string;
  compactActiveSuffix: string;
  compactAttentionSuffix: string;
  compactDoneSuffix: string;
  compactCurrentProgress: string;
  compactActionBlocked: string;
  compactNextSummary: string;
  compactCurrentNode: string;
  compactNeedsAction: string;
  compactLinkedTask: string;
  inspectorTitle: string;
  inspectorEmpty: string;
  inspectorEmptyTitle: string;
  inspectorNextPrefix: string;
  inspectorGuidanceBlocked: string;
  inspectorGuidanceInput: string;
  inspectorGuidanceDone: string;
  inspectorGuidanceActive: string;
  inspectorGuidanceDefault: string;
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
  detailBranches: string;
  detailOptions: string;
  fieldRequired: string;
  fieldControl: string;
  fieldOptions: string;
  runFieldPlaceholderPrefix: string;
  runSelectPlaceholder: string;
  runApprovalOptionApprove: string;
  runApprovalOptionReject: string;
  runApprovalOptionNeedsChanges: string;
  runActionSend: string;
  runActionApprove: string;
  runActionConfirm: string;
  runActionChoose: string;
  runActionSubmit: string;
  runActionResolve: string;
  runActionRetry: string;
  runActionObserve: string;
  runActionStartPlan: string;
  runActionOpen: string;
  runActionMarkDone: string;
  runActionSending: string;
  runActionBackendNotice: string;
  runActionDefaultLabel: string;
  runActionBackendMissing: string;
  runActionDispatchFailed: string;
  runActionStillRunningSuffix: string;
  runActionFailedSuffix: string;
  runActionManualCompleteFallbackPrefix: string;
  runActionMarkDoneFailed: string;
  runNextUiStep: string;
  runNoFormWait: string;
  runNoFormManualExecute: string;
  runNoFormExecute: string;
  runNoFormRetry: string;
  runNoFormDefault: string;
  runResultTitle: string;
  runResultEmpty: string;
  runEvidenceTitle: string;
  runFeedTitle: string;
  runFeedEmptyWithControls: string;
  runFeedEmptyWithoutControls: string;
  runOutputJsonTitle: string;
  runOutputFileTitle: string;
  runOutputArtifactPrefix: string;
  runOutputCommandTitle: string;
  runOutputExitPrefix: string;
  runPanelExecuteEyebrow: string;
  runPanelExecuteTitle: string;
  runPanelExecuteDescription: string;
  runPanelConfirmEyebrow: string;
  runPanelConfirmTitle: string;
  runPanelConfirmDescription: string;
  runPanelChooseEyebrow: string;
  runPanelChooseTitle: string;
  runPanelChooseDescription: string;
  runPanelInputEyebrow: string;
  runPanelInputTitle: string;
  runPanelInputDescription: string;
  runPanelEditEyebrow: string;
  runPanelEditTitle: string;
  runPanelEditDescription: string;
  runPanelApproveEyebrow: string;
  runPanelApproveTitle: string;
  runPanelApproveDescription: string;
  runPanelWaitEyebrow: string;
  runPanelWaitTitle: string;
  runPanelWaitDescription: string;
  runPanelRetryEyebrow: string;
  runPanelRetryTitle: string;
  runPanelRetryDescription: string;
  runPanelObserveEyebrow: string;
  runPanelObserveTitle: string;
  runPanelObserveDescription: string;
  runHintExecuteReview: string;
  runHintExecuteEntry: string;
  runHintConfirmReview: string;
  runHintConfirmPrereq: string;
  runHintChoosePick: string;
  runHintChooseDownstream: string;
  runHintInputFill: string;
  runHintInputContext: string;
  runHintEditRevise: string;
  runHintEditCheckpoint: string;
  runHintApproveGate: string;
  runHintApproveIntent: string;
  runHintRetryCause: string;
  runHintRetryUse: string;
  runHintWaitManual: string;
  runHintWaitMonitor: string;
  runHintObserveContext: string;
  runHintObserveAdvance: string;
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
  stepNumber: number;
  layoutRole?: "primary" | "branch" | "parallel" | "sidecar" | "chain";
  tone: NodeTone;
  shape: NodeShape;
  isSelected: boolean;
  isCurrent: boolean;
  isFocus: boolean;
  visualWeight: "primary" | "normal" | "muted";
  graphCopy: GraphCopy;
  onSelect: (nodeId: string) => void;
};

export type FlowGraphNode = Node<FlowNodeData, "taskPlanNode">;
export type FlowEdgeData = {
  stableLabel?: string;
  routeOffset?: number;
  orientation?: "vertical" | "horizontal";
  elkPath?: string;
  elkLabelPoint?: { x: number; y: number };
  fanIn?: boolean;
  fanOut?: boolean;
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

export type CompactStageNode = {
  id: string;
  tone: NodeTone;
  label: number;
  lane: number;
  isCurrent: boolean;
};

export type CompactStageEdge = {
  id: string;
  from: string;
  to: string;
};
export type CompactStage = {
  id: string;
  title: string;
  nodes: CompactStageNode[];
  edges: CompactStageEdge[];
  activeCount: number;
  attentionCount: number;
  doneCount: number;
  completion: number;
};

export type CompactFocusItem = {
  id: string;
  title: string;
  statusLabel: string;
  summary: string;
  tone: NodeTone;
  displayTone: string;
  isCurrent: boolean;
  hasLinkedTask: boolean;
  relationLabel: string | null;
  phase: string | null;
  nextAction: string | null;
  estimatedMinutes: number | null;
  isDone: boolean;
  isSkipped: boolean;
};
