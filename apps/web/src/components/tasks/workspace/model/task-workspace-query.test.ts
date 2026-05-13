import { describe, expect, it } from "vitest";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import {
  buildProgressSummary,
  createTaskWorkspaceExecutionConsoleView,
  mapTaskWorkspaceStatus,
  pickWorkspaceCurrentNode,
} from "./task-workspace-query";
import type { TaskPageData } from "./task-workspace-types";
import { taskWorkspaceStateFixtures } from "../test-support/task-workspace-test-fixtures";

function node(input: Partial<PlanNodeDataModel> & { id: string; status: PlanNodeDataModel["status"] }): PlanNodeDataModel {
  return {
    id: input.id,
    title: input.title ?? input.id,
    objective: input.objective ?? "Do the work",
    phase: input.phase ?? "Phase",
    status: input.status,
    summary: input.summary,
    statusLabel: input.statusLabel,
    nextAction: input.nextAction,
    completionSummary: input.completionSummary,
    result: input.result,
    resultOutputs: input.resultOutputs,
  };
}

function graph(nodes: PlanNodeDataModel[], currentStepId: string | null = null): TaskPlanGraphPlan {
  return {
    state: "ready",
    nodes,
    edges: [],
    steps: nodes,
    currentStepId,
    analytics: {
      entryNodeIds: [],
      terminalNodeIds: [],
      activeNodeIds: [],
      reachableFromActiveIds: [],
      criticalPathNodeIds: [],
      attentionNodeIds: [],
      blockedNodeIds: [],
      rankByNodeId: {},
      laneByNodeId: {},
      upstreamByNodeId: {},
      downstreamByNodeId: {},
    },
  };
}

function pageData(overrides: Partial<TaskPageData> = {}): TaskPageData {
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
    },
    latestRunSummary: null,
    scheduleProposals: [],
    approvals: [],
    artifacts: [],
    ...overrides,
  };
}

