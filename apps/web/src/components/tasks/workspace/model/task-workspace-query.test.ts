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
    requiresHumanInput: input.requiresHumanInput,
    interactionType: input.interactionType,
    interactiveFields: input.interactiveFields,
    availableActions: input.availableActions,
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
    expect(mapTaskWorkspaceStatus("waiting_for_approval")).toBe("approval-needed");
    expect(mapTaskWorkspaceStatus("blocked")).toBe("blocked");
    expect(mapTaskWorkspaceStatus("degraded")).toBe("blocked");
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
    expect(view.latestResult).toMatchObject({ title: "Latest run" });
    expect(view.artifacts).toContainEqual(expect.objectContaining({ id: "artifact-1" }));
    expect(view.activity).toEqual(expect.arrayContaining([expect.objectContaining({ id: "run-run-1", tone: "info" })]));
  });

  it("prioritizes persisted provider activity over summary activity", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({
        latestRunSummary: { id: "run-1", status: "Running", startedAt: "2026-05-12T10:00:00.000Z", syncStatus: "syncing" },
        activityTimeline: [{
          id: "provider-event-1",
          kind: "tool_started",
          title: "Tool started",
          summary: "chrona_plan_read",
          description: "chrona_plan_read",
          tone: "info",
          timestamp: "2026-05-12T10:01:00.000Z",
          sourceNodeId: "active",
          sourceNodeTitle: "Active node",
        }],
      }),
      graphPlan: graph([node({ id: "active", status: "active", statusLabel: "Running" })]),
    });

    expect(view.activity[0]).toMatchObject({ id: "provider-event-1", title: "Tool started", sourceNodeId: "active", sourceNodeTitle: "Active node" });
    expect(view.activity).toEqual(expect.arrayContaining([expect.objectContaining({ id: "run-run-1" })]));
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

  it("keeps latest result tied to the newest completed result when selection changes", () => {
    const first = node({
      id: "first-result",
      status: "done",
      completionSummary: "Older result",
    });
    const latest = node({
      id: "latest-result",
      status: "done",
      completionSummary: "Newest result",
    });
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData(),
      graphPlan: graph([first, latest], "latest-result"),
      selectedNode: first,
    });

    expect(view.nodeDetail.currentNode?.id).toBe("first-result");
    expect(view.latestResult).toMatchObject({
      description: "Newest result",
      actionNodeId: "latest-result",
    });
  });

  it("does not let a stale blocked selection override a completed workspace state", () => {
    const staleSelection = node({
      id: "stale-blocked",
      status: "blocked",
      nextAction: "Resolve the blocker before continuing execution.",
    });
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({ task: { ...pageData().task, status: "Completed" } }),
      graphPlan: graph([node({ id: "done", status: "completed" })]),
      selectedNode: staleSelection,
    });

    expect(view.header.status).toBe("completed");
    expect(view.states.treatment).toMatchObject({
      label: "Completed",
      tone: "success",
      guidance: "Review the latest result and artifacts before closing the task.",
    });
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

  it("uses orchestrator execution summary for primary workspace state", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({
        task: {
          ...pageData().task,
          status: "Ready",
          executionSummary: {
            taskId: "task-1",
            executionState: "degraded",
            stateLabel: "Degraded",
            stateReason: "Runtime sync timed out",
            graphVersion: 2,
            currentNodeId: "sync",
            primaryAction: { type: "retry_sync", label: "Retry sync", enabled: true },
            progress: { completed: 1, total: 2, percent: 50 },
            readiness: { runnable: false, reason: "Runtime sync timed out" },
            degraded: { reason: "Runtime sync timed out", retryAt: null },
            blocking: null,
            waiting: null,
            recoveryActions: [{ type: "retry_sync", label: "Retry sync", enabled: true }],
          },
        },
      }),
      graphPlan: graph([
        node({ id: "prepare", status: "done" }),
        node({ id: "sync", status: "degraded", nextAction: "Retry sync" }),
      ], "sync"),
    });

    expect(view.header).toMatchObject({
      status: "blocked",
      primaryStateLabel: "Degraded",
      primaryActionLabel: "Retry sync",
      currentNodeId: "sync",
    });
    expect(view.states.treatment).toMatchObject({ label: "Degraded", tone: "critical", guidance: "Retry sync" });
    expect(view.attention).toMatchObject({ title: "Needs handling", tone: "critical", actionNodeId: "sync" });
    expect(view.executionFlow.nodes.find((item) => item.id === "sync")).toMatchObject({
      status: "blocked",
      requiresHumanAction: true,
    });
  });

  it("attaches the orchestrator recovery action to the target node", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({
        task: {
          ...pageData().task,
          status: "Blocked",
          blockReason: {
            blockType: "run_failed",
            actionRequired: "Retry Run",
            scope: "run",
            nodeId: "failed-node",
          },
          executionSummary: {
            taskId: "task-1",
            executionState: "failed",
            stateLabel: "Failed",
            stateReason: "Run failed",
            graphVersion: 2,
            currentNodeId: "failed-node",
            primaryAction: { type: "retry_sync", label: "Retry Run", enabled: true, targetNodeId: "failed-node" },
            progress: { completed: 1, total: 2, percent: 50 },
            readiness: { runnable: true, reason: "Run can be retried" },
            degraded: null,
            blocking: { nodeId: "failed-node", reason: "Run failed" },
            waiting: null,
            recoveryActions: [],
          },
        },
      }),
      graphPlan: graph([
        node({ id: "prepare", status: "done" }),
        node({ id: "failed-node", status: "pending" }),
      ], "failed-node"),
    });

    const targetNode = view.graphPlan?.nodes.find((item) => item.id === "failed-node");
    expect(targetNode?.availableActions?.[0]).toMatchObject({
      id: "task-primary:retry_sync:failed-node",
      label: "Retry Run",
      kind: "retry",
      emphasis: "danger",
      executionAction: { action: "retry_node", nodeId: "failed-node" },
    });
    expect(view.nodeDetail.currentNode?.availableActions?.[0]).toMatchObject({ label: "Retry Run" });
    expect(view.nodeDetail.disabledActionReason).toBeUndefined();
    expect(view.attention).toMatchObject({ actionLabel: "Open action controls", actionNodeId: "failed-node" });
  });

  it("uses the current checkpoint as the primary status and disables Start", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({
        task: {
          ...pageData().task,
          status: "Running",
          executionSummary: {
            taskId: "task-1",
            executionState: "running",
            stateLabel: "Running",
            stateReason: "Awaiting checkpoint input",
            graphVersion: 3,
            currentNodeId: "checkpoint",
            primaryAction: { type: "provide_input", label: "Provide input", enabled: true },
            progress: { completed: 1, total: 2, percent: 50 },
            readiness: { runnable: true, reason: "Awaiting checkpoint input" },
            degraded: null,
            blocking: null,
            waiting: { nodeId: "checkpoint", reason: "Needs confirmation" },
            recoveryActions: [],
          },
        },
      }),
      graphPlan: graph([
        node({ id: "prepare", status: "done" }),
        node({
          id: "checkpoint",
          status: "waiting_for_user",
          nextAction: "Confirm the deployment window",
          requiresHumanInput: true,
          availableActions: [{ id: "continue", label: "Continue", kind: "trigger" }],
        }),
      ], "checkpoint"),
    });

    expect(view.header.status).toBe("approval-needed");
    expect(view.header.actions.find((action) => action.id === "start")).toMatchObject({
      disabled: true,
      disabledReason: "Task is waiting for checkpoint input.",
    });
    expect(view.header.actions.find((action) => action.id === "stop")).toMatchObject({ disabled: false });
    expect(view.states.treatment).toMatchObject({
      label: "Review required",
      tone: "warning",
      guidance: "Confirm the deployment window",
    });
  });

  it("does not let a stale task block reason hide the active checkpoint", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({
        task: {
          ...pageData().task,
          status: "Running",
          blockReason: { blockType: "previous_block", actionRequired: "Old blocker" },
        },
      }),
      graphPlan: graph([
        node({ id: "prepare", status: "done" }),
        node({
          id: "checkpoint",
          status: "waiting_for_approval",
          nextAction: "Approve the checkpoint",
          requiresHumanInput: true,
        }),
      ], "checkpoint"),
    });

    expect(view.attention).toMatchObject({
      title: "Needs handling",
      description: "Approve the checkpoint",
      tone: "warning",
      actionNodeId: "checkpoint",
    });
    expect(view.states.treatment).toMatchObject({
      label: "Approval required",
      tone: "warning",
      guidance: "Approve the checkpoint",
    });
  });

  it("does not let a stale task block reason hide a running current node", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData({
        task: {
          ...pageData().task,
          status: "Running",
          blockReason: { blockType: "previous_block", actionRequired: "Old blocker" },
        },
      }),
      graphPlan: graph([
        node({ id: "prepare", status: "done" }),
        node({ id: "execute", status: "in_progress", nextAction: "Watch the run" }),
      ], "execute"),
    });

    expect(view.states.treatment).toMatchObject({
      label: "Running",
      tone: "info",
      guidance: "Watch the run",
    });
    expect(view.header.status).toBe("running");
  });

  it("covers shared fixture states for empty, blocked, review, completed, failed, idle, loading, artifact, stale, and permission-limited workspaces", () => {
    const empty = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.empty);
    const blocked = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.blocked);
    const review = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);
    const completed = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.completed);
    const failed = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.failed);
    const idle = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.idle);
    const loading = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.loading);
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
    expect(empty.states.treatment).toMatchObject({
      label: "No plan yet",
      tone: "neutral",
      guidance: "Generate and accept a plan to unlock execution controls.",
    });
    expect(artifact.artifacts.length).toBeGreaterThan(0);
    expect(blocked.states.treatment).toMatchObject({ label: "Blocked", tone: "critical" });
    expect(review.states.treatment).toMatchObject({ label: "Review required", tone: "warning" });
    expect(completed.states.treatment).toMatchObject({ label: "Completed", tone: "success" });
    expect(failed.states.treatment).toMatchObject({ label: "Blocked", tone: "critical" });
    expect(idle.states.treatment).toMatchObject({ label: "Idle", tone: "neutral" });
    expect(loading.states.treatment).toMatchObject({ label: "Idle", tone: "neutral" });
    expect(stale.states.isStale).toBe(true);
    expect(stale.states.treatment).toMatchObject({
      label: "Sync stale",
      tone: "warning",
      guidance: "Refresh before acting on execution results.",
    });
    expect(permissionLimited.states.isPermissionLimited).toBe(true);
    expect(permissionLimited.states.treatment).toMatchObject({
      label: "View only",
      tone: "warning",
      guidance: "You can view this task, but cannot run it",
    });
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
        disabledReason: "No running execution session to pause.",
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
      tabs: ["result", "activity", "action", "configuration"],
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

  it("assigns clear treatments for running, blocked, review, completed, and idle workspaces", () => {
    const running = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData(),
      graphPlan: graph([node({ id: "active", status: "active", nextAction: "Watch the run" })]),
    });
    const blocked = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData(),
      graphPlan: graph([node({ id: "blocked", status: "blocked", nextAction: "Retry sync" })]),
    });
    const review = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData(),
      graphPlan: graph([node({ id: "approval", status: "waiting_for_user", nextAction: "Approve output" })]),
    });
    const completed = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData(),
      graphPlan: graph([node({ id: "done", status: "done" })]),
    });
    const idle = createTaskWorkspaceExecutionConsoleView({
      pageData: pageData(),
      graphPlan: graph([node({ id: "ready", status: "ready" })]),
    });

    expect(running.states.treatment).toMatchObject({ label: "Running", tone: "info", guidance: "Watch the run" });
    expect(blocked.states.treatment).toMatchObject({ label: "Blocked", tone: "critical", guidance: "Retry sync" });
    expect(review.states.treatment).toMatchObject({ label: "Review required", tone: "warning", guidance: "Approve output" });
    expect(completed.states.treatment).toMatchObject({ label: "Completed", tone: "success" });
    expect(idle.states.treatment).toMatchObject({ label: "Idle", tone: "neutral" });
  });
});
