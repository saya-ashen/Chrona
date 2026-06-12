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
  pageResponseCarry: null as TaskPageData | null,
  lastPageResponse: null as TaskPageData | null,
  headerResponses: [] as Array<{ spec: { root: string; elements: Record<string, { type: string; props?: Record<string, unknown>; children?: string[] }> } }>,
  headerFetchCount: 0,
  planResponses: [] as Array<{ taskId: string; aiPlanGenerationStatus?: string; savedPlan?: TaskPlanReadModel | null; generationSession?: unknown }>,
  acceptResponse: null as { savedPlan?: TaskPlanReadModel | null } | null,
  commandResponses: [] as Array<{ commandId: string; taskId: string; acceptedAt: string }>,
  commandCalls: [] as Array<{ taskId: string; json: Record<string, unknown> }>,
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
        execution: {
          current: {
            $get: vi.fn(async () => ({
              ok: true,
              json: async () => mocks.currentExecutionResponse,
            })),
          },
        },
      },
    },
    work: {
      ":taskId": {
        commands: {
          $post: vi.fn(async (args: { param: { taskId: string }; json: Record<string, unknown> }) => {
            mocks.commandCalls.push({ taskId: args.param.taskId, json: args.json });
            return {
              ok: true,
              json: async () => mocks.commandResponses.shift() ?? {
                commandId: "command-1",
                taskId: "task-1",
                acceptedAt: "2026-05-17T00:00:00.000Z",
              },
            };
          }),
        },
      },
    },
  },
}));

