import { describe, expect, it } from "vitest";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";
import {
  buildProgressSummary,
  createTaskWorkspaceExecutionConsoleView,
  pickWorkspaceCurrentNode,
} from "./task-workspace-query";
import type { TaskPageData } from "./task-workspace-types";

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
        artifacts: [{ id: "artifact-1", title: "Report", type: "markdown", uri: "file://report.md" }],
      }),
      graphPlan: graph([node({ id: "active", status: "active", statusLabel: "Running" })]),
    });

    expect(view.nodeDetail.currentNode?.id).toBe("active");
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
});
