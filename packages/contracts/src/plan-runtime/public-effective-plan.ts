import type { EffectivePlanGraph, EffectivePlanNode } from "./_leaf";
import type { NodeResult } from "./node-result";

export type PublicResultContribution = {
  key: string;
  title?: string;
  content: string;
  importance?: "primary" | "supporting";
};

export type PublicResultEvidence = {
  key: string;
  summary: string;
};

export type PublicNodeDeliverable = {
  deliverableKey: string;
  title: string;
  kind: NonNullable<NodeResult["deliverables"]>[number]["kind"];
  status: NonNullable<NodeResult["deliverables"]>[number]["status"];
  summary?: string;
  presentation: NonNullable<NodeResult["deliverables"]>[number]["presentation"];
  placement: NonNullable<NodeResult["deliverables"]>[number]["placement"];
};

export type PublicSelectedBranch = {
  label: string;
  nextNodeId: string;
  source: "user" | "ai" | "system" | "default";
};

export type PublicNodeReview = {
  required: boolean;
  status: "pending" | "accepted" | "rejected" | "request_changes";
  feedback?: string;
  reviewedAt?: string;
};

export type PublicEffectivePlanNodeResult = {
  outputSummary?: string;
  inputFields?: NonNullable<NodeResult["inputFields"]>;
  deliverables?: PublicNodeDeliverable[];
  findings?: PublicResultContribution[];
  decisions?: PublicResultContribution[];
  caveats?: PublicResultContribution[];
  nextActions?: PublicResultContribution[];
  resultEvidence?: PublicResultEvidence[];
  error?: { present: true; message: "Node execution failed." };
  actionForm?: NonNullable<NodeResult["actionForm"]>;
  waitKind?: NonNullable<NodeResult["waitKind"]>;
  review?: PublicNodeReview;
  selectedBranch?: PublicSelectedBranch;
};

export type PublicEffectivePlanNode = {
  id: string;
  nodeId: string;
  semanticKey: string;
  invalidated: boolean;
  waitKind?: EffectivePlanNode["waitKind"];
  reviewRequired?: boolean;
  localId: string;
  type: EffectivePlanNode["type"];
  title: string;
  description?: string;
  priority?: EffectivePlanNode["priority"];
  linkedTaskId?: string;
  config: EffectivePlanNode["config"];
  executor?: EffectivePlanNode["executor"];
  mode?: EffectivePlanNode["mode"];
  estimatedMinutes?: number;
  dependencies: string[];
  dependents: string[];
  status: EffectivePlanNode["status"];
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  result?: PublicEffectivePlanNodeResult;
  blockedReason?: string;
  error?: { present: true; message: "Node execution failed." };
  dependenciesSatisfied: boolean;
  ready: boolean;
  reachable: boolean;
};

export type PublicEffectivePlanEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  active: boolean;
};

export type PublicEffectivePlanGraph = {
  graphId: string;
  basePlanId: string;
  resolvedAt: string;
  resolvedVersion: number;
  nodes: PublicEffectivePlanNode[];
  edges: PublicEffectivePlanEdge[];
  entryNodeIds: string[];
  terminalNodeIds: string[];
  readyNodeIds: string[];
  blockedNodeIds: string[];
  waitingNodeIds: string[];
  waitingForUserNodeIds: string[];
  waitingForApprovalNodeIds: string[];
  degradedNodeIds: string[];
  skippedNodeIds: string[];
  cancelledNodeIds: string[];
  completedNodeIds: string[];
  runningNodeIds: string[];
  invalidatedNodeIds: string[];
  failedNodeIds: string[];
  pendingNodeIds: string[];
};

function projectContribution(item: NonNullable<NodeResult["findings"]>[number]): PublicResultContribution {
  return {
    key: item.key,
    ...(item.title !== undefined ? { title: item.title } : {}),
    content: item.content,
    ...(item.importance !== undefined ? { importance: item.importance } : {}),
  };
}

