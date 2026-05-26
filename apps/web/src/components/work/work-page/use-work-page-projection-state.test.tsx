import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORK_PAGE_COPY } from "./work-page-copy";
import { useWorkPageProjectionState } from "./use-work-page-projection-state";
import type { WorkPageData } from "./work-page-types";

type JsonEventHandler = (event: { event: string; data?: Record<string, unknown>; message?: unknown }) => void;
type FetchEventSourceOptions = {
  onEvent: JsonEventHandler;
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

const mocks = vi.hoisted(() => ({
  eventHandlers: new Map<string, JsonEventHandler>(),
  workResponses: [] as WorkPageData[],
  workFetchCount: 0,
  routerRefresh: vi.fn(),
}));

vi.mock("@/lib/fetch-json-event-source", () => ({
  fetchJsonEventSource: (input: string, options: FetchEventSourceOptions) => {
    mocks.eventHandlers.set(input, options.onEvent);
    return new Promise(() => undefined);
  },
}));

vi.mock("@/lib/rpc-client", () => ({
  api: {
    work: {
      ":taskId": {
        $get: vi.fn(async () => ({
          ok: true,
          json: async () => {
            mocks.workFetchCount += 1;
            return mocks.workResponses.shift();
          },
        })),
      },
    },
  },
}));

vi.mock("@/lib/router", () => ({
  useAppRouter: () => ({ refresh: mocks.routerRefresh }),
}));

vi.mock("@/components/tasks/plan/task-action-node-action", () => ({
  appendTaskPrimaryNodeAction: (_data: WorkPageData, plan: WorkPageData["taskPlan"]) => plan,
}));

const emptyPlan: WorkPageData["taskPlan"] = {
  state: "empty",
  revision: null,
  generatedBy: null,
  isMock: false,
  summary: "No generated plan yet.",
  updatedAt: null,
  changeSummary: null,
  currentStepId: null,
  steps: [],
  nodes: [],
  edges: [],
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

function workPageData(overrides: Partial<WorkPageData> = {}): WorkPageData {
  return {
    taskShell: {
      id: "task-auto-plan",
      workspaceId: "workspace-1",
      title: "Auto generated plan task",
      executionRuntime: "hermes",
      executionConfig: {},
      status: "Ready",
      priority: "Normal",
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduleStatus: "None",
      blockReason: null,
    },
    currentRun: null,
    currentIntervention: null,
    latestOutput: {
      kind: "empty",
      title: "No output",
      body: "No output yet.",
      timestamp: null,
      href: null,
      empty: true,
      sourceLabel: "Output",
    },
    scheduleImpact: {
      status: "None",
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      summary: "No schedule impact.",
    },
    reliability: {
      refreshedAt: "2026-05-26T00:00:00.000Z",
      lastSyncedAt: null,
      lastUpdatedAt: null,
      syncStatus: "healthy",
      isStale: false,
      stuckFor: null,
      stopReason: null,
    },
    closure: {
      resultAccepted: false,
      acceptedAt: null,
      isDone: false,
      doneAt: null,
      canAcceptResult: false,
      canMarkDone: false,
      canCreateFollowUp: false,
      canRetry: false,
      canReopen: false,
      latestFollowUp: null,
    },
    taskPlan: emptyPlan,
    workspaceRail: { sections: [] },
    workstreamItems: [],
    conversation: [],
    composerValue: "",
    planExecution: null,
    inspector: {
      approvals: [],
      artifacts: [],
      toolCalls: [],
    },
    ...overrides,
  };
}

describe("useWorkPageProjectionState", () => {
  beforeEach(() => {
    mocks.eventHandlers.clear();
    mocks.workResponses = [];
    mocks.workFetchCount = 0;
    mocks.routerRefresh.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the workspace when automatic plan generation enters the running state", async () => {
    const initialData = workPageData();
    const generatingData = workPageData({
      taskPlan: {
        ...emptyPlan,
        state: "generating",
        summary: "AI is generating a plan…",
      },
    });
    mocks.workResponses.push(generatingData);

    const { result } = renderHook(() => useWorkPageProjectionState(initialData, DEFAULT_WORK_PAGE_COPY, false));

    await waitFor(() => {
      expect(mocks.eventHandlers.has("/api/work/task-auto-plan/events")).toBe(true);
    });

    await act(async () => {
      mocks.eventHandlers.get("/api/work/task-auto-plan/events")?.({
        event: "task_workspace_updated",
        data: { reason: "plan_generation.started", taskId: "task-auto-plan" },
      });
    });

    await waitFor(() => expect(mocks.workFetchCount).toBe(1));
    expect(result.current.data.taskPlan.state).toBe("generating");
  });

  it("refreshes the workspace when automatic plan generation saves the generated plan", async () => {
    const initialData = workPageData({
      taskPlan: {
        ...emptyPlan,
        state: "generating",
        summary: "AI is generating a plan…",
      },
    });
    const generatedPlan = workPageData({
      taskPlan: {
        ...emptyPlan,
        state: "ready",
        revision: "generated-revision-1",
        summary: "Generated task plan is now visible.",
        updatedAt: "2026-05-26T00:01:00.000Z",
        currentStepId: "step-1",
        steps: [
          {
            id: "step-1",
            title: "Review generated plan",
            objective: "Confirm workspace reflects the generated plan.",
            phase: "planning",
            status: "pending",
            requiresHumanInput: false,
          },
        ],
      },
    });
    mocks.workResponses.push(generatedPlan);

    const { result } = renderHook(() => useWorkPageProjectionState(initialData, DEFAULT_WORK_PAGE_COPY, false));

    await waitFor(() => {
      expect(mocks.eventHandlers.has("/api/work/task-auto-plan/events")).toBe(true);
    });

    await act(async () => {
      mocks.eventHandlers.get("/api/work/task-auto-plan/events")?.({
        event: "task_workspace_updated",
        data: { reason: "plan_generation.draft_saved", taskId: "task-auto-plan" },
      });
    });

    await waitFor(() => expect(mocks.workFetchCount).toBe(1));
    expect(result.current.data.taskPlan.state).toBe("ready");
    expect(result.current.data.taskPlan.summary).toBe("Generated task plan is now visible.");
  });
});
