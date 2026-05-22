import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanExecutionResult, TaskPlanReadModel } from "@chrona/contracts/ai";
import { useTaskWorkspacePageState, type TaskWorkspaceSseEvent } from "./use-task-workspace-page-state";
import { useTaskWorkspacePlanState } from "./use-task-workspace-plan-state";
import type { TaskPageData } from "../model/task-workspace-types";

type JsonEventHandler = (event: { event: string; data: Record<string, unknown>; message: unknown }) => void;
type FetchEventSourceOptions = {
  onEvent: JsonEventHandler;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

const mocks = vi.hoisted(() => ({
  pageResponses: [] as TaskPageData[],
  pageFetchCount: 0,
  planResponses: [] as Array<{ taskId: string; aiPlanGenerationStatus?: string; savedPlan?: TaskPlanReadModel | null; generationSession?: unknown }>,
  acceptResponse: null as { savedPlan?: TaskPlanReadModel | null } | null,
  commandResponses: [] as Array<{ commandId: string; taskId: string; acceptedAt: string }>,
  fetchCalls: [] as Array<{ input: string; init?: RequestInit }>,
  currentExecutionResponse: null as PlanExecutionResult | null,
  eventHandlers: new Map<string, JsonEventHandler>(),
  eventStreamAttempts: 0,
  eventStreamMode: "open" as "open" | "reject",
  workspaceEventSequence: 0,
  generationSession: {
    taskId: "task-1",
    generationId: null as string | null,
    sessionStatus: "idle" as "idle" | "running" | "completed" | "failed" | "cancelled",
    result: null as TaskPlanReadModel | null,
    isLoading: false,
    error: null as string | null,
    errorCode: null as string | null,
    phase: "idle" as string,
    statusMessage: null as string | null,
    partialText: "",
    toolCalls: [] as unknown[],
    toolResults: [] as unknown[],
    startedAt: null as string | null,
    finishedAt: null as string | null,
    connected: false,
    hydrated: true,
  },
}));

vi.mock("@/lib/fetch-json-event-source", () => ({
  fetchJsonEventSource: (input: string, options: FetchEventSourceOptions) => {
    if (input.includes("/execution/checkpoint/") || input.endsWith("/execution/actions")) {
      return new Promise<void>((resolve, reject) => {
        mocks.eventHandlers.set(input, (event) => {
          try {
            options.onEvent(event);
            if (event.event === "done") resolve();
          } catch (cause) {
            reject(cause);
          }
        });
      });
    }

    mocks.eventHandlers.set(input, options.onEvent);
    if (input.endsWith("/events")) {
      mocks.eventStreamAttempts += 1;
    }
    if (mocks.eventStreamMode === "reject") {
      return Promise.reject(new Error("event stream closed"));
    }

    return new Promise(() => undefined);
  },
}));

vi.mock("@/lib/rpc-client", () => ({
  api: {
    tasks: {
      ":taskId": {
        $get: vi.fn(async () => ({
          ok: true,
          json: async () => {
            mocks.pageFetchCount += 1;
            return mocks.pageResponses.shift();
          },
        })),
        plan: {
          $get: vi.fn(async () => ({
            ok: true,
            json: async () => mocks.planResponses.shift(),
          })),
          accept: {
            $post: vi.fn(async () => ({
              ok: true,
              json: async () => mocks.acceptResponse,
            })),
          },
        },
      },
    },
  },
}));

vi.mock("@/hooks/ai/task-plan-generation-session-store", () => ({
  useTaskPlanGenerationSession: () => mocks.generationSession,
}));

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function planReadModel(input: {
  id: string;
  status: "draft" | "accepted" | "ready" | "running";
  title: string;
}): TaskPlanReadModel {
  const effectiveStatus = input.status === "running" ? "running" : "ready";

  return {
    id: input.id,
    taskId: "task-1",
    status: input.status === "draft" ? "draft" : "accepted",
    revision: 1,
    summary: input.title,
    prompt: input.title,
    blueprint: null,
    generatedBy: null,
    generatedAt: "2026-05-17T00:00:00.000Z",
    updatedAt: input.status === "draft" ? "2026-05-17T00:00:00.000Z" : "2026-05-17T00:00:01.000Z",
    compiledPlan: {
      id: `${input.id}-compiled`,
      title: input.title,
      goal: input.title,
      sourceVersion: 1,
      nodes: [
        {
          id: "node-1",
          title: input.title,
          description: input.title,
          type: "task",
          mode: "manual",
          executor: null,
          linkedTaskId: null,
          estimatedMinutes: null,
          priority: null,
          dependencies: [],
          config: {},
        },
      ],
      edges: [],
    },
    effectivePlan: {
      id: `${input.id}-effective`,
      nodes: [
        {
          id: "node-1",
          title: input.title,
          description: input.title,
          type: "task",
          mode: "manual",
          executor: null,
          linkedTaskId: null,
          estimatedMinutes: null,
          priority: null,
          dependencies: [],
          config: {},
          status: effectiveStatus,
          ready: true,
          reachable: true,
          result: null,
        },
      ],
      edges: [],
    },
  } as unknown as TaskPlanReadModel;
}

function pageData(input: {
  taskStatus: string;
  plan: TaskPlanReadModel | null;
  aiPlanGenerationStatus?: TaskPageData["task"]["aiPlanGenerationStatus"];
  runStatus?: string | null;
}): TaskPageData {
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
      status: input.taskStatus,
      priority: "High",
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduleStatus: "Unscheduled",
      scheduleSource: null,
      isRunnable: true,
      runnabilitySummary: "Ready",
      savedPlan: input.plan,
      aiPlanGenerationStatus: input.aiPlanGenerationStatus ?? (input.plan ? "accepted" : "idle"),
      blockReason: null,
      dependencies: [],
    },
    latestRunSummary: input.runStatus
      ? {
          id: "run-1",
          status: input.runStatus,
          startedAt: "2026-05-17T00:00:00.000Z",
          syncStatus: "fresh",
        }
      : null,
    scheduleProposals: [],
    approvals: [],
    artifacts: [],
  };
}

