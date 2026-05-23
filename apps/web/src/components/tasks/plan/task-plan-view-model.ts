import { webPlanNodeStatusForRuntimeStatus } from "@chrona/contracts/ai";
import type {
  CheckpointConfig,
  CompiledPlan,
  CompiledNode,
  ConditionConfig,
  EffectivePlanNode,
  NodeConfig,
  TaskConfig,
  TaskPlanReadModel,
  WaitConfig,
} from "@chrona/contracts/ai";
import type {
  PlanEdgeDataModel,
  PlanGraphAnalytics,
  PlanNodeAction,
  PlanNodeDataModel,
  PlanNodeField,
  PlanNodeInteractionType,
  PlanNodeIntent,
  PlanNodeKind,
  PlanNodeStatus,
  TaskPlanGraphPlan,
} from "@/components/tasks/plan/task-plan-graph";

type PlanMetadata = {
  executor: string | null;
  mode: string | null;
  checkpointType?: string;
  prompt?: string;
  required?: boolean;
  options?: string[];
  inputFields?: Array<{ key?: string; label?: string; type?: string; required?: boolean; options?: string[] }>;
  condition?: string;
  evaluationBy?: string;
  branches?: Array<{ label?: string }>;
  defaultNextNodeId?: string;
  waitFor?: string;
  timeout?: { minutes?: number };
  expectedOutput?: string;
  completionCriteria?: string[];
};

type NodeResultActionForm = NonNullable<EffectivePlanNode["result"]>["actionForm"];

export type TaskPlanViewModelCopy = {
  statusActive: string;
  statusWaiting: string;
  statusWaitingForUser: string;
  statusWaitingForApproval: string;
  statusBlocked: string;
  statusFailed: string;
  statusDegraded: string;
  statusDone: string;
  statusReady: string;
  statusSkipped: string;
  statusCancelled: string;
  statusInvalidated: string;
  statusIdle: string;
  inputLabelPrefix: string;
  decisionLabel: string;
  approvalDecisionLabel: string;
  resolveBlockerAction: string;
  retryNodeAction: string;
  approveAction: string;
  submitChoiceAction: string;
  submitEditAction: string;
  submitInputAction: string;
  startPlanAction: string;
  continueRunAction: string;
  branchLabelPrefix: string;
};

const DEFAULT_VIEW_MODEL_COPY: TaskPlanViewModelCopy = {
  statusActive: "In progress",
  statusWaiting: "Waiting",
  statusWaitingForUser: "Waiting for input",
  statusWaitingForApproval: "Waiting for approval",
  statusBlocked: "Blocked",
  statusFailed: "Failed",
  statusDegraded: "Degraded",
  statusDone: "Done",
  statusReady: "Ready",
  statusSkipped: "Skipped",
  statusCancelled: "Cancelled",
  statusInvalidated: "Invalidated",
  statusIdle: "Not started",
  inputLabelPrefix: "Input",
  decisionLabel: "Decision",
  approvalDecisionLabel: "Approval decision",
  resolveBlockerAction: "Resolve blocker",
  retryNodeAction: "Retry node",
  approveAction: "Approve",
  submitChoiceAction: "Submit choice",
  submitEditAction: "Submit changes",
  submitInputAction: "Submit input",
  startPlanAction: "Start plan",
  continueRunAction: "Continue run",
  branchLabelPrefix: "Branch",
};

function resolveViewModelCopy(copy?: Partial<TaskPlanViewModelCopy>): TaskPlanViewModelCopy {
  return { ...DEFAULT_VIEW_MODEL_COPY, ...copy };
}

function normalizePlanNodeKind(rawType: unknown): PlanNodeKind {
  switch (rawType) {
    case "task":
    case "checkpoint":
    case "condition":
    case "wait":
      return rawType;
    case "decision":
      return "condition";
    case "user_input":
      return "checkpoint";
    default:
      return "task";
  }
}

function normalizeStatus(status: EffectivePlanNode["status"] | null | undefined): PlanNodeStatus {
  return webPlanNodeStatusForRuntimeStatus(status);
}

