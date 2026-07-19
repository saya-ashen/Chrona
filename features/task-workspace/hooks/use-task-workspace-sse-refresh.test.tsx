import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { useTaskWorkspacePageState } from "./use-task-workspace-page-state";
import { useTaskWorkspacePlanState } from "./use-task-workspace-plan-state";
import { taskWorkspaceStateFixtures } from "@features/task-workspace/test";
import type { TaskPageData } from "@features/task-workspace"

type JsonEventHandler = (event: { event: string; data: Record<string, unknown>; message: unknown }) => void;
type FetchEventSourceOptions = {
  onEvent: JsonEventHandler;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

const mocks = vi.hoisted(() => ({
  eventHandler: null as JsonEventHandler | null,
  fetchCalls: [] as string[],
  commandCenterResponses: [] as Array<Record<string, unknown>>,
  planStateResponses: [] as Array<Record<string, unknown>>,
  executionResponses: [] as Array<Record<string, unknown>>,
  pageResponse: null as Record<string, unknown> | null,
  richPageData: null as TaskPageData | null,
}));

vi.mock("@shared/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("@shared/http")>()), fetchJsonEventSource: (_input: string, options: FetchEventSourceOptions) => {
  mocks.eventHandler = options.onEvent;
  return new Promise<void>(() => undefined);
}, }));

