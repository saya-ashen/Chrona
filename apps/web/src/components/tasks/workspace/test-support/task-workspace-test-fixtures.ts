import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import type { TaskPageData } from "../model/task-workspace-types";

type TaskWorkspaceFixturePageOverrides = Omit<Partial<TaskPageData>, "task"> & {
  task?: Partial<TaskPageData["task"]>;
};

export function createTaskWorkspaceFixtureNode(
  input: Partial<PlanNodeDataModel> & { id: string; status: PlanNodeDataModel["status"] },
): PlanNodeDataModel {
  return {
    id: input.id,
    title: input.title ?? input.id,
    objective: input.objective ?? "Complete workspace step",
    phase: input.phase ?? "Execution",
    kind: input.kind,
    type: input.type,
    displayType: input.displayType,
    status: input.status,
    interactionType: input.interactionType,
    intent: input.intent,
    group: input.group,
    summary: input.summary,
    statusLabel: input.statusLabel,
    readiness: input.readiness,
    nextAction: input.nextAction,
    completionSummary: input.completionSummary,
    result: input.result,
    resultOutputs: input.resultOutputs,
    resultEvidence: input.resultEvidence,
    availableActions: input.availableActions,
    interactiveFields: input.interactiveFields,
    requiresHumanInput: input.requiresHumanInput,
    dependencies: input.dependencies,
    requiredInfo: input.requiredInfo,
    executionMode: input.executionMode,
    estimatedMinutes: input.estimatedMinutes,
    priority: input.priority,
    branchLabels: input.branchLabels,
    options: input.options,
    metadata: input.metadata,
  };
}

export function createTaskWorkspaceFixtureGraph(
  nodes: PlanNodeDataModel[],
  currentStepId: string | null = null,
): TaskPlanGraphPlan {
  return {
    state: nodes.length > 0 ? "ready" : "empty",
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `${nodes[index]?.id ?? "node"}-${node.id}`,
      from: nodes[index]?.id,
      to: node.id,
      kind: "sequential",
    })),
    steps: nodes,
    currentStepId,
    analytics: {
      entryNodeIds: nodes[0] ? [nodes[0].id] : [],
      terminalNodeIds: nodes.at(-1) ? [nodes.at(-1)!.id] : [],
      activeNodeIds: nodes.filter((node) => node.status === "active" || node.status === "in_progress").map((node) => node.id),
      reachableFromActiveIds: [],
      criticalPathNodeIds: nodes.map((node) => node.id),
      attentionNodeIds: nodes.filter((node) => node.status === "waiting_for_user" || node.status === "blocked").map((node) => node.id),
      blockedNodeIds: nodes.filter((node) => node.status === "blocked").map((node) => node.id),
      rankByNodeId: Object.fromEntries(nodes.map((node, index) => [node.id, index])),
      laneByNodeId: Object.fromEntries(nodes.map((node) => [node.id, 0])),
      upstreamByNodeId: {},
      downstreamByNodeId: {},
    },
  };
}

export function createTaskWorkspaceFixturePageData(overrides: TaskWorkspaceFixturePageOverrides = {}): TaskPageData {
  const { task: taskOverrides = {}, ...pageOverrides } = overrides;

  return {
    defaultExecutionRuntime: "local",
    executionRuntimes: [],
    task: {
      id: "task-1",
      workspaceId: "workspace-1",
      title: "Launch task",
      description: null,
      executionRuntime: "local",
      executionConfig: null,
      status: "Ready",
      priority: "High",
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduleStatus: "Unscheduled",
      scheduleSource: null,
      isRunnable: true,
      runnabilitySummary: "Ready to run",
      blockReason: null,
      dependencies: [],
      ...taskOverrides,
    },
    latestRunSummary: null,
    scheduleProposals: [],
    approvals: [],
    artifacts: [],
    ...pageOverrides,
  };
}

export const taskWorkspaceStateFixtures = {
  running: {
    pageData: createTaskWorkspaceFixturePageData({ task: { status: "Running" } }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "research", status: "done", completionSummary: "Research complete" }),
      createTaskWorkspaceFixtureNode({ id: "execute", status: "active", statusLabel: "Running" }),
    ], "execute"),
  },
  waiting: {
    pageData: createTaskWorkspaceFixturePageData({ task: { status: "Queued", scheduleStatus: "Scheduled" } }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "queued", status: "waiting", nextAction: "Wait for dependency" }),
    ], "queued"),
  },
  approvalNeeded: {
    pageData: createTaskWorkspaceFixturePageData({
      approvals: [{ id: "approval-1", title: "Approve result", status: "Pending", requestedAt: "2026-05-12T11:00:00.000Z" }],
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "approval", status: "waiting_for_user", requiresHumanInput: true, nextAction: "Approve result" }),
    ], "approval"),
  },
  empty: {
    pageData: createTaskWorkspaceFixturePageData(),
    graphPlan: createTaskWorkspaceFixtureGraph([]),
  },
  artifactPresent: {
    pageData: createTaskWorkspaceFixturePageData({
      artifacts: [{ id: "artifact-1", title: "Report", type: "markdown", uri: "file://report.md" }],
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "done", status: "done", resultOutputs: [{ kind: "text", content: "summary" }] }),
    ], "done"),
  },
  staleError: {
    pageData: createTaskWorkspaceFixturePageData({
      task: { status: "Blocked", isRunnable: false, runnabilitySummary: "Execution data is stale" },
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "blocked", status: "blocked", nextAction: "Retry refresh" }),
    ], "blocked"),
  },
  permissionLimited: {
    pageData: createTaskWorkspaceFixturePageData({
      task: { status: "Ready", isRunnable: false, runnabilitySummary: "You can view this task, but cannot run it" },
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "view-only", status: "ready", availableActions: [] }),
    ], "view-only"),
  },
};
