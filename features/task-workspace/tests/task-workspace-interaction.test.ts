import { describe, expect, it } from "vitest";
import type { TaskPlanGraphPlan } from "../../../apps/web/src/components/tasks/plan/task-plan-graph/types";
import type { TaskPageData } from "../model/task-workspace-types";
import {
  deriveRunningExecutionView,
  deriveTaskWorkspaceDisplayState,
  derivePlanReviewSummary,
  deriveResultReview,
  deriveRunPreview,
  deriveTaskPlanningReadiness,
  deriveTaskWorkspaceStage,
  deriveTaskWorkStateView,
  TASK_WORKSPACE_DISPLAY_RULES,
} from "../model/task-workspace-interaction";
import type { TaskWorkspaceOperationState } from "../model/task-workspace-operation-machine";

function pageData(overrides: Partial<TaskPageData> = {}): TaskPageData {
  return {
    defaultExecutionRuntime: "omp",
    executionRuntimes: [],
    availableAiClients: [{ id: "ai_1", name: "OMP", enabled: true }],
    task: {
      id: "task_1",
      workspaceId: "workspace_1",
      title: "Collect GitHub trending",
      description: "Return a summary report. Success means top projects are listed with links.",
      executionRuntime: "omp",
      executionConfig: null,
      aiClientId: "ai_1",
      autoPlanGeneration: false,
      autoExecute: false,
      autoPlanGenerationTiming: "manual",
      autoExecuteTiming: "manual",
      status: "Draft",
      priority: "Medium",
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduleStatus: "Unscheduled",
      scheduleSource: null,
      isRunnable: true,
      runnabilitySummary: "Ready",
      blockReason: null,
      dependencies: [],
    },
    latestRunSummary: null,
    scheduleProposals: [],
    approvals: [],
    artifacts: [],
    ...overrides,
  };
}

function graphPlan(): TaskPlanGraphPlan {
  const nodes: TaskPlanGraphPlan["nodes"] = [
    {
      id: "n1",
      title: "Fetch trending projects",
      objective: "Fetch GitHub trending data from web API",
      phase: "Research",
      type: "task",
      status: "ready",
      executor: "ai",
      estimatedMinutes: 5,
      nextAction: "Collect web data",
    },
    {
      id: "n2",
      title: "Review draft report",
      objective: "Approve the summary before completion",
      phase: "Review",
      type: "checkpoint",
      status: "waiting_for_approval",
      requiresHumanInput: true,
      estimatedMinutes: 3,
    },
    {
      id: "n3",
      title: "Publish result report",
      objective: "Create final report output",
      phase: "Output",
      type: "task",
      status: "idle",
      estimatedMinutes: 2,
      summary: "Write the report artifact",
    },
  ];
  return {
    state: "ready",
    nodes,
    steps: nodes,
    edges: [],
    analytics: {
      entryNodeIds: ["n1"],
      terminalNodeIds: ["n3"],
      activeNodeIds: [],
      reachableFromActiveIds: [],
      criticalPathNodeIds: ["n1", "n2", "n3"],
      attentionNodeIds: ["n2"],
      blockedNodeIds: [],
      rankByNodeId: {},
      laneByNodeId: {},
      upstreamByNodeId: {},
      downstreamByNodeId: {},
    },
  };
}

function operationState(overrides: Partial<TaskWorkspaceOperationState> = {}): TaskWorkspaceOperationState {
  return {
    status: "plan-ready-to-run",
    title: "Ready to run",
    description: "Review run preview, then start execution",
    tone: "info",
    action: "start-plan",
    selectedNode: null,
    currentNode: null,
    runtimeEvents: [],
    hasGraphExecutionStarted: false,
    ...overrides,
  } as TaskWorkspaceOperationState;
}