vi.mock("@/lib/rpc-client", () => ({
  api: {
    tasks: {
      ":taskId": {
        $get: vi.fn(async () => ({ ok: true, json: async () => null })),
        plan: {
          $get: vi.fn(async () => ({ ok: true, json: async () => null })),
          accept: { $post: vi.fn(async () => ({ ok: true, json: async () => null })) },
        },
        execution: {
          current: { $get: vi.fn(async () => ({ ok: true, json: async () => null })) },
        },
      },
    },
    work: {
      ":taskId": {
        commands: {
          $post: vi.fn(async () => ({ ok: true, json: async () => null })),
        },
      },
    },
  },
}));

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  mocks.fetchCalls.push(url);

  if (/\/api\/tasks\/[^/]+\/command-center(\?|$)/.test(url)) {
    const next = mocks.commandCenterResponses.shift();
    const body = next ?? { taskId: "task-1", now: null, output: null, trail: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (/\/api\/tasks\/[^/]+\/plan(\?|$)/.test(url)) {
    const next = mocks.planStateResponses.shift();
    const body = next ?? { taskId: "task-1", aiPlanGenerationStatus: "idle", savedPlan: null, generationSession: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (/\/api\/tasks\/[^/]+\/execution\/current(\?|$)/.test(url)) {
    const next = mocks.executionResponses.shift();
    const body = next ?? { taskId: "task-1", status: "idle" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (/\/api\/tasks\/[^/]+\/runtime-context(\?|$)/.test(url)
    || /\/api\/tasks\/[^/]+\/review-context(\?|$)/.test(url)) {
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (/\/api\/tasks\/[^/]+(\?|$)/.test(url)) {
    const override = mocks.pageResponse;
    if (override) {
      mocks.pageResponse = null;
      return new Response(JSON.stringify(override), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const rich = mocks.richPageData;
    const body = rich ?? { task: { id: "task-1", status: "Ready" }, artifacts: [], activityTimeline: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
});
vi.stubGlobal("fetch", fetchMock);

function buildPageData(workBlockId: string): TaskPageData {
  const base = taskWorkspaceStateFixtures.idle.pageData;
  const rich: TaskPageData = {
    ...base,
    task: {
      ...base.task,
      currentWorkBlock: {
        id: workBlockId,
        status: "Scheduled",
        scheduledStartAt: "2026-06-10T00:00:00.000Z",
        scheduledEndAt: "2026-06-10T01:00:00.000Z",
      },
    },
  };
  mocks.richPageData = rich;
  return rich;
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function pushEvent(type: string, extra: Record<string, unknown> = {}) {
  return act(async () => {
    mocks.eventHandler?.({
      event: type,
      data: { type, taskId: "task-1", workspaceId: "ws-1", ...extra },
      message: undefined,
    });
  });
}

function fetchCallCount(pathRegex: RegExp): number {
  return mocks.fetchCalls.filter((url) => pathRegex.test(url)).length;
}

beforeEach(() => {
  mocks.eventHandler = null;
  mocks.fetchCalls.length = 0;
  mocks.pageResponse = null;
  mocks.richPageData = null;
  mocks.commandCenterResponses.length = 0;
  mocks.planStateResponses.length = 0;
  mocks.executionResponses.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSE-driven refetch of dependent queries", () => {
  it("refetches page, command center, plan state, and current execution when the relevant SSE event is pushed", async () => {
    const pageData = buildPageData("block-A");

    renderHook(() => {
      const workspace = useTaskWorkspacePageState(pageData);
      useTaskWorkspacePlanState(
        workspace.pageData.task,
        workspace.refreshWorkspace,
        workspace.workspaceEvents,
      );
      return workspace;
    }, { wrapper });

    await waitFor(() => expect(mocks.eventHandler).not.toBeNull());

    // Phase 1: `execution.state.updated` must refetch the page, command
    // center, plan state, and current execution. The four queries are all
    // observed by the workspace hook + plan-state hook, so a single SSE
    // event that triggers `refreshWorkspace` should invalidate and refetch
    // each. (Pre-fix the SSE handler only invalidated `pageQueryKey`.)
    const pageBefore = fetchCallCount(/\/api\/tasks\/task-1(\?|$)/);
    const commandCenterBefore = fetchCallCount(/\/api\/tasks\/task-1\/command-center(\?|$)/);
    const executionBefore = fetchCallCount(/\/api\/tasks\/task-1\/execution\/current(\?|$)/);

    mocks.commandCenterResponses.push({
      taskId: "task-1",
      now: { root: "now", elements: { now: { type: "RichMarkdown", props: { content: "running" } } } },
      output: null,
      trail: [],
    });
    mocks.executionResponses.push({ taskId: "task-1", status: "running" });
    mocks.pageResponse = { task: { id: "task-1", status: "Running" }, artifacts: [], activityTimeline: [] };
    await pushEvent("execution.state.updated", { eventKind: "running" });

    await waitFor(() => {
      expect(fetchCallCount(/\/api\/tasks\/task-1(\?|$)/)).toBeGreaterThan(pageBefore);
    });
    await waitFor(() => {
      expect(fetchCallCount(/\/api\/tasks\/task-1\/command-center(\?|$)/)).toBeGreaterThan(commandCenterBefore);
    });
    await waitFor(() => {
      expect(fetchCallCount(/\/api\/tasks\/task-1\/execution\/current(\?|$)/)).toBeGreaterThan(executionBefore);
    });

    // `planState` is invalidated but the workspace hooks don't re-fetch it
    // from a plan-state queryFn — the page query composes it. The combined
    // page refetch above is the integration-level evidence.

    // Phase 2: `task_workspace_updated` (e.g. emitted by `plan.accept`)
    // must refetch the page snapshot. (Pre-fix the SSE handler called
    // `refreshWorkspacePage`, but with the wrong wiring this signal was
    // dropped on the floor in some tests.)
    const pageBeforePhase2 = fetchCallCount(/\/api\/tasks\/task-1(\?|$)/);
    mocks.pageResponse = { task: { id: "task-1", status: "Ready" }, artifacts: [], activityTimeline: [] };
    await pushEvent("task_workspace_updated", { reason: "plan.accepted" });

    await waitFor(() => {
      expect(fetchCallCount(/\/api\/tasks\/task-1(\?|$)/)).toBeGreaterThan(pageBeforePhase2);
    });
  });

  it("refetches persisted activity when an SSE connection becomes ready", async () => {
    const pageData = buildPageData("block-A");

    renderHook(() => useTaskWorkspacePageState(pageData), { wrapper });

    await waitFor(() => expect(mocks.eventHandler).not.toBeNull());
    const commandCenterBefore = fetchCallCount(/\/api\/tasks\/task-1\/command-center(\?|$)/);
    const pageBefore = fetchCallCount(/\/api\/tasks\/task-1(\?|$)/);

    await pushEvent("ready");

    await waitFor(() => {
      expect(fetchCallCount(/\/api\/tasks\/task-1\/command-center(\?|$)/)).toBeGreaterThan(commandCenterBefore);
    });
    expect(fetchCallCount(/\/api\/tasks\/task-1(\?|$)/)).toBe(pageBefore);
  });
});
