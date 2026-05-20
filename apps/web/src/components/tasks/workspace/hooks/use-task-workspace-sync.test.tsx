import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import { useTaskWorkspacePageState } from "./use-task-workspace-page-state";
import { useTaskWorkspacePlanState } from "./use-task-workspace-plan-state";
import type { TaskPageData } from "../model/task-workspace-types";

type JsonEventHandler = (event: { event: string; data: Record<string, unknown>; message: unknown }) => void;

const mocks = vi.hoisted(() => ({
  pageResponses: [] as TaskPageData[],
  planResponses: [] as Array<{ taskId: string; aiPlanGenerationStatus?: string; savedPlan?: TaskPlanReadModel | null; generationSession?: unknown }>,
  eventHandlers: new Map<string, JsonEventHandler>(),
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
  fetchJsonEventSource: (input: string, options: { onEvent: JsonEventHandler }) => {
    mocks.eventHandlers.set(input, options.onEvent);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/rpc-client", () => ({
  api: {
    tasks: {
      ":taskId": {
        $get: vi.fn(async () => ({
          ok: true,
          json: async () => mocks.pageResponses.shift(),
        })),
        plan: {
          $get: vi.fn(async () => ({
            ok: true,
            json: async () => mocks.planResponses.shift(),
          })),
          accept: {
            $post: vi.fn(),
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

function planReadModel(input: { id: string; status: "ready" | "running"; title: string }): TaskPlanReadModel {
  const effectiveStatus = input.status === "running" ? "running" : "ready";

  return {
    id: input.id,
    taskId: "task-1",
    status: "accepted",
    revision: 1,
    summary: input.title,
    prompt: input.title,
    blueprint: null,
    generatedBy: null,
    generatedAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
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

afterEach(() => {
  mocks.pageResponses = [];
  mocks.planResponses = [];
  mocks.eventHandlers.clear();
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

describe("task workspace page synchronization", () => {
  it("updates the rendered plan graph when a projection event refetches the full workspace page", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Prepare launch" });
    const runningPlan = planReadModel({ id: "plan-1", status: "running", title: "Execute launch" });
    const initialPage = pageData({ taskStatus: "Ready", plan: initialPlan });
    mocks.pageResponses = [pageData({ taskStatus: "Running", plan: runningPlan, runStatus: "Running" })];
    mocks.planResponses = [{ taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: initialPlan }];

    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPage);
      const plan = useTaskWorkspacePlanState(workspace.pageData.task, workspace.refreshWorkspace);
      return { workspace, plan };
    }, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mocks.eventHandlers.has("/api/work/task-1/events")).toBe(true));
    await waitFor(() => expect(result.current.plan.graphPlan?.nodes[0]?.title).toBe("Prepare launch"));
    expect(result.current.plan.graphPlan?.nodes[0]?.status).toBe("ready");

    await act(async () => {
      mocks.eventHandlers.get("/api/work/task-1/events")?.({ event: "task_projection_updated", data: {}, message: {} });
    });

    await waitFor(() => expect(result.current.workspace.pageData.task.status).toBe("Running"));
    expect(result.current.plan.graphPlan?.nodes[0]?.title).toBe("Execute launch");
    expect(result.current.plan.graphPlan?.nodes[0]?.status).toBe("active");
  });

  it("refreshes the full workspace page when plan generation settles", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Old plan" });
    const generatedPlan = planReadModel({ id: "plan-2", status: "ready", title: "Generated plan" });
    const refreshWorkspace = vi.fn(async () => undefined);
    mocks.generationSession = {
      ...mocks.generationSession,
      generationId: "generation-1",
      sessionStatus: "running",
      isLoading: true,
      phase: "connecting",
      hydrated: true,
    };
    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "generating", savedPlan: initialPlan },
      { taskId: "task-1", aiPlanGenerationStatus: "waiting_acceptance", savedPlan: generatedPlan },
    ];

    const { rerender } = renderHook(
      () => useTaskWorkspacePlanState(
        pageData({ taskStatus: "Ready", plan: initialPlan, aiPlanGenerationStatus: "generating" }).task,
        refreshWorkspace,
      ),
      { wrapper: createQueryWrapper() },
    );

    mocks.generationSession = {
      ...mocks.generationSession,
      sessionStatus: "completed",
      result: { ...generatedPlan, status: "draft" },
      isLoading: false,
      phase: "done",
    };

    rerender();

    await waitFor(() => expect(refreshWorkspace).toHaveBeenCalledTimes(1));
  });

  it("exposes the latest plan generation activity summary", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Old plan" });
    mocks.generationSession = {
      ...mocks.generationSession,
      generationId: "generation-1",
      sessionStatus: "running",
      isLoading: true,
      statusMessage: "Requesting provider stream",
      partialText: "",
      toolCalls: [{ tool: "build_plan", input: {} }],
      toolResults: [],
      phase: "connecting",
      hydrated: true,
    };
    mocks.planResponses = [{ taskId: "task-1", aiPlanGenerationStatus: "generating", savedPlan: initialPlan }];

    const { result, rerender } = renderHook(
      () => useTaskWorkspacePlanState(
        pageData({ taskStatus: "Ready", plan: initialPlan, aiPlanGenerationStatus: "generating" }).task,
        vi.fn(async () => undefined),
      ),
      { wrapper: createQueryWrapper() },
    );

    expect(result.current.latestActivitySummary).toBe("Running build_plan");

    mocks.generationSession = {
      ...mocks.generationSession,
      toolResults: [{ tool: "build_plan", result: "done" }],
    };

    rerender();

    expect(result.current.latestActivitySummary).toBe("build_plan completed");
  });

  it("uses a completed generation session result even when the AI panel is not mounted", async () => {
    const initialPlan = planReadModel({ id: "plan-1", status: "ready", title: "Old plan" });
    const generatedPlan = planReadModel({ id: "plan-2", status: "ready", title: "Generated plan" });
    const refreshWorkspace = vi.fn(async () => undefined);
    mocks.generationSession = {
      ...mocks.generationSession,
      generationId: "generation-1",
      sessionStatus: "running",
      isLoading: true,
      phase: "connecting",
      hydrated: true,
    };
    mocks.planResponses = [
      { taskId: "task-1", aiPlanGenerationStatus: "waiting_acceptance", savedPlan: initialPlan },
    ];

    const { result, rerender } = renderHook(
      () => useTaskWorkspacePlanState(
        pageData({ taskStatus: "Ready", plan: initialPlan, aiPlanGenerationStatus: "generating" }).task,
        refreshWorkspace,
      ),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => expect(result.current.graphPlan?.nodes[0]?.title).toBe("Old plan"));

    mocks.generationSession = {
      ...mocks.generationSession,
      sessionStatus: "completed",
      result: { ...generatedPlan, status: "draft" },
      isLoading: false,
      phase: "done",
    };

    rerender();

    await waitFor(() => expect(result.current.graphPlan?.nodes[0]?.title).toBe("Generated plan"));
    expect(result.current.planGenerationStatus).toBe("waiting_acceptance");
  });
});
