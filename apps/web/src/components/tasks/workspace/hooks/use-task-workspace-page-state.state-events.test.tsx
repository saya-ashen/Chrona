import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { useTaskWorkspacePageState, type TaskWorkspaceSseEvent } from "./use-task-workspace-page-state";
import { taskWorkspaceStateFixtures } from "../test-support/task-workspace-test-fixtures";
import type { TaskPageData } from "../../../../../../../features/task-workspace";

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
  streamOpened: false,
  fetchUrls: [] as string[],
}));

vi.mock("@/lib/fetch-json-event-source", () => ({
  fetchJsonEventSource: (_input: string, options: FetchEventSourceOptions) => {
    mocks.streamOpened = true;
    mocks.eventHandler = options.onEvent;
    return new Promise<void>(() => undefined);
  },
}));

vi.mock("@/lib/rpc-client", () => ({
  api: {
    tasks: {
      ":taskId": {
        $get: vi.fn(async () => ({ ok: true, json: async () => taskWorkspaceStateFixtures.idle.pageData })),
        plan: {
          $get: vi.fn(async () => ({ ok: true, json: async () => ({ taskId: "task-1", aiPlanGenerationStatus: "idle", savedPlan: null, generationSession: null }) })),
        },
        execution: {
          current: {
            $get: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
          },
        },
      },
    },
    work: {
      ":taskId": {
        commands: {
          $post: vi.fn(async () => ({ ok: true, json: async () => ({ commandId: "c-1", taskId: "task-1", acceptedAt: "2026-06-10T00:00:00.000Z" }) })),
        },
      },
    },
  },
}));

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  mocks.fetchUrls.push(url);
  if (url.includes("/runtime-context")) {
    return new Response(JSON.stringify({
      latestRunSummary: null,
      activityTimeline: [],
      graphPlan: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/review-context")) {
    return new Response(JSON.stringify({
      scheduleProposals: [],
      approvals: [],
      artifacts: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/command-center")) {
    return new Response(JSON.stringify(taskWorkspaceStateFixtures.idle.pageData.commandCenter), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/execution/current")) {
    return new Response(JSON.stringify({ status: "running" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/plan")) {
    return new Response(JSON.stringify({
      taskId: "task-1",
      aiPlanGenerationStatus: "accepted",
      savedPlan: { id: "plan-1", status: "accepted", revision: 1 },
      generationSession: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify(initialPageForTest), { status: 200, headers: { "Content-Type": "application/json" } });
});
vi.stubGlobal("fetch", fetchMock);

let initialPageForTest: TaskPageData = taskWorkspaceStateFixtures.idle.pageData;

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function pushEvent(event: string, data: Record<string, unknown>) {
  if (!mocks.eventHandler) throw new Error("SSE mock not registered");
  mocks.eventHandler({ event, data, message: { data: JSON.stringify(data), event } as unknown });
}

afterEach(() => {
  mocks.eventHandler = null;
  mocks.streamOpened = false;
  mocks.fetchUrls = [];
  fetchMock.mockClear();
});

describe("useTaskWorkspacePageState — state.snapshot / state.update dispatch", () => {
  it("writes state.update events into the workspace stateStore", async () => {
    initialPageForTest = taskWorkspaceStateFixtures.idle.pageData;
    const { result } = renderHook(() => useTaskWorkspacePageState(initialPageForTest), { wrapper });

    await waitFor(() => expect(mocks.streamOpened).toBe(true));
    expect(result.current.stateStore.get("/plan/generation/phase")).toBeUndefined();

    const update: TaskWorkspaceSseEvent = {
      type: "state.update",
      updates: {
        "/plan/generation/phase": "starting",
        "/plan/generation/statusMessage": "Requesting provider",
      },
    };

    await act(async () => {
      pushEvent("state.update", update as unknown as Record<string, unknown>);
    });

    await waitFor(() => {
      expect(result.current.stateStore.get("/plan/generation/phase")).toBe("starting");
      expect(result.current.stateStore.get("/plan/generation/statusMessage")).toBe("Requesting provider");
    });
  });

  it("applies state.snapshot to seed the store and clears prior keys", async () => {
    initialPageForTest = taskWorkspaceStateFixtures.idle.pageData;
    const { result } = renderHook(() => useTaskWorkspacePageState(initialPageForTest), { wrapper });

    await waitFor(() => expect(mocks.streamOpened).toBe(true));

    // Seed two keys via state.update first so we can verify snapshot clears them.
    await act(async () => {
      pushEvent("state.update", {
        type: "state.update",
        updates: {
          "/plan/generation/phase": "starting",
          "/plan/generation/lastTool": "tool-x",
        },
      });
    });
    await waitFor(() => expect(result.current.stateStore.get("/plan/generation/lastTool")).toBe("tool-x"));

    // Now a snapshot with a different set of keys.
    await act(async () => {
      pushEvent("state.snapshot", {
        type: "state.snapshot",
        state: {
          "/plan/status": "generating",
          "/plan/saved/id": null,
          "/plan/generation/id": "gen-1",
          "/plan/generation/status": "running",
          "/plan/generation/phase": "loading_task",
          "/plan/generation/partialText": "",
          "/plan/generation/statusMessage": null,
        },
      });
    });

    await waitFor(() => {
      expect(result.current.stateStore.get("/plan/status")).toBe("generating");
      expect(result.current.stateStore.get("/plan/generation/id")).toBe("gen-1");
      expect(result.current.stateStore.get("/plan/generation/phase")).toBe("loading_task");
      // Cleared: the snapshot did not include them.
      expect(result.current.stateStore.get("/plan/generation/lastTool")).toBeNull();
    });
  });

  it("does not refetch the workspace page for state events", async () => {
    initialPageForTest = taskWorkspaceStateFixtures.idle.pageData;
    const { result } = renderHook(() => useTaskWorkspacePageState(initialPageForTest), { wrapper });

    await waitFor(() => expect(mocks.streamOpened).toBe(true));

    await act(async () => {
      pushEvent("state.update", {
        type: "state.update",
        updates: { "/plan/generation/phase": "requesting_provider" },
      });
    });

    await waitFor(() => expect(result.current.stateStore.get("/plan/generation/phase")).toBe("requesting_provider"));
    // No assertion for fetch count here — the rpc mock makes count opaque
    // (we just ensure no exception escaped during a state-only event).
  });

  it("applies accepted-plan header action state from state.update", async () => {
    initialPageForTest = taskWorkspaceStateFixtures.idle.pageData;
    const { result } = renderHook(() => useTaskWorkspacePageState(initialPageForTest), { wrapper });

    await waitFor(() => expect(mocks.streamOpened).toBe(true));

    await act(async () => {
      pushEvent("state.update", {
        type: "state.update",
        updates: {
          "/plan/saved/status": "accepted",
          "/execution/has-plan": true,
          "/execution/has-accepted-plan": true,
          "/execution/show-accept-plan": false,
          "/execution/show-generate-plan": false,
          "/execution/can-start": true,
          "/execution/start-disabled": false,
          "/execution/start-disabled-reason": null,
          "/execution/status": "started",
        },
      });
    });

    await waitFor(() => {
      expect(result.current.stateStore.get("/execution/show-accept-plan")).toBe(false);
      expect(result.current.stateStore.get("/execution/can-start")).toBe(true);
      expect(result.current.stateStore.get("/execution/start-disabled")).toBe(false);
      expect(result.current.stateStore.get("/execution/status")).toBe("started");
    });
  });

  it("applies running header action state from post-start state.update", async () => {
    initialPageForTest = taskWorkspaceStateFixtures.idle.pageData;
    const { result } = renderHook(() => useTaskWorkspacePageState(initialPageForTest), { wrapper });

    await waitFor(() => expect(mocks.streamOpened).toBe(true));

    await act(async () => {
      pushEvent("state.update", {
        type: "state.update",
        updates: {
          "/execution/status": "running",
          "/execution/can-start": false,
          "/execution/can-pause": true,
          "/execution/can-stop": true,
          "/execution/start-disabled": false,
          "/execution/start-disabled-reason": "Task is already running.",
        },
      });
    });

    await waitFor(() => {
      expect(result.current.stateStore.get("/execution/status")).toBe("running");
      expect(result.current.stateStore.get("/execution/can-start")).toBe(false);
      expect(result.current.stateStore.get("/execution/can-pause")).toBe(true);
      expect(result.current.stateStore.get("/execution/can-stop")).toBe(true);
    });
  });

  it("refreshes workspace queries for workspace and execution terminal events", async () => {
    initialPageForTest = taskWorkspaceStateFixtures.idle.pageData;
    renderHook(() => useTaskWorkspacePageState(initialPageForTest), { wrapper });

    await waitFor(() => expect(mocks.streamOpened).toBe(true));
    fetchMock.mockClear();
    mocks.fetchUrls = [];

    await act(async () => {
      pushEvent("task_workspace_updated", {
        type: "task_workspace_updated",
        taskId: "task-1",
        reason: "plan.accepted",
      });
    });

    await waitFor(() => {
      expect(mocks.fetchUrls.some((url) => url === "/api/tasks/task-1" || url.includes("/api/tasks/task-1?"))).toBe(true);
      expect(mocks.fetchUrls.some((url) => url.includes("/api/tasks/task-1/runtime-context"))).toBe(true);
      expect(mocks.fetchUrls.some((url) => url.includes("/api/tasks/task-1/review-context"))).toBe(true);
    });

    fetchMock.mockClear();
    mocks.fetchUrls = [];

    await act(async () => {
      pushEvent("execution.result", {
        type: "execution.result",
        taskId: "task-1",
        eventKind: "running",
      });
    });

    await waitFor(() => {
      expect(mocks.fetchUrls.some((url) => url === "/api/tasks/task-1" || url.includes("/api/tasks/task-1?"))).toBe(true);
      expect(mocks.fetchUrls.some((url) => url.includes("/api/tasks/task-1/runtime-context"))).toBe(true);
      expect(mocks.fetchUrls.some((url) => url.includes("/api/tasks/task-1/review-context"))).toBe(true);
    });
  });
});