// eslint-disable-next-line complexity -- The public projection explicitly allowlists each optional result field.
export function projectPublicEffectivePlanNodeResult(
  result: NodeResult | null | undefined,
): PublicEffectivePlanNodeResult | undefined {
  if (!result) return undefined;
  return {
    ...(result.outputSummary !== undefined ? { outputSummary: result.outputSummary } : {}),
    ...(result.inputFields !== undefined ? { inputFields: result.inputFields } : {}),
    ...(result.deliverables !== undefined
      ? {
          deliverables: result.deliverables.map((item) => ({
            deliverableKey: item.deliverableKey,
            title: item.title,
            kind: item.kind,
            status: item.status,
            ...(item.summary !== undefined ? { summary: item.summary } : {}),
            presentation: item.presentation,
            placement: item.placement,
          })),
        }
      : {}),
    ...(result.findings !== undefined ? { findings: result.findings.map(projectContribution) } : {}),
    ...(result.decisions !== undefined ? { decisions: result.decisions.map(projectContribution) } : {}),
    ...(result.caveats !== undefined ? { caveats: result.caveats.map(projectContribution) } : {}),
    ...(result.nextActions !== undefined ? { nextActions: result.nextActions.map(projectContribution) } : {}),
    ...(result.resultEvidence !== undefined
      ? { resultEvidence: result.resultEvidence.map((item) => ({ key: item.key, summary: item.summary })) }
      : {}),
    ...(result.error !== undefined ? { error: { present: true as const, message: "Node execution failed." as const } } : {}),
    ...(result.actionForm !== undefined ? { actionForm: result.actionForm } : {}),
    ...(result.waitKind !== undefined ? { waitKind: result.waitKind } : {}),
    ...(result.review !== undefined
      ? {
          review: {
            required: result.review.required,
            status: result.review.status,
            ...(result.review.feedback !== undefined ? { feedback: result.review.feedback } : {}),
            ...(result.review.reviewedAt !== undefined ? { reviewedAt: result.review.reviewedAt } : {}),
          },
        }
      : {}),
    ...(result.selectedBranch !== undefined
      ? {
          selectedBranch: {
            label: result.selectedBranch.label,
            nextNodeId: result.selectedBranch.nextNodeId,
            source: result.selectedBranch.source,
          },
        }
      : {}),
  };
}

// eslint-disable-next-line complexity -- The public projection explicitly allowlists each optional node field.
export function projectPublicEffectivePlanNode(node: EffectivePlanNode): PublicEffectivePlanNode {
  const result = projectPublicEffectivePlanNodeResult(node.result);
  return {
    id: node.id,
    nodeId: node.nodeId,
    semanticKey: node.semanticKey,
    invalidated: node.invalidated,
    ...(node.waitKind !== undefined ? { waitKind: node.waitKind } : {}),
    ...(node.reviewRequired !== undefined ? { reviewRequired: node.reviewRequired } : {}),
    localId: node.localId,
    type: node.type,
    title: node.title,
    ...(node.description !== undefined ? { description: node.description } : {}),
    ...(node.priority !== undefined ? { priority: node.priority } : {}),
    ...(node.linkedTaskId !== undefined ? { linkedTaskId: node.linkedTaskId } : {}),
    config: node.config,
    ...(node.executor !== undefined ? { executor: node.executor } : {}),
    ...(node.mode !== undefined ? { mode: node.mode } : {}),
    ...(node.estimatedMinutes !== undefined ? { estimatedMinutes: node.estimatedMinutes } : {}),
    dependencies: [...node.dependencies],
    dependents: [...node.dependents],
    status: node.status,
    attempts: node.attempts,
    ...(node.startedAt !== undefined ? { startedAt: node.startedAt } : {}),
    ...(node.completedAt !== undefined ? { completedAt: node.completedAt } : {}),
    ...(result !== undefined ? { result } : {}),
    ...(node.blockedReason !== undefined ? { blockedReason: node.blockedReason } : {}),
    ...(node.lastError !== undefined ? { error: { present: true as const, message: "Node execution failed." as const } } : {}),
    dependenciesSatisfied: node.dependenciesSatisfied,
    ready: node.ready,
    reachable: node.reachable,
  };
}

export function projectPublicEffectivePlanGraph(graph: EffectivePlanGraph): PublicEffectivePlanGraph {
  return {
    graphId: graph.graphId,
    basePlanId: graph.basePlanId,
    resolvedAt: graph.resolvedAt,
    resolvedVersion: graph.resolvedVersion,
    nodes: graph.nodes.map(projectPublicEffectivePlanNode),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      ...(edge.label !== undefined ? { label: edge.label } : {}),
      active: edge.active,
    })),
    entryNodeIds: [...graph.entryNodeIds],
    terminalNodeIds: [...graph.terminalNodeIds],
    readyNodeIds: [...graph.readyNodeIds],
    blockedNodeIds: [...graph.blockedNodeIds],
    waitingNodeIds: [...graph.waitingNodeIds],
    waitingForUserNodeIds: [...graph.waitingForUserNodeIds],
    waitingForApprovalNodeIds: [...graph.waitingForApprovalNodeIds],
    degradedNodeIds: [...graph.degradedNodeIds],
    skippedNodeIds: [...graph.skippedNodeIds],
    cancelledNodeIds: [...graph.cancelledNodeIds],
    completedNodeIds: [...graph.completedNodeIds],
    runningNodeIds: [...graph.runningNodeIds],
    invalidatedNodeIds: [...graph.invalidatedNodeIds],
    failedNodeIds: [...graph.failedNodeIds],
    pendingNodeIds: [...graph.pendingNodeIds],
  };
}
