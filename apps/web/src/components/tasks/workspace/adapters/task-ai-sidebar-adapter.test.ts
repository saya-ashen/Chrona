import { describe, expect, it } from "vitest";
import { createTaskWorkspaceFixturePageData } from "../../../../../../../features/task-workspace/test-support/task-workspace-test-fixtures";
import { createTaskAiSidebarContext } from "./task-ai-sidebar-adapter";

function createExecutionSummary(overrides: Partial<NonNullable<ReturnType<typeof createTaskWorkspaceFixturePageData>["task"]["executionSummary"]>> = {}) {
  return {
    taskId: "task-1",
    executionState: "running" as const,
    stateLabel: "Running",
    stateReason: null,
    graphVersion: 1,
    currentNodeId: "execute",
    primaryAction: { type: "pause" as const, enabled: true, label: "Pause task" },
    progress: { completed: 1, total: 2, percent: 50 },
    readiness: { runnable: true, reason: null },
    degraded: null,
    blocking: null,
    waiting: null,
    recoveryActions: [],
    ...overrides,
  };
}

describe("createTaskAiSidebarContext", () => {
  it("prioritizes task decisions over latest activity", () => {
    const data = createTaskWorkspaceFixturePageData({
      task: {
        status: "Blocked",
        isRunnable: false,
        blockReason: { blockType: "dependency", actionRequired: "Approve generated plan" },
      },
    });

    const { context } = createTaskAiSidebarContext(data.task, {
      latestActivitySummary: "Node completed: Draft plan",
    });

    expect(context.highlights[0]).toMatchObject({
      label: "Blocked",
      value: "Approve generated plan",
      tone: "critical",
    });
    expect(context.highlights.at(-1)).toMatchObject({
      label: "Activity",
      value: "Node completed: Draft plan",
      tone: "neutral",
    });
  });

  it("uses the accepted plan to show readable active node copy", () => {
    const data = createTaskWorkspaceFixturePageData({
      task: {
        status: "Running",
        executionSummary: createExecutionSummary(),
        graphNodeStates: [{
          id: "execute",
          type: "task",
          status: "running",
          reachable: true,
          current: true,
          requiresAction: false,
          result: null,
          stateReason: null,
          invalidatedByMutationId: null,
        }],
        savedPlan: {
          id: "plan-1",
          status: "accepted",
          revision: 1,
          prompt: null,
          summary: null,
          updatedAt: "2026-05-22T00:00:00.000Z",
          generatedBy: null,
          blueprint: {} as never,
          compiledPlan: {} as never,
          effectivePlan: {
            graphId: "graph-1",
            basePlanId: "plan-1",
            resolvedAt: "2026-05-22T00:00:00.000Z",
            resolvedVersion: 1,
            nodes: [{ id: "execute", nodeId: "execute", title: "Execute test suite" } as never],
            edges: [],
            entryNodeIds: ["execute"],
          } as never,
        },
      },
    });

    const { context } = createTaskAiSidebarContext(data.task);

    expect(context.type).toBe("task");
    if (context.type !== "task") throw new Error("Expected task context");
    expect(context.activeNodeTitle).toBe("Execute test suite");
    expect(context.highlights[0]).toMatchObject({
      label: "Running",
      value: "Execute test suite",
      tone: "info",
    });
  });

  it("uses distinct work-state copy for input and approval waits", () => {
    const waitingForInput = createTaskWorkspaceFixturePageData({
      task: {
        status: "Running",
        executionSummary: createExecutionSummary({
          executionState: "waiting_for_user",
          stateLabel: "Waiting for input",
          primaryAction: { type: "provide_input" as never, enabled: true, label: "Provide input" },
          waiting: { reason: "Need credentials", nodeId: null },
        }),
      },
    });
    const waitingForApproval = createTaskWorkspaceFixturePageData({
      task: {
        status: "Running",
        executionSummary: createExecutionSummary({
          executionState: "waiting_for_approval",
          stateLabel: "Waiting for approval",
          primaryAction: { type: "approve" as never, enabled: true, label: "Review approval" },
          waiting: { reason: "Approve deploy", nodeId: null },
        }),
      },
    });

    const inputContext = createTaskAiSidebarContext(waitingForInput.task).context;
    const approvalContext = createTaskAiSidebarContext(waitingForApproval.task).context;
    if (inputContext.type !== "task" || approvalContext.type !== "task") throw new Error("Expected task contexts");

    expect(inputContext.primaryAction).toBe("Provide the requested input so execution can continue");
    expect(inputContext.nodeState).toBe("Input needed");
    expect(approvalContext.primaryAction).toBe("Review the request, then approve, reject, or request changes");
    expect(approvalContext.nodeState).toBe("Approval needed");
  });
  it("uses result-review copy for completed tasks waiting on acceptance", () => {
    const data = createTaskWorkspaceFixturePageData({
      task: {
        status: "Completed",
        executionSummary: createExecutionSummary({
          executionState: "completed",
          stateLabel: "Completed",
          currentNodeId: null,
          primaryAction: { type: "none", enabled: false, label: "No action available" },
        }),
      },
    });

    const { context } = createTaskAiSidebarContext(data.task);

    expect(context.type).toBe("task");
    if (context.type !== "task") throw new Error("Expected task context");
    expect(context.primaryAction).toBe("Accept result or request changes");
    expect(context.highlights).toContainEqual(expect.objectContaining({
      label: "Next",
      value: "Accept result or request changes",
    }));
  });

});