function executionResult(input: Partial<PlanExecutionResult> = {}): PlanExecutionResult {
  return {
    taskId: "task-1",
    planId: "plan-1",
    mainSessionId: "session-1",
    status: "running",
    currentNodeId: "node-1",
    executedNodeIds: [],
    waitingNodeIds: [],
    blockedNodeIds: [],
    message: "Running",
    checkpoint: null,
    ...input,
  };
}

function emitWorkspaceEvent(input: TaskWorkspaceSseEvent) {
  mocks.eventHandlers.get("/api/work/task-1/events")?.({
    event: input.type,
    data: input as unknown as Record<string, unknown>,
    message: input,
  });
}

function nextWorkspaceEvent(input: TaskWorkspaceSseEvent) {
  return {
    ...input,
    sequence: input.sequence ?? ++mocks.workspaceEventSequence,
  } satisfies TaskWorkspaceSseEvent;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    mocks.fetchCalls.push({ input: url, init });

    if (url.endsWith("/execution/current")) {
      return {
        ok: true,
        json: async () => mocks.currentExecutionResponse,
      };
    }

    if (url.endsWith("/commands")) {
      return {
        ok: true,
        json: async () => mocks.commandResponses.shift() ?? {
          commandId: "command-1",
          taskId: "task-1",
          acceptedAt: "2026-05-17T00:00:00.000Z",
        },
      };
    }

    return {
      ok: false,
      json: async () => ({ error: `Unhandled fetch ${url}` }),
    };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mocks.pageResponses = [];
  mocks.pageFetchCount = 0;
  mocks.planResponses = [];
  mocks.acceptResponse = null;
  mocks.commandResponses = [];
  mocks.fetchCalls = [];
  mocks.currentExecutionResponse = null;
  mocks.eventHandlers.clear();
  mocks.eventStreamAttempts = 0;
  mocks.eventStreamMode = "open";
  mocks.workspaceEventSequence = 0;
  mocks.generationSession = {
    ...mocks.generationSession,
    generationId: null,
    sessionStatus: "idle",
    result: null,
    isLoading: false,
    phase: "idle",
    hydrated: true,
  };
});

