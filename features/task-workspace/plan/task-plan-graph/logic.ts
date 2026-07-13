import type {
  EdgeLegendItem,
  GraphCopy,
  NodeLegendItem,
  NodeTone,
  PlanEdgeEmphasis,
  PlanEdgeKind,
  PlanNodeDataModel,
} from "./types";
import { overviewToneForNode } from "../../model/task-workspace-state";
export { getShapeClassName, getShapeStyle, shapeChipClassName, TONE_STYLES } from "./theme";

export function getNodeTone(node: PlanNodeDataModel): NodeTone {
  const tone = overviewToneForNode(node);
  if (tone === "critical") return "blocked";
  if (tone === "warning") return "attention";
  if (tone === "success") return node.status === "skipped" ? "skipped" : "done";
  if (tone === "info") return node.status === "ready" ? "upcoming" : "active";
  return "idle";
}

export function nodeShapeForKind(kind: PlanNodeDataModel["kind"]) {
  if (kind === "condition") return "diamond";
  if (kind === "wait") return "pill";
  if (kind === "checkpoint") return "parallelogram";
  return "rounded";
}

export function nodeKindLabel(
  kind: PlanNodeDataModel["kind"],
  graphCopy: GraphCopy,
) {
  switch (kind) {
    case "condition":
      return graphCopy.nodeTypeCondition;
    case "wait":
      return graphCopy.nodeTypeWait;
    case "checkpoint":
      return graphCopy.nodeTypeCheckpoint;
    case "task":
    case "step":
    case "user_input":
    case undefined:
      return graphCopy.nodeTypeTask;
    default:
      return graphCopy.nodeTypeTask;
  }
}

export function interactionLabel(
  interactionType: PlanNodeDataModel["interactionType"],
) {
  switch (interactionType) {
    case "execute":
      return "Execute";
    case "confirm":
      return "Confirm";
    case "choose":
      return "Choose";
    case "input":
      return "Input";
    case "edit":
      return "Edit";
    case "approve":
      return "Approve";
    case "observe":
    case undefined:
    default:
      return "Observe";
    case "wait":
      return "Wait";
    case "retry":
      return "Retry";
  }
}

function edgeStroke(
  kind: PlanEdgeKind,
  emphasis: PlanEdgeEmphasis,
) {
  if (emphasis === "inactive") return "rgba(100, 116, 139, 0.42)";
  if (emphasis === "blocked") return "rgba(251, 113, 133, 0.9)";
  if (emphasis === "active") return "rgba(103, 232, 249, 0.95)";
  switch (kind) {
    case "dependency":
      return "rgba(196, 181, 253, 0.8)";
    case "branch_true":
      return "rgba(110, 231, 183, 0.84)";
    case "branch_false":
      return "rgba(251, 146, 60, 0.84)";
    case "branch_option":
      return "rgba(232, 121, 249, 0.78)";
    case "resume":
      return "rgba(96, 165, 250, 0.82)";
    case "sequential":
    default:
      return "rgba(148, 163, 184, 0.68)";
  }
}

export function edgeDash(kind: PlanEdgeKind, emphasis: PlanEdgeEmphasis = "normal") {
  if (emphasis === "inactive") return "3 6";
  if (kind === "dependency") return "7 4";
  if (kind === "resume") return "4 4";
  return undefined;
}

export function edgeWidth(
  kind: PlanEdgeKind,
  emphasis: PlanEdgeEmphasis,
) {
  if (emphasis === "inactive") return 1.45;
  if (emphasis !== "normal") return 2.1;
  if (kind === "sequential") return 1.55;
  return 1.35;
}

export function buildEdgeStyle(
  kind: PlanEdgeKind,
  emphasis: PlanEdgeEmphasis,
) {
  return {
    stroke: edgeStroke(kind, emphasis),
    strokeWidth: edgeWidth(kind, emphasis),
    strokeDasharray: edgeDash(kind, emphasis),
  };
}

export function buildEdgeLegend(graphCopy: GraphCopy): EdgeLegendItem[] {
  return [
    {
      label: graphCopy.statusActive,
      stroke: edgeStroke("sequential", "active"),
      width: 2.6,
    },
    {
      label: graphCopy.edgeSequential,
      stroke: edgeStroke("sequential", "normal"),
      width: 2,
    },
    {
      label: graphCopy.edgeDependency,
      stroke: edgeStroke("dependency", "normal"),
      dash: edgeDash("dependency"),
      width: 1.8,
    },
    {
      label: graphCopy.edgeBranch,
      stroke: edgeStroke("branch_option", "normal"),
      width: 1.8,
    },
    {
      label: graphCopy.statusSkipped,
      stroke: edgeStroke("branch_option", "inactive"),
      dash: edgeDash("branch_option", "inactive"),
      width: 1.6,
    },
    {
      label: graphCopy.statusBlocked,
      stroke: edgeStroke("sequential", "blocked"),
      width: 2.6,
    },
    {
      label: graphCopy.edgeResume,
      stroke: edgeStroke("resume", "normal"),
      dash: edgeDash("resume"),
      width: 1.8,
    },
  ];
}

export function buildNodeLegend(graphCopy: GraphCopy): NodeLegendItem[] {
  return [
    { label: graphCopy.statusActive, shape: "rounded", tone: "active" },
    {
      label: graphCopy.statusWaiting,
      shape: "parallelogram",
      tone: "attention",
    },
    { label: graphCopy.statusReady, shape: "rounded", tone: "upcoming" },
    { label: graphCopy.statusBlocked, shape: "diamond", tone: "blocked" },
    { label: graphCopy.statusDone, shape: "pill", tone: "done" },
    { label: graphCopy.nodeTypeTask, shape: "rounded", tone: "idle" },
    { label: graphCopy.nodeTypeCheckpoint, shape: "parallelogram", tone: "active" },
    { label: graphCopy.nodeTypeCondition, shape: "diamond", tone: "attention" },
    { label: graphCopy.nodeTypeWait, shape: "pill", tone: "upcoming" },
    { label: graphCopy.statusSkipped, shape: "rounded", tone: "skipped" },
  ];
}