describe("task workspace execution console view model", () => {
  it("maps internal statuses to user-facing workspace states", () => {
    expect(mapTaskWorkspaceStatus("done")).toBe("completed");
    expect(mapTaskWorkspaceStatus("in_progress")).toBe("running");
    expect(mapTaskWorkspaceStatus("waiting_for_user")).toBe("approval-needed");
    expect(mapTaskWorkspaceStatus("blocked")).toBe("blocked");
    expect(mapTaskWorkspaceStatus("ready")).toBe("waiting");
  });

  it("returns an empty progress summary when no graph exists", () => {
    expect(buildProgressSummary(null)).toEqual({
      completedSteps: 0,
      totalSteps: 0,
      percentComplete: 0,
      label: "No plan yet",
    });
  });

  it("calculates progress for partial completion", () => {
    expect(buildProgressSummary(graph([
      node({ id: "a", status: "done" }),
      node({ id: "b", status: "ready" }),
      node({ id: "c", status: "idle" }),
    ]))).toMatchObject({ completedSteps: 1, totalSteps: 3, percentComplete: 33 });
  });

  it("prefers selected node before current or active nodes", () => {
    const selected = node({ id: "selected", status: "idle" });
    const current = node({ id: "current", status: "ready" });
    expect(pickWorkspaceCurrentNode(graph([current], "current"), selected)).toBe(selected);
  });

  it("surfaces active node state, latest run, and artifacts", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({
        latestRunSummary: { id: "run-1", status: "Running", startedAt: "2026-05-12T10:00:00.000Z", syncStatus: "syncing" },
        approvals: [{ id: "approval-1", title: "Approve output", status: "Pending", requestedAt: "2026-05-12T10:05:00.000Z" }],
        artifacts: [{ id: "artifact-1", title: "Report", type: "markdown", uri: "file://report.md" }],
      }),
      graphPlan: graph([node({ id: "active", status: "active", statusLabel: "Running" })]),
    });

    expect(view.nodeDetail.currentNode?.id).toBe("active");
    expect(view.header).toMatchObject({ title: "Launch task", status: "running", completedSteps: 0, totalSteps: 1 });
    expect(view.header.memberContext).toMatchObject({ memberLabel: "Project member", notificationCount: 2 });
    expect(view.navigation).toMatchObject({ brandName: "Chrona", activeSection: "tasks", settingsAvailable: true, memberIdentity: "Project member", notificationCount: 2 });
    expect(view.executionFlow.nodes[0]).toMatchObject({ id: "active", stepNumber: 1, status: "running" });
    expect(view.readiness).toMatchObject({ title: "Current work", statusLabel: "Running", tone: "info", actionNodeId: "active" });
    expect(view.latestResult).toMatchObject({ title: "Latest run", actionNodeId: "active" });
    expect(view.artifacts).toContainEqual(expect.objectContaining({ id: "artifact-1" }));
    expect(view.activity[0]).toMatchObject({ id: "run-run-1", tone: "info" });
  });

  it("surfaces pending schedule proposals as readiness and activity", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({
        scheduleProposals: [{
          id: "proposal-1",
          source: "ai",
          proposedBy: "assistant",
          summary: "Start tomorrow morning after dependencies clear.",
          status: "Pending",
          dueAt: null,
          scheduledStartAt: "2026-05-13T09:00:00.000Z",
          scheduledEndAt: null,
        }],
      }),
      graphPlan: graph([node({ id: "ready", status: "ready" })]),
    });

    expect(view.readiness).toMatchObject({
      id: "schedule-proposal-proposal-1",
      title: "Ready to schedule",
      tone: "warning",
    });
    expect(view.activity[0]).toMatchObject({ id: "schedule-proposal-proposal-1", tone: "warning" });
  });

  it("surfaces blocked task or waiting node as attention", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({
        task: {
          ...pageData().task,
          isRunnable: false,
          runnabilitySummary: "Waiting for approval",
          blockReason: { blockType: "approval", actionRequired: "Approve output" },
        },
      }),
      graphPlan: graph([node({ id: "blocked", status: "blocked" })]),
    });

    expect(view.attention).toMatchObject({ title: "Blocked", description: "Approve output", tone: "critical" });
    expect(view.readiness).toMatchObject({ title: "Execution readiness", description: "Waiting for approval", tone: "warning" });
    expect(view.states).toMatchObject({ isPermissionLimited: false, isEmpty: false });
  });

  it("uses node result output and completion summary for completed states", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData(),
      graphPlan: graph([node({
        id: "done",
        status: "done",
        completionSummary: "Finished research",
        resultOutputs: [{ kind: "text", content: "summary" }],
      })]),
    });

    expect(view.progress).toMatchObject({ completedSteps: 1, totalSteps: 1, percentComplete: 100 });
    expect(view.latestResult).toMatchObject({ description: "Finished research", tone: "success", actionNodeId: "done" });
    expect(view.artifacts).toContainEqual(expect.objectContaining({ id: "done-output-0", sourceNodeId: "done" }));
  });

  it("surfaces pending approvals, input nodes, artifacts, and activity events for human review", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({
        approvals: [{
          id: "approval-1",
          title: "Approve release notes",
          status: "Pending",
          riskLevel: "medium",
          requestedAt: "2026-05-12T11:00:00.000Z",
        }],
        artifacts: [{ id: "artifact-1", title: "Release notes", type: "markdown", uri: "file://release.md" }],
      }),
      graphPlan: graph([node({
        id: "input",
        title: "Collect confirmation",
        status: "waiting_for_user",
        nextAction: "Provide release approval",
      })]),
    });

    expect(view.attention).toMatchObject({
      id: "approval-approval-1",
      title: "Needs handling",
      description: "Approve release notes",
      tone: "warning",
      actionLabel: "Resolve in node panel",
      actionNodeId: "input",
    });
    expect(view.nodeDetail.currentNode?.id).toBe("input");
    expect(view.artifacts).toContainEqual(expect.objectContaining({ id: "artifact-1", title: "Release notes" }));
    expect(view.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "approval-approval-1", description: "Approval Pending" }),
      expect.objectContaining({ id: "artifact-artifact-1", description: "Artifact markdown" }),
      expect.objectContaining({ id: "node-input", description: "waiting_for_user" }),
    ]));
  });

  it("covers shared fixture states for empty, artifact, stale, and permission-limited workspaces", () => {
    const empty = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.empty);
    const artifact = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.artifactPresent);
    const stale = createTaskWorkspaceExecutionConsoleView({
      ...taskWorkspaceStateFixtures.staleError,
      pageData: {
        ...taskWorkspaceStateFixtures.staleError.pageData,
        latestRunSummary: { id: "run-1", status: "Running", startedAt: null, syncStatus: "stale" },
      },
    });
    const permissionLimited = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.permissionLimited);

    expect(empty.states.isEmpty).toBe(true);
    expect(artifact.artifacts.length).toBeGreaterThan(0);
    expect(stale.states.isStale).toBe(true);
    expect(permissionLimited.states.isPermissionLimited).toBe(true);
    expect(permissionLimited.header.actions).toEqual([
      {
        id: "start",
        label: "Start",
        disabled: true,
        disabledReason: "You can view this task, but cannot run it",
      },
      {
        id: "pause",
        label: "Pause",
        disabled: true,
        disabledReason: "Pause is visible for task control, but the execution API does not expose pause yet.",
      },
      {
        id: "stop",
        label: "Stop",
        disabled: true,
        disabledReason: "No running execution session to stop.",
      },
      { id: "more", label: "More actions" },
    ]);
  });

  it("builds selected-node detail state with tabs, refresh state, and step position", () => {
    const selected = node({
      id: "approval",
      title: "Approve patch",
      status: "waiting_for_user",
      nextAction: "Approve or request changes",
    });
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData(),
      graphPlan: graph([
        node({ id: "research", status: "done" }),
        selected,
      ], "research"),
      selectedNode: selected,
    });

    expect(view.nodeDetail).toMatchObject({
      selectedNode: selected,
      currentNode: selected,
      title: "Approve patch",
      status: "approval-needed",
      stepPosition: "2/2",
      autoRefreshEnabled: true,
      tabs: ["result", "evidence", "action", "configuration"],
      isEmpty: false,
    });
    expect(view.executionFlow.selectedNodeId).toBe("approval");
  });

  it("surfaces action disabled reasons only when the selected node has no actions", () => {
    const noActions = node({ id: "view-only", status: "ready" });
    noActions.availableActions = [];
    const actionable = node({ id: "retry", status: "blocked" });
    actionable.availableActions = [{ id: "retry", label: "Retry", kind: "retry" }];

    expect(createTaskWorkspaceExecutionConsoleView({
      pageData: pageData(),
      graphPlan: graph([noActions]),
      selectedNode: noActions,
    }).nodeDetail.disabledActionReason).toBe("No actions are available for this node.");
    expect(createTaskWorkspaceExecutionConsoleView({
      pageData: pageData(),
      graphPlan: graph([actionable]),
      selectedNode: actionable,
    }).nodeDetail.disabledActionReason).toBeUndefined();
  });
});
