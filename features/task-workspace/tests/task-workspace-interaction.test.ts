import { describe, expect, it } from "vitest";
import type { TaskPlanGraphPlan } from "../../../apps/web/src/components/tasks/plan/task-plan-graph/types";
import type { TaskPageData } from "../model/task-workspace-types";
import {
  deriveTaskWorkspaceDisplayState,
  derivePlanReviewSummary,
  deriveResultReview,
  deriveRunPreview,
  deriveTaskPlanningReadiness,
  deriveTaskWorkspaceStage,
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

  it("summarizes plan review, run preview, and expected human stops", () => {
    const graph = graphPlan();

    expect(derivePlanReviewSummary(graph)).toMatchObject({
      stepCount: 3,
      aiStepCount: 1,
      checkpointCount: 1,
      estimatedMinutes: 10,
      needsUser: ["Review draft report"],
    });
    expect(deriveRunPreview({ pageData: pageData(), graphPlan: graph, currentNode: null })).toMatchObject({
      providerLabel: "omp",
      modeLabel: "Manual checkpoints",
      startNodeLabel: "Fetch trending projects",
      expectedStops: ["Review draft report"],
    });
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

  it("uses one display rule table for fixed panel visibility by mode", () => {
    expect(TASK_WORKSPACE_DISPLAY_RULES.ready_to_run.panels.runPreview).toBe(true);
    expect(TASK_WORKSPACE_DISPLAY_RULES.ready_to_run.panels.planDiffReview).toBe(false);
    expect(TASK_WORKSPACE_DISPLAY_RULES.ready_to_run.panels.readiness).toBe(false);
    expect(TASK_WORKSPACE_DISPLAY_RULES.completed.layout).toBe("result_focus");
    expect(TASK_WORKSPACE_DISPLAY_RULES.completed.panels.resultReview).toBe(true);
    expect(TASK_WORKSPACE_DISPLAY_RULES.completed.panels.selectedNodeDetails).toBe(false);
    expect(TASK_WORKSPACE_DISPLAY_RULES.completed.panels.operationPanel).toBe(false);

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
});