vi.mock("@/hooks/ai/task-plan-generation-session-store", () => ({
  useTaskPlanGenerationSession: () => mocks.generationSession,
  bindTaskPlanSessionToStateStore: () => () => undefined,
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
  workBlockId?: string | null;
}): TaskPageData {
  const task: TaskPageData["task"] = {
    id: "task-1",
    workspaceId: "workspace-1",
    title: "Launch task",
    description: null,
    executionRuntime: "local",
    executionConfig: null,
    autoPlanGeneration: false,
    autoExecute: false,
    autoPlanGenerationTiming: "at_start",
    autoExecuteTiming: "at_start",
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
  };
  return {
    defaultExecutionRuntime: "local",
    executionRuntimes: [],
    task,
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
    commandCenter: {
      documents: {
        now: { root: "root", elements: { root: { type: "Text", props: { text: "Now" } } } },
        output: { root: "root", elements: { root: { type: "Text", props: { text: "Output" } } } },
        trail: { root: "root", elements: { root: { type: "Text", props: { text: "Trail" } } } },
      },
    },
    header: { spec: { root: "root", elements: { root: { type: "Card", props: {}, children: [] } } } },
  };
}

function recurringPageData(input: Parameters<typeof pageData>[0] & { workBlockId: string }): TaskPageData {
  const data = pageData(input);
  return {
    ...data,
    task: {
      ...data.task,
      currentWorkBlock: {
        id: input.workBlockId,
        status: input.taskStatus,
        scheduledStartAt: "2026-05-17T00:00:00.000Z",
        scheduledEndAt: "2026-05-17T01:00:00.000Z",
      },
    },
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
  for (const [key, handler] of mocks.eventHandlers.entries()) {
    if (key.startsWith("/api/work/task-1/events")) {
      handler({
        event: input.type,
        data: input as unknown as Record<string, unknown>,
        message: input,
      });
      return;
    }
  }
}

function nextWorkspaceEvent(input: TaskWorkspaceSseEvent) {
  return {
    ...input,
    sequence: input.sequence ?? ++mocks.workspaceEventSequence,
  } satisfies TaskWorkspaceSseEvent;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    mocks.fetchCalls.push({ input: url, init });
    if (url.includes("/plan")) console.log("PLAN_FETCH", url);

    if (url.includes("/api/tasks/") && url.includes("/workspace/header")) {
      mocks.headerFetchCount += 1;
      return new Response(JSON.stringify(mocks.headerResponses.shift() ?? {
        spec: { root: "root", elements: { root: { type: "Card", props: {}, children: [] } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.includes("/api/tasks/") && !url.includes("/plan") && !url.includes("/execution") && !url.includes("/workspace/header") && !url.includes("/command-center")) {
      mocks.pageFetchCount += 1;
      // The page query fans out to three parallel fetches (bootstrap,
      // runtime-context, review-context); consume one queued response per
      // group of three so the merge produces the intended snapshot. If
      // no further response is queued, fall back to the most recent
      // page snapshot (a sticky carry) so subsequent visibility / SSE
      // refetches do not produce an empty TaskPageData shape.
      if (mocks.pageResponseCarry === null) {
        const next = mocks.pageResponses.shift();
        if (next) {
          mocks.pageResponseCarry = next;
        } else {
          mocks.pageResponseCarry = mocks.lastPageResponse;
        }
      }
      const carry = mocks.pageResponseCarry;
      if (carry) mocks.lastPageResponse = carry;
      // After three calls (bootstrap, runtime-context, review-context),
      // reset the carry so the next refetch consumes the next queued response.
      if (mocks.pageFetchCount % 3 === 0) {
        mocks.pageResponseCarry = null;
      }
      return new Response(JSON.stringify(carry), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.includes("/api/tasks/") && url.includes("/plan") && !url.includes("/generations")) {
      return new Response(JSON.stringify(mocks.planResponses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.endsWith("/execution/current")) {
      return new Response(JSON.stringify(mocks.currentExecutionResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.endsWith("/commands")) {
      return new Response(JSON.stringify(mocks.commandResponses.shift() ?? {
        commandId: "command-1",
        taskId: "task-1",
        acceptedAt: "2026-05-17T00:00:00.000Z",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mocks.pageResponses = [];
  mocks.pageFetchCount = 0;
  mocks.pageResponseCarry = null;
  mocks.lastPageResponse = null;
  mocks.planResponses = [];
  mocks.acceptResponse = null;
  mocks.commandResponses = [];
  mocks.commandCalls = [];
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
  it("resets plan and activity state when switching recurring work block", async () => {
    const firstPlan = planReadModel({ id: "plan-first", status: "draft", title: "First occurrence plan" });
    const secondPlan = planReadModel({ id: "plan-second", status: "accepted", title: "Second occurrence plan" });
    let task = recurringPageData({
      taskStatus: "Ready",
      plan: firstPlan,
      aiPlanGenerationStatus: "waiting_acceptance",
      workBlockId: "block-first",
    }).task;
    let workspaceEvents: TaskWorkspaceSseEvent[] = [];
    mocks.currentExecutionResponse = executionResult({ status: "running", message: "First running" });
    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: secondPlan },
    ];

    const { result, rerender } = renderHook(
      () => useTaskWorkspacePlanState(task, vi.fn(async () => undefined), workspaceEvents),
      { wrapper: createQueryWrapper() },
    );

    workspaceEvents = [nextWorkspaceEvent({
      type: "execution.runtime_event",
      workBlockId: "block-first",
      eventKind: "tool_started",
      action: "start_manual",
      nodeId: "node-1",
      nodeTitle: "First node",
      runtimeName: "hermes",
      provider: "hermes",
      runId: "run-1",
      event: { type: "assistant_text_delta", text: "First occurrence activity" },
    })];

    await act(async () => {
      rerender();
    });

    expect(result.current.plan?.id).toBe("plan-first");
    expect(result.current.planGenerationStatus).toBe("waiting_acceptance");
    expect(result.current.latestActivitySummary).toBe("First occurrence activity");

    task = recurringPageData({
      taskStatus: "Ready",
      plan: secondPlan,
      aiPlanGenerationStatus: "accepted",
      workBlockId: "block-second",
    }).task;
    workspaceEvents = [];

    await act(async () => {
      rerender();
    });

    await waitFor(() => expect(result.current.plan?.id).toBe("plan-second"));
    expect(result.current.planGenerationStatus).toBe("accepted");
    expect(result.current.latestActivitySummary).toBeNull();
    expect(result.current.runtimeEvents).toEqual([]);
  });
  it("ignores live activity from another recurring work block", async () => {
    const currentPlan = planReadModel({ id: "plan-current", status: "accepted", title: "Current occurrence plan" });
    const task = recurringPageData({
      taskStatus: "Running",
      plan: currentPlan,
      runStatus: "Running",
      workBlockId: "block-current",
    }).task;

    const { result } = renderHook(
      () => useTaskWorkspacePlanState(task, vi.fn(async () => undefined), [
        nextWorkspaceEvent({
          type: "execution.runtime_event",
          workBlockId: "block-other",
          eventKind: "tool_started",
          action: "start_manual",
          nodeId: "node-1",
          nodeTitle: "Other node",
          runtimeName: "hermes",
          provider: "hermes",
          runId: "run-other",
          event: { type: "assistant_text_delta", text: "Other occurrence activity" },
        }),
      ]),
      { wrapper: createQueryWrapper() },
    );

    expect(result.current.latestActivitySummary).toBeNull();
    expect(result.current.liveActivity).toEqual([]);
    expect(result.current.runtimeEvents).toEqual([]);
  });

  it("clears live trail activity when switching recurring work block", async () => {
    const firstPlan = planReadModel({ id: "plan-first", status: "accepted", title: "First occurrence plan" });
    const secondPlan = planReadModel({ id: "plan-second", status: "accepted", title: "Second occurrence plan" });
    let task = recurringPageData({ taskStatus: "Running", plan: firstPlan, runStatus: "Running", workBlockId: "block-first" }).task;
    let workspaceEvents = [nextWorkspaceEvent({
      type: "execution.runtime_event",
      workBlockId: "block-first",
      eventKind: "tool_started",
      action: "start_manual",
      nodeId: "node-1",
      nodeTitle: "First node",
      runtimeName: "hermes",
      provider: "hermes",
      runId: "run-first",
      event: { type: "assistant_text_delta", text: "First occurrence activity" },
    })];

    const { result, rerender } = renderHook(
      () => useTaskWorkspacePlanState(task, vi.fn(async () => undefined), workspaceEvents),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => expect(result.current.latestActivitySummary).toBe("First occurrence activity"));

    task = recurringPageData({ taskStatus: "Running", plan: secondPlan, runStatus: "Running", workBlockId: "block-second" }).task;
    workspaceEvents = [];
    await act(async () => {
      rerender();
    });

    await waitFor(() => expect(result.current.liveActivity).toEqual([]));
    expect(result.current.latestActivitySummary).toBeNull();
    expect(result.current.runtimeEvents).toEqual([]);
  });


  it("syncs router loader data into cached occurrence page data", async () => {
    const firstPlan = planReadModel({ id: "plan-first", status: "accepted", title: "First occurrence plan" });
    const secondPlan = planReadModel({ id: "plan-second", status: "accepted", title: "Second occurrence plan" });
    const firstInitial = recurringPageData({ taskStatus: "Ready", plan: firstPlan, workBlockId: "block-first" });
    const secondInitial = recurringPageData({ taskStatus: "Ready", plan: secondPlan, workBlockId: "block-second" });
    const firstFresh = recurringPageData({ taskStatus: "Running", plan: firstPlan, runStatus: "Running", workBlockId: "block-first" });

    firstInitial.task.title = "First occurrence stale";
    secondInitial.task.title = "Second occurrence";
    firstFresh.task.title = "First occurrence fresh";

    let initialData = firstInitial;
    const { result, rerender } = renderHook(() => useTaskWorkspacePageState(initialData), { wrapper: createQueryWrapper() });

    expect(result.current.pageData.task.title).toBe("First occurrence stale");

    initialData = secondInitial;
    await act(async () => {
      rerender();
    });
    await waitFor(() => expect(result.current.pageData.task.title).toBe("Second occurrence"));

    initialData = firstFresh;
    await act(async () => {
      rerender();
    });

    await waitFor(() => expect(result.current.pageData.task.title).toBe("First occurrence fresh"));
    expect(result.current.pageData.task.status).toBe("Running");
  });

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
    // One SSE `task_workspace_updated` event drives a single
    // `refreshWorkspace()` which fans out into three parallel fetches
    // (bootstrap, runtime-context, review-context).
    expect(mocks.pageFetchCount).toBe(3);
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

  it("shows a ready node as starting while an execution session is active", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Prepare launch" });
    const initialPage = pageData({ taskStatus: "Running", plan: initialPlan, runStatus: "Running" });
    mocks.planResponses = [{ taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: initialPlan }];
    mocks.currentExecutionResponse = executionResult({
      status: "running",
      currentNodeId: "node-1",
      executionSessionId: "execution-session-1",
      message: "Current execution state.",
    });

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace, workspace.workspaceEvents);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.plan.currentExecution?.status).toBe("running"));
    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.statusLabel).toBe("Starting"));

    const node = result.current.plan.graphPlan?.nodes[0];
    expect(node?.status).toBe("active");
    expect(node?.active).toBe(true);
    expect(node?.actionable).toBe(false);
    expect(node?.availableActions).toEqual([]);
    expect(node?.metadata?.launchState).toBe("starting");
  });

  it("does not show a ready node as starting when current execution has no session evidence", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Prepare launch" });
    const initialPage = pageData({ taskStatus: "Ready", plan: initialPlan });
    mocks.planResponses = [{ taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: initialPlan }];
    mocks.currentExecutionResponse = executionResult({
      status: "running",
      currentNodeId: "node-1",
      executionSessionId: null,
      planRunId: undefined,
      message: "No active execution session.",
    });

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace, workspace.workspaceEvents);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.plan.currentExecution?.status).toBe("running"));
    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.status).toBe("ready"));

    const node = result.current.plan.graphPlan?.nodes[0];
    expect(node?.statusLabel).not.toBe("Starting");
    expect(node?.active).not.toBe(true);
    expect(node?.metadata?.launchState).toBeUndefined();
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

  it("does not poll active workspaces while the event stream is healthy", async () => {
    vi.useFakeTimers();
    const initialPlan = planReadModel({ id: "plan-1", status: "running", title: "Execute launch" });
    const initialPage = pageData({ taskStatus: "Running", plan: initialPlan, runStatus: "Running" });
    mocks.pageResponses = [pageData({ taskStatus: "Blocked", plan: initialPlan, runStatus: "Blocked" })];

    const { unmount } = renderHook(() => useTaskWorkspacePageState(initialPage), { wrapper: createQueryWrapper() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });

    unmount();
    // With a healthy event stream the workspace relies on SSE for
    // updates and the fallback poll stays dormant; the queued
    // pageResponses entry is never consumed.
    expect(mocks.pageFetchCount).toBe(0);
    expect(mocks.pageResponses).toHaveLength(1);
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

  it("refreshes recurring plan generation events for the selected work block", async () => {
    const initialPlan = planReadModel({ id: "plan-first", status: "ready", title: "Old recurring plan" });
    const generatedPlan = planReadModel({ id: "plan-generated", status: "draft", title: "Generated recurring plan" });
    const initialPage = recurringPageData({
      taskStatus: "Ready",
      plan: initialPlan,
      aiPlanGenerationStatus: "generating",
      workBlockId: "block-first",
    });
    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "waiting_acceptance", savedPlan: generatedPlan },
    ];

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace, workspace.workspaceEvents);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => {
      const keys = Array.from(mocks.eventHandlers.keys());
      expect(keys.some((key) => key.startsWith("/api/work/task-1/events"))).toBe(true);
    });
    await act(async () => {
      emitWorkspaceEvent(nextWorkspaceEvent({
        type: "plan.generation.event",
        eventKind: "result",
        workBlockId: "block-first",
      }));
    });

    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.title).toBe("Generated recurring plan"), { timeout: 5000 });
    expect(result.current.plan.planGenerationStatus).toBe("waiting_acceptance");
  });

  it("exposes the latest plan generation activity summary", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Old plan" });
    const initialPage = pageData({ taskStatus: "Ready", plan: initialPlan, aiPlanGenerationStatus: "generating" });
    // Plan generation runs in the shared `useTaskPlanGenerationSession`
    // store. The workspace hook surfaces its `statusMessage` / `phase`
    // through `latestActivitySummary` while the session is in flight.
    mocks.generationSession = {
      ...mocks.generationSession,
      sessionStatus: "running",
      statusMessage: "Running tool",
      phase: "streaming",
    };

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace, workspace.workspaceEvents);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await act(async () => {
      mocks.generationSession = { ...mocks.generationSession, statusMessage: "Running tool" };
      emitWorkspaceEvent(nextWorkspaceEvent({ type: "plan.generation.event", eventKind: "tool_call" }));
    });

    expect(result.current.plan.latestActivitySummary).toBe("Running tool");

    await act(async () => {
      mocks.generationSession = { ...mocks.generationSession, statusMessage: "Generating plan" };
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
    expect(mocks.commandCalls.some((call) => call.taskId === "task-1" && call.json.type === "plan.accept")).toBe(true);
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

    mocks.generationSession = {
      ...mocks.generationSession,
      sessionStatus: "running",
      phase: "starting",
      statusMessage: "Generating plan",
    };
    rerender();

    await waitFor(() => expect(result.current.planGenerationStatus).toBe("generating"));

    mocks.planResponses = [{ taskId: "task-1", aiPlanGenerationStatus: "waiting_acceptance", savedPlan: generatedPlan }];
    mocks.generationSession = {
      ...mocks.generationSession,
      sessionStatus: "completed",
      result: generatedPlan,
      phase: "completed",
    };
    rerender();
    await act(async () => {
      await result.current.fetchPlan();
    });

    await waitFor(() => expect(result.current.graphPlan?.nodes[0]?.title).toBe("Generated launch plan"));

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