// eslint-disable-next-line max-lines-per-function -- workspace sync scenarios share the same hook fixtures.
describe("task workspace page synchronization", () => {
  it("updates the rendered plan graph when a projection event refetches the full workspace page", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Prepare launch" });
    const runningPlan = planReadModel({ id: "plan-1", status: "running", title: "Execute launch" });
    runningPlan.updatedAt = "2026-05-17T00:00:02.000Z";
    const initialPage = pageData({ taskStatus: "Ready", plan: initialPlan });
    mocks.pageResponses = [pageData({ taskStatus: "Running", plan: runningPlan, runStatus: "Running" })];
    mocks.planResponses = [{ taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: initialPlan }];

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace, workspace.workspaceEvents);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.title).toBe("Prepare launch"));
    expect(result.current.plan.graphPlan?.nodes[0]?.status).toBe("ready");

    await act(async () => {
      mocks.eventHandlers.get("/api/work/task-1/events")?.({ event: "task_projection_updated", data: {}, message: {} });
    });

    await waitFor(() => expect(result.current.workspace.pageData.task.status).toBe("Running"));
    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.title).toBe("Execute launch"));
    expect(result.current.plan.graphPlan?.nodes[0]?.status).toBe("active");
  });

  it("updates the rendered plan graph when only the effective plan changes", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Prepare launch" });
    const runningPlan = planReadModel({ id: "plan-1", status: "running", title: "Prepare launch" });
    runningPlan.updatedAt = initialPlan.updatedAt;
    const initialPage = pageData({ taskStatus: "Ready", plan: initialPlan });
    mocks.pageResponses = [pageData({ taskStatus: "Running", plan: runningPlan, runStatus: "Running" })];
    mocks.planResponses = [{ taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: initialPlan }];

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace, workspace.workspaceEvents);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.status).toBe("ready"));

    await act(async () => {
      mocks.eventHandlers.get("/api/work/task-1/events")?.({ event: "task_workspace_updated", data: {}, message: {} });
    });

    await waitFor(() => expect(result.current.workspace.pageData.task.status).toBe("Running"));
    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.status).toBe("active"));
  });

  it("refreshes the workspace page when a page-level workspace update event arrives", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "running", title: "Execute launch" });
    const initialPage = pageData({ taskStatus: "Running", plan: initialPlan, runStatus: "Running" });
    mocks.pageResponses = [pageData({ taskStatus: "Blocked", plan: initialPlan, runStatus: "Blocked" })];

    const { result } = renderHook(() => useTaskWorkspacePageState(initialPage), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await act(async () => {
      mocks.eventHandlers.get("/api/work/task-1/events")?.({ event: "task_workspace_updated", data: {}, message: {} });
    });

    await waitFor(() => expect(result.current.pageData.task.status).toBe("Blocked"));
    expect(mocks.pageFetchCount).toBe(1);
  });

  it("refreshes current execution when a workspace update exposes a checkpoint", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "running", title: "Execute launch" });
    const checkpoint = {
      id: "checkpoint-1",
      taskId: "task-1",
      sessionId: "session-1",
      planRunId: "run-1",
      nodeId: "node-1",
      kind: "user_input" as const,
      title: "Input required",
      message: "Provide missing details",
      severity: "info" as const,
      form: {
        instructions: "Provide missing details",
        inputFields: [{ name: "details", label: "Details", type: "text" as const, required: true }],
      },
      availableActions: [{ id: "submit_input" as const, label: "Submit input", style: "primary" as const, requiresPayload: true }],
      createdAt: "2026-05-17T00:00:02.000Z",
    };
    const waitingPlan = planReadModel({ id: "plan-1", status: "running", title: "Waiting for user input" });
    const initialPage = pageData({ taskStatus: "Running", plan: initialPlan, runStatus: "Running" });
    mocks.pageResponses = [pageData({ taskStatus: "Running", plan: waitingPlan, runStatus: "Running" })];
    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: waitingPlan },
    ];
    mocks.currentExecutionResponse = executionResult({
      status: "waiting_for_user",
      currentNodeId: "node-1",
      waitingNodeIds: ["node-1"],
      message: "Waiting for input",
      checkpoint,
    });

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace, workspace.workspaceEvents);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await act(async () => {
      emitWorkspaceEvent(nextWorkspaceEvent({ type: "task_workspace_updated", reason: "plan_execution.node_waiting" }));
    });

    await waitFor(() => expect(result.current.plan.currentExecution?.checkpoint?.id).toBe(checkpoint.id));
    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.checkpoint?.id).toBe(checkpoint.id));
    expect(result.current.plan.graphPlan?.nodes[0]?.availableActions).toHaveLength(1);
  });

  it("does not refresh the workspace page for plan-only progress events", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Old plan" });
    const initialPage = pageData({ taskStatus: "Ready", plan: initialPlan, aiPlanGenerationStatus: "generating" });
    mocks.pageResponses = [pageData({ taskStatus: "Ready", plan: initialPlan })];

    renderHook(() => useTaskWorkspacePageState(initialPage), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await act(async () => {
      emitWorkspaceEvent(nextWorkspaceEvent({ type: "plan.generation.event", eventKind: "tool_call" }));
      emitWorkspaceEvent(nextWorkspaceEvent({ type: "plan.generation.event", eventKind: "result" }));
    });

    expect(mocks.pageFetchCount).toBe(0);
    expect(mocks.pageResponses).toHaveLength(1);
  });

  it("does not refresh the workspace page for ready or heartbeat events", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "running", title: "Execute launch" });
    const initialPage = pageData({ taskStatus: "Running", plan: initialPlan, runStatus: "Running" });
    mocks.pageResponses = [pageData({ taskStatus: "Blocked", plan: initialPlan, runStatus: "Blocked" })];

    renderHook(() => useTaskWorkspacePageState(initialPage), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await act(async () => {
      mocks.eventHandlers.get("/api/work/task-1/events")?.({ event: "ready", data: {}, message: {} });
      mocks.eventHandlers.get("/api/work/task-1/events")?.({ event: "heartbeat", data: {}, message: {} });
    });

    expect(mocks.pageFetchCount).toBe(0);
    expect(mocks.pageResponses).toHaveLength(1);
  });

  it("polls active workspaces as a low-frequency fallback while the event stream is healthy", async () => {
    vi.useFakeTimers();
    const initialPlan = planReadModel({ id: "plan-1", status: "running", title: "Execute launch" });
    const initialPage = pageData({ taskStatus: "Running", plan: initialPlan, runStatus: "Running" });
    mocks.pageResponses = [pageData({ taskStatus: "Blocked", plan: initialPlan, runStatus: "Blocked" })];

    const { unmount } = renderHook(() => useTaskWorkspacePageState(initialPage), { wrapper: createQueryWrapper() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    unmount();
    expect(mocks.pageFetchCount).toBe(1);
    expect(mocks.pageResponses).toHaveLength(0);
  });

  it("handles an unhealthy workspace event stream without clearing page state", async () => {
    mocks.eventStreamMode = "reject";
    const initialPlan = planReadModel({ id: "plan-1", status: "running", title: "Execute launch" });
    const initialPage = pageData({ taskStatus: "Running", plan: initialPlan, runStatus: "Running" });

    const { result, unmount } = renderHook(() => useTaskWorkspacePageState(initialPage), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventStreamAttempts).toBe(1));
    expect(result.current.pageData.task.status).toBe("Running");
    unmount();
  });

  it("refreshes once when the workspace tab becomes visible again", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "running", title: "Execute launch" });
    const initialPage = pageData({ taskStatus: "Running", plan: initialPlan, runStatus: "Running" });
    mocks.pageResponses = [pageData({ taskStatus: "Blocked", plan: initialPlan, runStatus: "Blocked" })];

    renderHook(() => useTaskWorkspacePageState(initialPage), { wrapper: createQueryWrapper() });
    const visibilitySpy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });

    await waitFor(() => expect(mocks.pageFetchCount).toBeGreaterThan(0));
    visibilitySpy.mockRestore();
  });

  it("refreshes only plan state when a plan generation result event arrives", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Old plan" });
    const generatedPlan = planReadModel({ id: "plan-2", status: "ready", title: "Generated plan" });
    const initialPage = pageData({ taskStatus: "Ready", plan: initialPlan, aiPlanGenerationStatus: "generating" });
    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "waiting_acceptance", savedPlan: generatedPlan },
    ];

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace, workspace.workspaceEvents);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await act(async () => {
      emitWorkspaceEvent(nextWorkspaceEvent({ type: "plan.generation.event", eventKind: "result" }));
    });

    expect(mocks.pageFetchCount).toBe(0);
    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.title).toBe("Generated plan"));
  });

  it("exposes the latest plan generation activity summary", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Old plan" });
    const initialPage = pageData({ taskStatus: "Ready", plan: initialPlan, aiPlanGenerationStatus: "generating" });

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace, workspace.workspaceEvents);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await act(async () => {
      emitWorkspaceEvent(nextWorkspaceEvent({ type: "plan.generation.event", eventKind: "tool_call" }));
    });

    expect(result.current.plan.latestActivitySummary).toBe("Running tool");

    await act(async () => {
      emitWorkspaceEvent(nextWorkspaceEvent({ type: "plan.generation.event", eventKind: "status" }));
    });

    expect(result.current.plan.latestActivitySummary).toBe("Generating plan");
  });

  it("uses a completed generation event result even when the AI panel is not mounted", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Old plan" });
    const initialPage = pageData({ taskStatus: "Ready", plan: initialPlan, aiPlanGenerationStatus: "generating" });
    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "waiting_acceptance", savedPlan: initialPlan },
    ];

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace, workspace.workspaceEvents);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.title).toBe("Old plan"));

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await act(async () => {
      emitWorkspaceEvent(nextWorkspaceEvent({ type: "plan.generation.event", eventKind: "result" }));
    });

    expect(mocks.pageFetchCount).toBe(0);
    expect(result.current.plan.graphPlan?.nodes[0]?.title).toBe("Old plan");
    expect(result.current.plan.planGenerationStatus).toBe("accepted");
  });

  it("refreshes workspace execution queries after accepting a draft", async () => {
    const draftPlan = planReadModel({ id: "plan-1", status: "draft", title: "Draft plan" });
    const acceptedPlan = planReadModel({ id: "plan-1", status: "accepted", title: "Accepted plan" });
    const refreshWorkspace = vi.fn(async () => undefined);
    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: acceptedPlan },
    ];

    const { result } = renderHook(
      () => useTaskWorkspacePlanState(
        pageData({ taskStatus: "Ready", plan: draftPlan, aiPlanGenerationStatus: "waiting_acceptance" }).task,
        refreshWorkspace,
      ),
      { wrapper: createQueryWrapper() },
    );

    await act(async () => {
      await result.current.acceptPlanById("plan-1");
    });

    await waitFor(() => expect(result.current.plan?.status).toBe("accepted"));
    expect(result.current.plan?.summary).toBe("Accepted plan");
    expect(result.current.planGenerationStatus).toBe("accepted");
    expect(mocks.fetchCalls.some((call) => call.input === "/api/work/task-1/commands")).toBe(true);
    expect(refreshWorkspace).toHaveBeenCalledTimes(1);
  });

  it("keeps workspace plan state current from generation through checkpoint input to completion", async () => {
    const generatedPlan = planReadModel({ id: "plan-1", status: "draft", title: "Generated launch plan" });
    const acceptedPlan = planReadModel({ id: "plan-1", status: "accepted", title: "Accepted launch plan" });
    const waitingPlan = planReadModel({ id: "plan-1", status: "running", title: "Waiting for user input" });
    const completedPlan = planReadModel({ id: "plan-1", status: "accepted", title: "Completed launch plan" });
    completedPlan.effectivePlan.nodes[0] = { ...completedPlan.effectivePlan.nodes[0], status: "completed" };
    const refreshWorkspace = vi.fn(async () => undefined);
    const checkpoint = {
      id: "checkpoint-1",
      taskId: "task-1",
      sessionId: "session-1",
      planRunId: "run-1",
      nodeId: "node-1",
      kind: "user_input" as const,
      title: "Review generated output",
      message: "Provide final answer",
      severity: "info" as const,
      form: {
        instructions: "Review generated output",
        inputFields: [{ name: "answer", label: "Answer", type: "text" as const, required: true }],
      },
      availableActions: [{ id: "submit_input" as const, label: "Submit input", style: "primary" as const, requiresPayload: true }],
      createdAt: "2026-05-17T00:00:02.000Z",
    };

    let workspaceEvents: TaskWorkspaceSseEvent[] = [];
    const { result, rerender } = renderHook(
      () => useTaskWorkspacePlanState(
        pageData({ taskStatus: "Ready", plan: null, aiPlanGenerationStatus: "idle" }).task,
        refreshWorkspace,
        workspaceEvents,
      ),
      { wrapper: createQueryWrapper() },
    );
    const pushWorkspaceEvent = async (event: TaskWorkspaceSseEvent) => {
      workspaceEvents = [...workspaceEvents, event];
      await act(async () => {
        rerender();
      });
    };

    expect(result.current.plan).toBeNull();
    expect(result.current.planGenerationStatus).toBe("idle");

    await act(async () => {
      result.current.handleGeneratePlanFromHeader();
    });

    await waitFor(() => expect(result.current.planGenerationStatus).toBe("generating"));

    mocks.planResponses = [{ taskId: "task-1", aiPlanGenerationStatus: "waiting_acceptance", savedPlan: generatedPlan }];
    await pushWorkspaceEvent(nextWorkspaceEvent({ type: "plan.generation.event", eventKind: "result" }));

    await waitFor(() => expect(result.current.graphPlan?.nodes[0]?.title).toBe("Generated launch plan"));
    expect(result.current.plan?.status).toBe("draft");
    expect(result.current.planGenerationStatus).toBe("waiting_acceptance");
    expect(result.current.canAcceptPlan).toBe(true);

    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: acceptedPlan },
    ];

    await act(async () => {
      await result.current.acceptPlanById("plan-1");
    });

    await waitFor(() => expect(result.current.plan?.status).toBe("accepted"));
    expect(result.current.canAcceptPlan).toBe(false);
    expect(result.current.planGenerationStatus).toBe("accepted");
    expect(refreshWorkspace).toHaveBeenCalledTimes(1);

    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: waitingPlan },
    ];
    mocks.currentExecutionResponse = executionResult({
      status: "waiting_for_user",
      currentNodeId: null,
      waitingNodeIds: ["node-1"],
      message: "Waiting for input",
      checkpoint,
    });

    const dispatchPromise = result.current.dispatchExecutionAction({ action: "start_manual" });

    await pushWorkspaceEvent(nextWorkspaceEvent({
      type: "execution.runtime_event",
      eventKind: "tool_started",
      action: "start_manual",
      nodeId: "node-1",
      nodeTitle: "Launch plan",
      runtimeName: "hermes",
      provider: "hermes",
      runId: "run-1",
      event: { type: "assistant_text_delta", text: "Running" },
    }));
    await pushWorkspaceEvent(nextWorkspaceEvent({
      type: "execution.state.updated",
      eventKind: "state",
    }));
    await pushWorkspaceEvent(nextWorkspaceEvent({
      type: "execution.result",
      eventKind: "waiting_for_user",
    }));

    await act(async () => {
      await dispatchPromise;
    });

    expect(result.current.latestActivitySummary).toBe("Running");
    expect(result.current.runtimeEvents).toHaveLength(1);
    await waitFor(() => expect(result.current.graphPlan?.nodes[0]?.status).toBe("active"));
    expect(result.current.graphPlan?.nodes[0]?.title).toBe("Waiting for user input");
    expect(result.current.currentExecution?.status).toBe("waiting_for_user");
    expect(result.current.currentExecution?.checkpoint?.id).toBe(checkpoint.id);
    expect(refreshWorkspace).toHaveBeenCalledTimes(2);

    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: completedPlan },
    ];

    mocks.currentExecutionResponse = executionResult({ status: "completed", currentNodeId: null, executedNodeIds: ["node-1"], message: "Completed", checkpoint: null });
    const checkpointPromise = result.current.submitCheckpointAction({
      checkpointId: checkpoint.id,
      action: "submit_input",
      payload: { inputFields: { answer: "go" } },
    });

    await pushWorkspaceEvent(nextWorkspaceEvent({
      type: "execution.runtime_event",
      eventKind: "tool_started",
      action: "resume_with_input",
      nodeId: "node-1",
      nodeTitle: "Waiting for user input",
      runtimeName: "hermes",
      provider: "hermes",
      runId: "run-1",
      event: { type: "assistant_text_delta", text: "Done" },
    }));
    await pushWorkspaceEvent(nextWorkspaceEvent({
      type: "execution.state.updated",
      eventKind: "state",
    }));
    await pushWorkspaceEvent(nextWorkspaceEvent({
      type: "checkpoint.result",
      eventKind: "completed",
    }));

    await act(async () => {
      await checkpointPromise;
    });

    expect(result.current.latestActivitySummary).toBe("Done");
    await waitFor(() => expect(result.current.graphPlan?.nodes[0]?.title).toBe("Completed launch plan"));
    expect(result.current.graphPlan?.nodes[0]?.status).toBe("done");
    expect(result.current.currentExecution?.status).toBe("completed");
    expect(refreshWorkspace).toHaveBeenCalledTimes(3);
  });
});