function isManualActionBlocked(node: {
  status?: EffectivePlanNode["status"] | null;
  blockedReason?: string | null;
  lastError?: string | null;
  result?: EffectivePlanNode["result"] | null;
}) {
  if (node.status !== "waiting") return false;
  return Boolean(node.blockedReason?.trim() || node.lastError?.trim() || node.result?.waitKind === "manual_action");
}

function resolveBlockedNodeAction(node: {
  nextAction?: string | null;
  blockedReason?: string | null;
  lastError?: string | null;
  result?: EffectivePlanNode["result"] | null;
}) {
  return node.nextAction?.trim()
    || node.blockedReason?.trim()
    || node.lastError?.trim()
    || node.result?.error?.trim()
    || "Resolve the blocker before continuing execution.";
}

function inferIntent(kind: PlanNodeKind, metadata: PlanMetadata, status: PlanNodeStatus): PlanNodeIntent {
  if (kind === "condition") return "decision";
  if (kind === "wait") return "pause";
  if (kind === "checkpoint") {
    if (metadata.checkpointType === "approve" || status === "waiting") return "approval";
    return "input";
  }
  return "execution";
}

function inferInteractionType(input: {
  kind: PlanNodeKind;
  metadata: PlanMetadata;
  status: PlanNodeStatus;
  hasInteractiveFields: boolean;
  hasOptions: boolean;
  nextAction: string | null | undefined;
}): PlanNodeInteractionType {
  if (input.status === "blocked") {
    return "retry";
  }

  if (isTerminalStatus(input.status)) {
    return "observe";
  }

  if (input.kind === "wait") {
    return "wait";
  }

  if (input.kind === "condition") {
    return input.status === "waiting" || isAttentionPlanStatus(input.status) ? "choose" : "observe";
  }

  if (input.kind === "checkpoint") {
    switch (input.metadata.checkpointType) {
      case "approve":
        return "approve";
      case "confirm":
        return "confirm";
      case "choose":
        return "choose";
      case "edit":
        return "edit";
      case "input":
        return "input";
      default:
        if (input.hasOptions) return "choose";
        if (input.hasInteractiveFields) return "input";
        return input.status === "waiting" ? "confirm" : "observe";
    }
  }

  if (input.status === "ready") {
    return "execute";
  }

  if (input.status === "active") {
    return "observe";
  }

  if (input.nextAction?.trim()) {
    return "observe";
  }

  return "observe";
}

function statusLabel(status: PlanNodeStatus, copy: TaskPlanViewModelCopy) {
  switch (status) {
    case "active":
      return copy.statusActive;
    case "waiting":
      return copy.statusWaiting;
    case "waiting_for_user":
      return copy.statusWaitingForUser;
    case "waiting_for_approval":
      return copy.statusWaitingForApproval;
    case "blocked":
      return copy.statusBlocked;
    case "failed":
      return copy.statusFailed;
    case "degraded":
      return copy.statusDegraded;
    case "done":
      return copy.statusDone;
    case "ready":
      return copy.statusReady;
    case "skipped":
      return copy.statusSkipped;
    case "cancelled":
      return copy.statusCancelled;
    case "invalidated":
      return copy.statusInvalidated;
    default:
      return copy.statusIdle;
  }
}

function statusGroup(status: PlanNodeStatus): PlanNodeDataModel["group"] {
  if (status === "active") return "active";
  if (status === "waiting" || status === "waiting_for_user" || status === "waiting_for_approval" || status === "blocked" || status === "failed" || status === "degraded") return "attention";
  if (status === "done" || status === "skipped" || status === "cancelled" || status === "invalidated") return "done";
  if (status === "ready") return "upcoming";
  return "idle";
}

function isTerminalStatus(status: PlanNodeStatus) {
  return status === "done" || status === "skipped" || status === "cancelled" || status === "invalidated";
}

function isAttentionPlanStatus(status: PlanNodeStatus) {
  return status === "waiting_for_user"
    || status === "waiting_for_approval"
    || status === "blocked"
    || status === "failed"
    || status === "degraded";
}

