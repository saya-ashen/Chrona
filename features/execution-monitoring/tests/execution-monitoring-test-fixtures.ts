import type { TaskPlanReadModel } from "@chrona/contracts";
import type {
  PlanNodeDataModel,
  TaskPageData,
  TaskPlanGraphPlan,
  TaskWorkspacePlanFlowState,
} from "../../task-workspace";

function node(
  id: string,
  status: PlanNodeDataModel["status"],
  overrides: Partial<PlanNodeDataModel> = {},
): PlanNodeDataModel {
  return {
    id,
    title: overrides.title ?? id,
    objective: overrides.objective ?? "Complete workspace step",
    phase: overrides.phase ?? "Execution",
    status,
    ...overrides,
  };
}

function graph(nodes: PlanNodeDataModel[], currentStepId?: string): TaskPlanGraphPlan {
  const ids = nodes.map((item) => item.id);
  return {
    state: "ready",
    nodes,
    steps: nodes,
    edges: [],
    currentStepId,
    analytics: {
      entryNodeIds: ids.slice(0, 1),
      terminalNodeIds: ids.slice(-1),
      activeNodeIds: currentStepId ? [currentStepId] : [],
      reachableFromActiveIds: [],
      criticalPathNodeIds: ids,
      attentionNodeIds: [],
      blockedNodeIds: nodes.filter((item) => item.blocked).map((item) => item.id),
      rankByNodeId: Object.fromEntries(ids.map((id, index) => [id, index])),
      laneByNodeId: Object.fromEntries(ids.map((id) => [id, 0])),
      upstreamByNodeId: Object.fromEntries(ids.map((id) => [id, []])),
      downstreamByNodeId: Object.fromEntries(ids.map((id) => [id, []])),
    },
  };
}

function pageData(overrides: Partial<TaskPageData> = {}): TaskPageData {
  const taskOverrides = overrides.task ?? {};
  return {
    defaultExecutionRuntime: "hermes",
    executionRuntimes: [],
    task: {
      id: "task-1",
      workspaceId: "workspace-1",
      title: "Prepare launch brief",
      description: "Research the target user and deliver a concise launch brief.",
      executionRuntime: "hermes",
      executionConfig: {},
      autoPlanGeneration: false,
      autoExecute: false,
      autoPlanGenerationTiming: "manual",
      autoExecuteTiming: "manual",
      status: "Pending",
      priority: "Medium",
      ...taskOverrides,
    },
    latestRunSummary: null,
    scheduleProposals: [],
    approvals: [],
    artifacts: [],
    ...overrides,
  } as TaskPageData;
}

function consoleFixture(status: string, nodes: PlanNodeDataModel[], currentStepId?: string) {
  return {
    pageData: pageData({ task: { status } as TaskPageData["task"] }),
    graphPlan: graph(nodes, currentStepId),
  };
}
const completedNode = node("deliver", "done", {
  title: "Deliver launch brief",
  completionSummary: "Launch brief delivered.",
});

export const executionMonitoringWorkspaceFixtures = {
  empty: { pageData: pageData(), graphPlan: graph([]) },
  running: consoleFixture("Running", [
    node("research", "done", { title: "Research target user", completionSummary: "Research complete" }),
    node("deliver", "active", { title: "Deliver launch brief", active: true }),
  ], "deliver"),
  approvalNeeded: {
    pageData: pageData({ approvals: [{ id: "approval-1", title: "Approve delivery", status: "Pending" }] }),
    graphPlan: graph([node("approve", "waiting_for_user", { title: "Approve delivery", requiresHumanInput: true, nextAction: "Approve delivery" })], "approve"),
  },
  completed: consoleFixture("Done", [completedNode], "deliver"),
  artifactPresent: {
    pageData: pageData({ artifacts: [{ id: "artifact-1", title: "Report", type: "markdown", uri: "file://report.md" }] }),
    graphPlan: graph([completedNode], "deliver"),
  },
};

const waitingPlan = {
  id: "plan-1",
  taskId: "task-1",
  status: "Draft",
  summary: "Research the target user, draft a one-page brief, deliver it to the team channel.",
} as unknown as TaskPlanReadModel;

export const executionMonitoringPlanFixtures: {
  waitingAcceptance: { pageData: TaskPageData; graphPlan: TaskPlanGraphPlan; flow: TaskWorkspacePlanFlowState };
} = {
  waitingAcceptance: {
    pageData: pageData({ task: { savedPlan: waitingPlan } as TaskPageData["task"] }),
    graphPlan: graph([node("research", "pending")], "research"),
    flow: { status: "waiting_acceptance", savedPlan: waitingPlan },
  },
};