describe("task workspace interaction model", () => {
  it("derives planning readiness without mutating task state", () => {
    const readiness = deriveTaskPlanningReadiness(pageData({
      task: {
        ...pageData().task,
        description: null,
      },
    }));

    expect(readiness.status).toBe("warning");
    expect(readiness.primaryAction).toBe("generate_plan");
    expect(readiness.checks.find((check) => check.id === "description")?.state).toBe("missing");
  });

  it("derives a manual launch contract without using the inspected node as the start point", () => {
    const launch = deriveRunPreview({ pageData: pageData(), graphPlan: graphPlan() });

    expect(derivePlanReviewSummary(graphPlan())).toMatchObject({
      stepCount: 3,
      aiStepCount: 1,
      checkpointCount: 1,
      estimatedMinutes: 10,
      needsUser: ["Review draft report"],
    });
    expect(launch).toMatchObject({
      readiness: "ready",
      startMode: "manual",
      providerLabel: "OMP",
      runtimeLabel: "omp",
      firstStepLabel: "Fetch trending projects",
      stepCount: 3,
      estimatedMinutes: 10,
      canStartManually: true,
      expectedStops: [{ id: "n2", label: "Review draft report", kind: "approval" }],
    });
  });

  it.each([
    {
      name: "scheduled automatic launch",
      task: { autoExecute: true, scheduledStartAt: "2026-07-10T14:00:00.000Z", scheduledEndAt: "2026-07-10T14:30:00.000Z" },
      expected: { readiness: "scheduled", startMode: "scheduled", canStartManually: true },
    },
    {
      name: "blocked launch without a provider",
      task: { aiClientId: "missing", isRunnable: false, runnabilitySummary: "Connect an AI provider" },
      expected: { readiness: "blocked", recoveryAction: "connect_provider", canStartManually: false, blockerSummary: "Connect an AI provider" },
    },
    {
      name: "blocked launch with incomplete task setup",
      task: { isRunnable: false, runnabilitySummary: "Task configuration is incomplete" },
      expected: { readiness: "blocked", recoveryAction: "edit_task", canStartManually: false, blockerSummary: "Task configuration is incomplete" },
    },
  ])("derives $name", ({ task, expected }) => {
    expect(deriveRunPreview({
      pageData: pageData({ task: { ...pageData().task, ...task } }),
      graphPlan: graphPlan(),
    })).toMatchObject(expected);
  });

  it("keeps Completed and Done distinct in result review stage copy", () => {
    const completedPage = pageData({ task: { ...pageData().task, status: "Completed" } });
    const donePage = pageData({ task: { ...pageData().task, status: "Done" } });

    expect(deriveTaskWorkspaceStage({ pageData: completedPage, graphPlan: graphPlan(), operationState: operationState({ status: "execution-completed", action: "none" } as unknown as Partial<TaskWorkspaceOperationState>) })).toMatchObject({
      stage: "result",
      statusLabel: "Result ready",
      nextActionLabel: "Accept result or request changes",
    });
    expect(deriveTaskWorkspaceStage({ pageData: donePage, graphPlan: graphPlan(), operationState: operationState({ status: "execution-completed", action: "none" } as unknown as Partial<TaskWorkspaceOperationState>) })).toMatchObject({
      stage: "result",
      statusLabel: "Task done",
      nextActionLabel: "Ask a follow-up or create a next task",
    });
    expect(deriveResultReview(completedPage)?.actions.map((action) => action.id)).toEqual(["accept_result", "request_changes"]);
    expect(deriveResultReview(donePage)?.actions.map((action) => action.id)).toEqual(["ask_follow_up", "create_follow_up_task"]);
  });

  it("separates required, recommended, and optional planning readiness", () => {
    const readiness = deriveTaskPlanningReadiness(pageData({
      task: {
        ...pageData().task,
        description: "Do the work",
        dueAt: null,
        scheduledStartAt: null,
        currentWorkBlock: null,
      },
    }));

    expect(readiness.status).toBe("warning");
    expect(readiness.primaryAction).toBe("generate_plan");
    expect(readiness.checks.find((check) => check.id === "success_criteria")).toMatchObject({ level: "recommended", state: "missing", action: "edit_brief" });
    expect(readiness.checks.find((check) => check.id === "schedule")).toMatchObject({ level: "optional", state: "missing" });
    expect(readiness.checks.find((check) => check.id === "provider")).toMatchObject({ level: "required", state: "passed" });
  });

  it("blocks planning with an actionable provider setup route state", () => {
    const input = pageData({
      availableAiClients: [],
      task: {
        ...pageData().task,
        aiClientId: null,
        executionRuntime: "",
      },
    });
    const readiness = deriveTaskPlanningReadiness(input);

    expect(readiness.status).toBe("blocked");
    expect(readiness.primaryAction).toBe("configure_provider");
    expect(readiness.checks.find((check) => check.id === "provider")).toMatchObject({ level: "required", state: "blocked", action: "configure_provider" });
  });
  it("uses one display rule table for fixed panel visibility by mode", () => {
    expect(TASK_WORKSPACE_DISPLAY_RULES.ready_to_run.panels.runPreview).toBe(true);
    expect(TASK_WORKSPACE_DISPLAY_RULES.ready_to_run.panels.planDiffReview).toBe(false);
    expect(TASK_WORKSPACE_DISPLAY_RULES.ready_to_run.panels.readiness).toBe(false);
    expect(TASK_WORKSPACE_DISPLAY_RULES.completed.layout).toBe("result_focus");
    expect(TASK_WORKSPACE_DISPLAY_RULES.completed.panels.resultReview).toBe(true);
    expect(TASK_WORKSPACE_DISPLAY_RULES.completed.panels.selectedNodeDetails).toBe(false);
    expect(TASK_WORKSPACE_DISPLAY_RULES.completed.panels.operationPanel).toBe(false);
    expect(TASK_WORKSPACE_DISPLAY_RULES.reviewing_plan).toMatchObject({
      primarySurface: "plan",
      primaryAction: "accept_plan",
      contextRail: "plan_review",
      collapsedByDefault: ["activity"],
    });
    expect(TASK_WORKSPACE_DISPLAY_RULES.running).toMatchObject({
      primarySurface: "execution",
      primaryAction: "runtime_action",
      contextRail: "current_operation",
    });
    expect(TASK_WORKSPACE_DISPLAY_RULES.blocked).toMatchObject({
      primarySurface: "decision",
      primaryAction: "recover",
      contextRail: "recovery",
      collapsedByDefault: ["diagnostics"],
    });
    expect(TASK_WORKSPACE_DISPLAY_RULES.completed).toMatchObject({
      primarySurface: "result",
      primaryAction: "accept_result",
      contextRail: "result_review",
    });
    expect(TASK_WORKSPACE_DISPLAY_RULES.done).toMatchObject({
      primarySurface: "result",
      primaryAction: "follow_up",
      contextRail: "continuation",
    });

    const readyState = deriveTaskWorkspaceDisplayState({
      pageData: pageData(),
      graphPlan: graphPlan(),
      operationState: operationState(),
      currentNode: null,
    });

    expect(readyState.mode).toBe("ready_to_run");
    expect(readyState.panels).toBe(TASK_WORKSPACE_DISPLAY_RULES.ready_to_run.panels);
    expect(readyState.panels.runPreview).toBe(true);
    expect(readyState.panels.readiness).toBe(false);
  });

  it("maps blocked and completed states to different fixed panel sets", () => {
    const blockedState = deriveTaskWorkspaceDisplayState({
      pageData: pageData({ task: { ...pageData().task, status: "Blocked" } }),
      graphPlan: graphPlan(),
      operationState: operationState({ status: "execution-blocked", action: "none" } as unknown as Partial<TaskWorkspaceOperationState>),
      currentNode: null,
    });
    const completedState = deriveTaskWorkspaceDisplayState({
      pageData: pageData({ task: { ...pageData().task, status: "Completed" } }),
      graphPlan: graphPlan(),
      operationState: operationState({ status: "execution-completed", action: "none" } as unknown as Partial<TaskWorkspaceOperationState>),
      currentNode: null,
    });

    expect(blockedState.mode).toBe("blocked");
    expect(blockedState.panels.operationPanel).toBe(true);
    expect(blockedState.panels.followUpComposer).toBe(true);
    expect(blockedState.panels.runPreview).toBe(false);
    expect(completedState.mode).toBe("completed");
    expect(completedState.layout).toBe("result_focus");
    expect(completedState.panels.operationPanel).toBe(false);
    expect(completedState.panels.selectedNodeDetails).toBe(false);
    expect(completedState.panels.resultReview).toBe(true);
  });

  it("routes workspace state through the shared canonical work-state model", () => {
    const inputWait = deriveTaskWorkStateView({
      pageData: pageData({
        latestRunSummary: {
          id: "run_1",
          status: "waiting_for_user",
          executionState: "waiting_for_user",
          startedAt: "2026-07-09T00:00:00.000Z",
          syncStatus: "synced",
        },
      }),
      graphPlan: graphPlan(),
      operationState: operationState({ status: "execution-action", action: "execution-action" } as unknown as Partial<TaskWorkspaceOperationState>),
    });
    const approvalWait = deriveTaskWorkStateView({
      pageData: pageData({
        latestRunSummary: {
          id: "run_1",
          status: "waiting_for_approval",
          executionState: "waiting_for_approval",
          startedAt: "2026-07-09T00:00:00.000Z",
          syncStatus: "synced",
        },
      }),
      graphPlan: graphPlan(),
      operationState: operationState({ status: "execution-action", action: "execution-action" } as unknown as Partial<TaskWorkspaceOperationState>),
    });
    const resultReady = deriveTaskWorkStateView({
      pageData: pageData({ task: { ...pageData().task, status: "Completed" } }),
      graphPlan: graphPlan(),
      operationState: operationState({ status: "execution-completed", action: "none" } as unknown as Partial<TaskWorkspaceOperationState>),
    });
    const done = deriveTaskWorkStateView({
      pageData: pageData({ task: { ...pageData().task, status: "Done" } }),
      graphPlan: graphPlan(),
      operationState: operationState({ status: "execution-completed", action: "none" } as unknown as Partial<TaskWorkspaceOperationState>),
    });

    expect(inputWait.state).toBe("waiting_for_input");
    expect(inputWait.label).toBe("Input needed");
    expect(approvalWait.state).toBe("waiting_for_approval");
    expect(approvalWait.label).toBe("Approval needed");
    expect(resultReady.state).toBe("result_ready");
    expect(resultReady.nextActionLabel).toBe("Accept result or request changes");
    expect(done.state).toBe("done");
    expect(done.nextActionLabel).toBe("Ask a follow-up or create a next task");
  });
  it.each([
    {
      name: "tracks completed, active, waiting, and remaining nodes",
      statuses: ["completed", "active", "waiting_for_approval"] as const,
      expected: { completed: 1, active: 1, waiting: 1, blocked: 0, remaining: 0 },
    },
    {
      name: "tracks blocked work separately from remaining work",
      statuses: ["done", "failed", "idle"] as const,
      expected: { completed: 1, active: 0, waiting: 0, blocked: 1, remaining: 1 },
    },
  ])("$name", ({ statuses, expected }) => {
    const baseGraph = graphPlan();
    const nodes = baseGraph.nodes.map((node, index) => ({ ...node, status: statuses[index] }));
    const graph = { ...baseGraph, nodes, steps: nodes };
    const activeNode = nodes.find((node) => node.status === "active") ?? null;
    const view = deriveRunningExecutionView({
      pageData: pageData(),
      graphPlan: graph,
      operationState: operationState({ status: "execution-running", action: "none", runtimeEvents: [] } as unknown as Partial<TaskWorkspaceOperationState>),
      currentNode: activeNode,
    });

    expect(view?.progress).toMatchObject({ ...expected, total: 3 });
  });

  it("keeps current step, inspected step, and runtime activity distinct", () => {
    const baseGraph = graphPlan();
    const nodes = baseGraph.nodes.map((node, index) => ({ ...node, status: index === 0 ? "active" as const : node.status }));
    const graph = { ...baseGraph, nodes, steps: nodes };
    const view = deriveRunningExecutionView({
      pageData: pageData(),
      graphPlan: graph,
      operationState: operationState({
        status: "execution-running",
        action: "none",
        runtimeEvents: [
          { type: "runtime_event", action: "start_manual", runtimeName: "omp", provider: "omp", event: { type: "reasoning_delta", text: "private transient reasoning" } },
          { type: "runtime_event", action: "start_manual", runtimeName: "omp", provider: "omp", event: { type: "tool_started", toolName: "browser", label: "Reading GitHub Trending" } },
        ],
      } as unknown as Partial<TaskWorkspaceOperationState>),
      currentNode: nodes[0]!,
      inspectedNode: nodes[2]!,
    });

    expect(view?.currentStep).toMatchObject({ id: "n1", ordinal: 1, label: "Fetch trending projects" });
    expect(view?.inspectedStep).toEqual({ id: "n3", label: "Publish result report", isCurrent: false });
    expect(view?.currentActivity).toEqual({ kind: "tool", label: "Reading GitHub Trending" });
  });

});