function nodeConfigToMetadata(node: {
  config: NodeConfig;
  executor?: string;
  mode?: string;
}): PlanMetadata {
  const base = {
    executor: node.executor ?? null,
    mode: node.mode ?? null,
  };

  if ("checkpointType" in node.config) {
    const config = node.config as CheckpointConfig;
    return {
      ...base,
      checkpointType: config.checkpointType,
      prompt: config.prompt,
      required: config.required,
      options: config.options,
      inputFields: config.inputFields,
    };
  }

  if ("condition" in node.config) {
    const config = node.config as ConditionConfig;
    return {
      ...base,
      condition: config.condition,
      evaluationBy: config.evaluationBy,
      branches: config.branches,
      defaultNextNodeId: config.defaultNextNodeId,
    };
  }

  if ("waitFor" in node.config) {
    const config = node.config as WaitConfig;
    return {
      ...base,
      waitFor: config.waitFor,
      timeout: config.timeout,
    };
  }

  const config = node.config as TaskConfig;
  return {
    ...base,
    expectedOutput: config.expectedOutput,
    completionCriteria: Array.isArray(config.completionCriteria)
      ? config.completionCriteria.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

function buildInteractiveFields(node: {
  kind: PlanNodeKind;
  metadata: PlanMetadata;
  requiredInfo: string[];
  actionForm?: NodeResultActionForm | null;
  copy: TaskPlanViewModelCopy;
}): PlanNodeField[] {
  const fields: PlanNodeField[] = [];

  if (node.actionForm?.inputFields?.length) {
    for (const [index, input] of node.actionForm.inputFields.entries()) {
      fields.push({
        key: input.name || `blocker:${index}`,
        label: input.label || `${node.copy.inputLabelPrefix} ${index + 1}`,
        value: "",
        control: input.type === "textarea" ? "textarea" : input.options?.length ? "select" : "text",
        required: input.required ?? false,
        options: input.options,
      });
    }
    return fields;
  }

  for (const item of node.requiredInfo) {
    fields.push({
      key: `required:${item}`,
      label: item,
      value: "",
      control: "text",
      required: true,
    });
  }

  if (node.kind === "checkpoint" && node.metadata.inputFields?.length) {
    for (const [index, input] of node.metadata.inputFields.entries()) {
      fields.push({
        key: input.key ?? `checkpoint:${index}`,
        label: input.label ?? `${node.copy.inputLabelPrefix} ${index + 1}`,
        value: "",
        control: input.type === "textarea" ? "textarea" : input.options?.length ? "select" : "text",
        required: input.required ?? false,
        options: input.options,
      });
    }
  }

  if (node.kind === "checkpoint" && node.metadata.options?.length) {
    fields.push({
      key: "checkpoint:decision",
      label: node.copy.decisionLabel,
      value: "",
      control: "approval",
      required: Boolean(node.metadata.required),
      options: node.metadata.options,
    });
  }

  if (
    node.kind === "checkpoint" &&
    (node.metadata.checkpointType === "approve" || node.metadata.checkpointType === "confirm") &&
    !fields.some((field) => field.key === "checkpoint:decision")
  ) {
    fields.push({
      key: "checkpoint:decision",
      label: node.copy.approvalDecisionLabel,
      value: "",
      control: "approval",
      required: node.metadata.required ?? true,
      options: ["Approve", "Reject"],
    });
  }

  return fields;
}

function buildAvailableActions(node: {
  id: string;
  status: PlanNodeStatus;
  interactionType: PlanNodeInteractionType;
  hasInteractiveFields: boolean;
  copy: TaskPlanViewModelCopy;
}): PlanNodeAction[] {
  const actions: PlanNodeAction[] = [];

  if (node.interactionType === "retry") {
    actions.push({
      id: `${node.id}:resolve`,
      label: node.copy.resolveBlockerAction,
      kind: "resolve",
      emphasis: "primary",
    });
    actions.push({
      id: `${node.id}:retry`,
      label: node.copy.retryNodeAction,
      kind: "retry",
      emphasis: "warning",
    });
    return actions;
  }

  if (node.interactionType === "approve") {
    actions.push({
      id: `${node.id}:approve`,
      label: node.copy.approveAction,
      kind: "approve",
      emphasis: "primary",
    });
    return actions;
  }

  if (node.interactionType === "confirm") {
    actions.push({
      id: `${node.id}:confirm`,
      label: node.copy.approveAction,
      kind: "approve",
      emphasis: "primary",
    });
    return actions;
  }

  if (node.interactionType === "choose") {
    actions.push({
      id: `${node.id}:choose`,
      label: node.copy.submitChoiceAction,
      kind: "choose",
      emphasis: "primary",
    });
    return actions;
  }

  if (node.interactionType === "edit") {
    actions.push({
      id: `${node.id}:edit`,
      label: node.copy.submitEditAction,
      kind: "edit",
      emphasis: "primary",
    });
    return actions;
  }

  if (node.interactionType === "input" || node.hasInteractiveFields) {
    actions.push({
      id: `${node.id}:input`,
      label: node.copy.submitInputAction,
      kind: "input",
      emphasis: "primary",
    });
    return actions;
  }

  if (node.interactionType === "execute") {
    actions.push({
      id: `${node.id}:start`,
      label: node.copy.startPlanAction,
      kind: "trigger",
      emphasis: "primary",
    });
    return actions;
  }

  if (node.interactionType === "observe" && (node.status === "ready" || node.status === "active")) {
    actions.push({
      id: `${node.id}:open`,
      label: node.status === "ready" ? node.copy.startPlanAction : node.copy.continueRunAction,
      kind: node.status === "ready" ? "trigger" : "observe",
      emphasis: node.status === "ready" ? "primary" : "default",
    });
    return actions;
  }

  return actions;
}

function buildNodeSummary(kind: PlanNodeKind, metadata: PlanMetadata, objective: string) {
  if (kind === "condition") return metadata.condition ?? objective;
  if (kind === "wait") return metadata.waitFor ?? objective;
  if (kind === "checkpoint") return metadata.prompt ?? objective;
  return metadata.expectedOutput ?? objective;
}

function toPlanNode(node: {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  mode?: string | null;
  executor?: string | null;
  linkedTaskId?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
  dependencies?: string[];
  requiredInfo?: string[];
  status?: EffectivePlanNode["status"] | null;
  blockedReason?: string | null;
  lastError?: string | null;
  ready?: boolean;
  reachable?: boolean;
  result?: EffectivePlanNode["result"] | null;
  nextAction?: string | null;
  config: NodeConfig;
  copy: TaskPlanViewModelCopy;
}): PlanNodeDataModel {
  const kind = normalizePlanNodeKind(node.type);
  const metadata = nodeConfigToMetadata({
    config: node.config,
    executor: node.executor ?? undefined,
    mode: node.mode ?? undefined,
  });
  const status = isManualActionBlocked(node) ? "blocked" : normalizeStatus(node.status);
  const objective = node.description ?? node.title;
  const actionForm = node.result?.actionForm ?? null;
  const nextAction = status === "blocked" ? (actionForm?.instructions ?? resolveBlockedNodeAction(node)) : (node.nextAction ?? null);
  const requiredInfo = node.requiredInfo ?? [];
  const interactiveFields = buildInteractiveFields({ kind, metadata, requiredInfo, actionForm, copy: node.copy });
  const intent = inferIntent(kind, metadata, status);
  const interactionType = inferInteractionType({
    kind,
    metadata,
    status,
    hasInteractiveFields: interactiveFields.length > 0,
    hasOptions: (metadata.options?.length ?? 0) > 0,
    nextAction,
  });

  return {
    id: node.id,
    title: node.title,
    summary: buildNodeSummary(kind, metadata, objective),
    objective,
    phase: node.type,
    kind,
    status,
    intent,
    interactionType,
    group: statusGroup(status),
    statusLabel: statusLabel(status, node.copy),
    badges: [kind, intent, node.mode].filter((value): value is string => Boolean(value)),
    executionMode: node.mode ?? metadata.mode,
    executor: node.executor ?? metadata.executor,
    estimatedMinutes: node.estimatedMinutes ?? null,
    priority: node.priority ?? null,
    linkedTaskId: node.linkedTaskId ?? null,
    readiness: node.ready ? "ready" : isAttentionPlanStatus(status) ? "blocked" : "waiting",
    reachable: node.reachable ?? true,
    dependencies: node.dependencies ?? [],
    requiredInfo,
    nextAction,
    completionSummary: node.result?.outputSummary ?? null,
    result: node.result ?? null,
    inputFields: node.result?.inputFields,
    resultOutputs: node.result?.outputs ?? [],
    resultEvidence: node.result?.evidence ?? null,
    branchLabels: metadata.branches?.map((branch, index) => branch.label ?? `${node.copy.branchLabelPrefix} ${index + 1}`) ?? [],
    options: metadata.options ?? [],
    active: status === "active",
    blocked: isAttentionPlanStatus(status),
    actionable:
      !isTerminalStatus(status) && (
        interactiveFields.length > 0
        || status === "ready"
        || status === "active"
        || isAttentionPlanStatus(status)
      ),
    interactiveFields,
    availableActions: buildAvailableActions({
      id: node.id,
      status,
      interactionType,
      hasInteractiveFields: !isTerminalStatus(status) && interactiveFields.length > 0,
      copy: node.copy,
    }),
    metadata: {
      ...(metadata as Record<string, unknown>),
      ...(node.result?.error ? { error: node.result.error } : {}),
      ...(node.result?.errorDetails ? { errorDetails: node.result.errorDetails } : {}),
    },
  };
}

function edgeKindFromLabel(label: string | null | undefined, sourceKind: PlanNodeKind): PlanEdgeDataModel["kind"] {
  const value = (label ?? "").toLowerCase();
  if (sourceKind === "condition") {
    if (value === "true" || value === "yes") return "branch_true";
    if (value === "false" || value === "no") return "branch_false";
    return "branch_option";
  }
  if (value.includes("depend")) return "dependency";
  if (value.includes("resume")) return "resume";
  return "sequential";
}

function buildAnalytics(nodes: PlanNodeDataModel[], edges: PlanEdgeDataModel[]): PlanGraphAnalytics {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const activeNodes = nodes.filter((node) => node.reachable !== false && node.status !== "skipped");
  const activeNodeIds = new Set(activeNodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }

  for (const edge of edges) {
    if (edge.active === false) continue;
    const from = edge.from ?? edge.fromNodeId;
    const to = edge.to ?? edge.toNodeId;
    if (!from || !to) continue;
    if (!activeNodeIds.has(from) || !activeNodeIds.has(to)) continue;
    incoming.get(to)?.push(from);
    outgoing.get(from)?.push(to);
  }

  const entryNodeIds = activeNodes.filter((node) => (incoming.get(node.id)?.length ?? 0) === 0).map((node) => node.id);
  const terminalNodeIds = activeNodes.filter((node) => (outgoing.get(node.id)?.length ?? 0) === 0).map((node) => node.id);
  const runningNodeIds = activeNodes.filter((node) => node.status === "active").map((node) => node.id);
  const attentionNodeIds = nodes.filter((node) => node.status === "waiting" || isAttentionPlanStatus(node.status)).map((node) => node.id);
  const blockedNodeIds = nodes.filter((node) => isAttentionPlanStatus(node.status)).map((node) => node.id);

  const indegree = new Map<string, number>();
  for (const node of nodes) indegree.set(node.id, incoming.get(node.id)?.length ?? 0);
  const queue = [...entryNodeIds];
  const topo: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    topo.push(current);
    for (const next of outgoing.get(current) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }

  const rankByNodeId: Record<string, number> = {};
  for (const nodeId of topo) {
    const parents = incoming.get(nodeId) ?? [];
    rankByNodeId[nodeId] = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => rankByNodeId[parent] ?? 0)) + 1;
  }
  for (const node of nodes) {
    rankByNodeId[node.id] ??= 0;
  }

  const laneByNodeId: Record<string, number> = {};
  const rankGroups = new Map<number, string[]>();
  for (const node of nodes) {
    const rank = rankByNodeId[node.id] ?? 0;
    const group = rankGroups.get(rank) ?? [];
    group.push(node.id);
    rankGroups.set(rank, group);
  }
  for (const ids of rankGroups.values()) {
    ids.sort((left, right) => {
      const leftNode = nodeMap.get(left);
      const rightNode = nodeMap.get(right);
      return Number(Boolean(rightNode?.active)) - Number(Boolean(leftNode?.active)) || left.localeCompare(right);
    });
    ids.forEach((id, index) => {
      laneByNodeId[id] = index;
    });
  }

  const reachable = new Set<string>();
  const walk = (starts: string[]) => {
    const pending = [...starts];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || reachable.has(current)) continue;
      reachable.add(current);
      for (const next of outgoing.get(current) ?? []) pending.push(next);
    }
  };
  walk(runningNodeIds.length > 0 ? runningNodeIds : entryNodeIds);

  const distance = new Map<string, number>();
  for (const nodeId of topo) {
    const currentNode = nodeMap.get(nodeId);
    const weight = currentNode?.estimatedMinutes ?? 1;
    const parents = incoming.get(nodeId) ?? [];
    distance.set(
      nodeId,
      parents.length === 0 ? weight : Math.max(...parents.map((parent) => distance.get(parent) ?? 0)) + weight,
    );
  }
  let criticalTail = nodes[0]?.id ?? null;
  for (const node of nodes) {
    if (!criticalTail || (distance.get(node.id) ?? 0) > (distance.get(criticalTail) ?? 0)) {
      criticalTail = node.id;
    }
  }

  const criticalPathNodeIds: string[] = [];
  let cursor = criticalTail;
  while (cursor) {
    criticalPathNodeIds.unshift(cursor);
    const parents = incoming.get(cursor) ?? [];
    if (parents.length === 0) break;
    cursor = parents.reduce((best, parent) => ((distance.get(parent) ?? 0) > (distance.get(best) ?? 0) ? parent : best), parents[0]);
  }

  return {
    entryNodeIds,
    terminalNodeIds,
    activeNodeIds: runningNodeIds,
    reachableFromActiveIds: [...reachable],
    criticalPathNodeIds,
    attentionNodeIds,
    blockedNodeIds,
    rankByNodeId,
    laneByNodeId,
    upstreamByNodeId: Object.fromEntries(nodes.map((node) => [node.id, incoming.get(node.id) ?? []])),
    downstreamByNodeId: Object.fromEntries(nodes.map((node) => [node.id, outgoing.get(node.id) ?? []])),
  };
}

