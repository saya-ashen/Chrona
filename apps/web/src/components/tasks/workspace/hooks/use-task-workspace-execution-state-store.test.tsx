import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { buildTaskHeaderSpec } from "@chrona/ui-protocol";
import type { UiDocument } from "@chrona/ui-protocol";

import { useTaskWorkspacePageState } from "./use-task-workspace-page-state";
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
  fetchCalls: [] as string[],
}));

vi.mock("@/lib/fetch-json-event-source", () => ({
  fetchJsonEventSource: (_input: string, options: FetchEventSourceOptions) => {
    mocks.eventHandler = options.onEvent;
    return new Promise<void>(() => undefined);
  },
}));

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
    work: { ":taskId": { commands: { $post: vi.fn(async () => ({ ok: true, json: async () => null })) } } },
  },
}));

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  mocks.fetchCalls.push(url);
  if (/\/api\/tasks\/[^/]+\/command-center(\?|$)/.test(url)
    || /\/api\/tasks\/[^/]+\/plan(\?|$)/.test(url)
    || /\/api\/tasks\/[^/]+\/execution\/current(\?|$)/.test(url)
    || /\/api\/tasks\/[^/]+\/runtime-context(\?|$)/.test(url)
    || /\/api\/tasks\/[^/]+\/review-context(\?|$)/.test(url)) {
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (/\/api\/tasks\/[^/]+(\?|$)/.test(url)) {
    return new Response(JSON.stringify({ task: { id: "task-1", status: "Ready" }, artifacts: [], activityTimeline: [] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
});
vi.stubGlobal("fetch", fetchMock);

/**
 * Build a header spec that includes the execution-state-driven action
 * elements. The visibility of `action:start` / `action:pause` /
 * `action:stop` / `action:accept-plan` / `action:generate-plan` is
 * bound to the `/execution/...` state paths; the initial state values
 * encode the "ready to start" scenario.
 */
function buildExecutionStateDrivenHeaderSpec(): UiDocument {
  const spec = buildTaskHeaderSpec({
    title: "Launch task",
    status: "waiting",
    statusLabel: "Ready",
    progressLabel: "0 steps · 0 accepted · 0%",
    priorityLabel: "High",
    priorityTone: "warning",
    sourceLabel: null,
    actions: [],
  });
  const startEl = spec.elements["action:start"];
  expect(startEl).toBeDefined();
  startEl.visible = { $state: "/execution/can-start" };
  startEl.props = {
    ...startEl.props,
    disabled: { $state: "/execution/start-disabled" },
    title: { $state: "/execution/start-disabled-reason" },
  };
  const pauseEl = spec.elements["action:pause"];
  expect(pauseEl).toBeDefined();
  pauseEl.visible = { $state: "/execution/can-pause" };
  const stopEl = spec.elements["action:stop"];
  expect(stopEl).toBeDefined();
  stopEl.visible = { $state: "/execution/can-stop" };
  const acceptEl = spec.elements["action:accept-plan"];
  expect(acceptEl).toBeDefined();
  acceptEl.visible = { $state: "/execution/show-accept-plan" };
  const generateEl = spec.elements["action:generate-plan"];
  expect(generateEl).toBeDefined();
  generateEl.visible = { $state: "/execution/show-generate-plan" };
  return spec;
}

function buildPageData(): TaskPageData {
  const base = taskWorkspaceStateFixtures.idle.pageData;
  return {
    ...base,
    header: { spec: buildExecutionStateDrivenHeaderSpec() },
  };
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function pushEvent(type: string, data: Record<string, unknown>) {
  return act(async () => {
    mocks.eventHandler?.({
      event: type,
      data: { type, taskId: "task-1", workspaceId: "ws-1", ...data },
      message: undefined,
    });
  });
}

beforeEach(() => {
  mocks.eventHandler = null;
  mocks.fetchCalls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("execution state propagates to the header state store via SSE", () => {
  it("updates /execution/can-start, /execution/can-pause, /execution/can-stop when the engine pushes state.update on a state transition", async () => {
    const pageData = buildPageData();

    const { result } = renderHook(() => useTaskWorkspacePageState(pageData), { wrapper });

    await waitFor(() => expect(mocks.eventHandler).not.toBeNull());
    // Pre-conditions: the workspace SSE bus has pushed the initial
    // `state.snapshot` containing the execution state paths for a
    // "ready to start" task — Start is enabled, Pause and Stop are
    // hidden.
    await pushEvent("state.snapshot", {
      state: {
        "/execution/can-start": true,
        "/execution/can-pause": false,
        "/execution/can-stop": false,
        "/execution/show-accept-plan": false,
        "/execution/show-generate-plan": false,
        "/execution/start-disabled": false,
        "/execution/start-disabled-reason": null,
        "/execution/status": "ready",
        "/execution/has-plan": true,
        "/execution/has-accepted-plan": true,
      },
    });

    await waitFor(() => {
      expect(result.current.headerStore.get("/execution/can-start")).toBe(true);
    });
    expect(result.current.headerStore.get("/execution/can-pause")).toBe(false);
    expect(result.current.headerStore.get("/execution/can-stop")).toBe(false);

    // Simulate the engine pushing the post-Start state onto the SSE bus.
    // This is the contract the work.routes.ts `dispatchWorkspaceCommand`
    // `execution.action` branch must satisfy so the header re-renders.
    await pushEvent("state.update", {
      updates: {
        "/execution/can-start": false,
        "/execution/can-pause": true,
        "/execution/can-stop": true,
        "/execution/start-disabled": true,
        "/execution/start-disabled-reason": "Task is already running.",
        "/execution/status": "running",
      },
    });

    await waitFor(() => {
      expect(result.current.headerStore.get("/execution/can-start")).toBe(false);
    });
    expect(result.current.headerStore.get("/execution/can-pause")).toBe(true);
    expect(result.current.headerStore.get("/execution/can-stop")).toBe(true);
    expect(result.current.headerStore.get("/execution/start-disabled")).toBe(true);
    expect(result.current.headerStore.get("/execution/start-disabled-reason")).toBe("Task is already running.");
    expect(result.current.headerStore.get("/execution/status")).toBe("running");

    // Now simulate completion: only Stop is in play for a no-action
    // terminal state. The spec hides Pause and Stop and stays on
    // `can-start = false`.
    await pushEvent("state.update", {
      updates: {
        "/execution/can-start": false,
        "/execution/can-pause": false,
        "/execution/can-stop": false,
        "/execution/start-disabled": true,
        "/execution/start-disabled-reason": "Task is completed.",
        "/execution/status": "completed",
      },
    });

    await waitFor(() => {
      expect(result.current.headerStore.get("/execution/status")).toBe("completed");
    });
    expect(result.current.headerStore.get("/execution/can-start")).toBe(false);
    expect(result.current.headerStore.get("/execution/can-pause")).toBe(false);
    expect(result.current.headerStore.get("/execution/can-stop")).toBe(false);
    expect(result.current.headerStore.get("/execution/start-disabled-reason")).toBe("Task is completed.");
  });
});