function pickCurrentStepId(nodes: PlanNodeDataModel[]) {
  return nodes.find((node) => node.status === "active")?.id
    ?? nodes.find((node) => node.status === "waiting" || isAttentionPlanStatus(node.status))?.id
    ?? nodes.find((node) => node.status === "ready")?.id
    ?? null;
}

function buildGraphPlan(input: {
  title?: string | null;
  summary?: string | null;
  revision?: string | null;
  generatedBy?: string | null;
  updatedAt?: string | null;
  nodes: PlanNodeDataModel[];
  rawEdges: Array<{ id: string; from: string; to: string; label?: string | null; active?: boolean }>;
}): TaskPlanGraphPlan {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const provisionalEdges = input.rawEdges.map((edge) => {
    const source = nodeById.get(edge.from);
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label ?? null,
      active: edge.active,
      kind: edgeKindFromLabel(edge.label, source?.kind ?? "task"),
      emphasis: edge.active === false ? "inactive" as const : "normal" as const,
    };
  });

  const analytics = buildAnalytics(input.nodes, provisionalEdges);
  const activeSet = new Set(analytics.activeNodeIds);
  const blockedSet = new Set(analytics.blockedNodeIds);
  const edgeEmphasisFor = (edge: { from: string; to: string; active?: boolean }): PlanEdgeDataModel["emphasis"] => {
    if (edge.active === false) return "inactive";
    if (activeSet.has(edge.from) || activeSet.has(edge.to)) return "active";
    if (blockedSet.has(edge.from) || blockedSet.has(edge.to)) return "blocked";
    return "normal";
  };
  const edges = provisionalEdges.map((edge) => ({
    ...edge,
    emphasis: edgeEmphasisFor(edge),
  }));

  return {
    state: input.nodes.length === 0 ? "empty" : "ready",
    graphTitle: input.title ?? null,
    graphSummary: input.summary ?? null,
    revision: input.revision ?? null,
    generatedBy: input.generatedBy ?? null,
    updatedAt: input.updatedAt ?? null,
    nodes: input.nodes,
    edges,
    currentStepId: pickCurrentStepId(input.nodes),
    steps: input.nodes,
    analytics,
  };
}

export function compiledPlanToGraphPlan(
  plan: CompiledPlan | null | undefined,
  copyOverrides?: Partial<TaskPlanViewModelCopy>,
): TaskPlanGraphPlan | null {
  if (!plan?.nodes?.length) return null;
  const copy = resolveViewModelCopy(copyOverrides);

  return buildGraphPlan({
    title: plan.title ?? null,
    summary: plan.goal ?? null,
    revision: plan.sourceVersion ? `r${plan.sourceVersion}` : null,
    generatedBy: null,
    updatedAt: null,
    nodes: plan.nodes.map((node: CompiledNode) =>
      toPlanNode({
        id: node.id,
        title: node.title,
        description: node.description,
        type: node.type,
        mode: node.mode ?? null,
        executor: node.executor ?? null,
        linkedTaskId: node.linkedTaskId ?? null,
        estimatedMinutes: node.estimatedMinutes ?? null,
        priority: node.priority ?? null,
        dependencies: node.dependencies ?? [],
        requiredInfo: [],
        nextAction: null,
        config: node.config,
        copy,
      }),
    ),
    rawEdges: (plan.edges ?? []).map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label ?? null,
    })),
  });
}

export function taskPlanReadModelToGraphPlan(
  readModel: TaskPlanReadModel | null | undefined,
  copyOverrides?: Partial<TaskPlanViewModelCopy>,
): TaskPlanGraphPlan | null {
  if (!readModel?.effectivePlan?.nodes?.length) {
    return readModel?.compiledPlan ? compiledPlanToGraphPlan(readModel.compiledPlan, copyOverrides) : null;
  }

  const copy = resolveViewModelCopy(copyOverrides);

  const readRuntimeArray = (node: EffectivePlanNode, key: string) => {
    const value = (node as unknown as Record<string, unknown>)[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };

  const readRuntimeString = (node: EffectivePlanNode, key: string) => {
    const value = (node as unknown as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  };

  return buildGraphPlan({
    title: readModel.compiledPlan.title ?? null,
    summary: readModel.summary ?? readModel.compiledPlan.goal ?? null,
    revision: `r${readModel.revision}`,
    generatedBy: readModel.generatedBy ?? null,
    updatedAt: readModel.updatedAt ?? null,
    nodes: readModel.effectivePlan.nodes.map((node: EffectivePlanNode) =>
      toPlanNode({
        id: node.id,
        title: node.title,
        description: node.description,
        type: node.type,
        mode: node.mode ?? null,
        executor: node.executor ?? null,
        linkedTaskId: node.linkedTaskId ?? null,
        estimatedMinutes: node.estimatedMinutes ?? null,
        priority: node.priority ?? null,
        dependencies: node.dependencies ?? [],
        requiredInfo: readRuntimeArray(node, "requiredInfo"),
        status: node.status,
        blockedReason: node.blockedReason,
        lastError: node.lastError,
        ready: node.ready,
        reachable: node.reachable,
        result: node.result,
        nextAction: readRuntimeString(node, "nextAction"),
        config: node.config,
        copy,
      }),
    ),
    rawEdges: readModel.effectivePlan.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label ?? null,
      active: edge.active,
    })),
  });
}

export function summarizeCompiledPlan(plan: CompiledPlan | null | undefined) {
  if (!plan) {
    return { totalEstimatedMinutes: 0, nodeCount: 0, warnings: [] as string[] };
  }

  return {
    totalEstimatedMinutes: plan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0),
    nodeCount: plan.nodes.length,
    warnings: plan.validationWarnings.map((warning) => `${warning.path}: ${warning.message}`),
  };
}
