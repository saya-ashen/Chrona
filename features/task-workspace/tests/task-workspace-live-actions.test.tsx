import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

import { TaskWorkspacePage } from "../ui/task-workspace-page";
import { createTaskWorkspaceFixturePageData } from "@features/task-workspace/test-support/task-workspace-test-fixtures";
import type { TaskPageData } from "./task-workspace-model";

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
  commandCalls: [] as Array<{ taskId: string; body: Record<string, unknown> }>,
  pageData: null as TaskPageData | null,
  planState: null as {
    taskId: string;
    aiPlanGenerationStatus: "idle" | "generating" | "waiting_acceptance" | "accepted";
    savedPlan: TaskPlanReadModel | null;
    generationSession: null;
  } | null,
  currentExecution: { status: "no_plan" } as Record<string, unknown>,
  setPageContext: vi.fn(),
}));

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class ELKMock {
    layout(graph: unknown) {
      return Promise.resolve(graph);
    }
  },
}));

vi.mock("@/lib/fetch-json-event-source", () => ({
  fetchJsonEventSource: (_input: string, options: FetchEventSourceOptions) => {
    mocks.streamOpened = true;
    mocks.eventHandler = options.onEvent;
    return new Promise<void>(() => undefined);
  },
}));

vi.mock("@/components/assistant-surface/assistant-surface-provider", () => ({
  useAssistantSurface: () => ({
    registerHandlers: vi.fn(() => vi.fn()),
    setPageContext: mocks.setPageContext,
  }),
}));

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({ messages: { components: { taskWorkspace: {} } } }),
}));


vi.mock("@/components/tasks/workspace/sections/task-workspace-edit-section", () => ({
  TaskWorkspaceEditSection: () => null,
}));

vi.mock("@/components/tasks/workspace/sections/task-workspace-plan-section", () => ({
  TaskWorkspacePlanSection: ({ onGeneratePlan, onApplyPlan, plan, canAcceptPlan }: {
    onGeneratePlan: () => void;
    onApplyPlan: (plan: TaskPlanReadModel) => void;
    plan: TaskPlanReadModel | null;
    canAcceptPlan: boolean;
  }) => canAcceptPlan && plan
    ? <button type="button" onClick={() => onApplyPlan(plan)}>Accept plan</button>
    : <button type="button" onClick={onGeneratePlan}>Generate plan</button>,
}));

vi.mock("@/lib/rpc-client", () => ({
  api: {
    work: {
      ":taskId": {
        commands: {
          $post: vi.fn(async (args: { param: { taskId: string }; json: Record<string, unknown> }) => {
            mocks.commandCalls.push({ taskId: args.param.taskId, body: args.json });
            return {
              ok: true,
              json: async () => ({ commandId: `cmd-${mocks.commandCalls.length}`, taskId: args.param.taskId, acceptedAt: "2026-06-13T00:00:00.000Z" }),
            };
          }),
        },
      },
    },
  },
}));

const fetchRoutes: Array<[RegExp | string, () => unknown]> = [
  ["/plan/generations/active", () => ({ generationSession: null })],
  ["/command-center", () => mocks.pageData?.commandCenter ?? { documents: {} }],
  ["/runtime-context", () => ({ latestRunSummary: null, activityTimeline: [], graphPlan: null })],
  ["/review-context", () => ({ scheduleProposals: [], approvals: [], artifacts: [] })],
  [/\/api\/tasks\/[^/]+\/plan(\?|$)/, () => mocks.planState ?? idlePlanState()],
  [/\/api\/tasks\/[^/]+\/execution\/current(\?|$)/, () => mocks.currentExecution],
  [/\/api\/tasks\/[^/]+(\?|$)/, () => mocks.pageData ?? createTaskWorkspaceFixturePageData()],
];

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  const route = fetchRoutes.find(([matcher]) => typeof matcher === "string" ? url.includes(matcher) : matcher.test(url));
  return jsonResponse(route?.[1]() ?? {});
});
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

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

function idlePlanState() {
  return {
    taskId: "task-1",
    aiPlanGenerationStatus: "idle" as const,
    savedPlan: null,
    generationSession: null,
  };
}

function draftPlan(): TaskPlanReadModel {
  return {
    id: "plan-1",
    status: "draft",
    revision: 1,
    summary: "Generated plan",
    prompt: "Generated plan",
    updatedAt: "2026-06-13T00:00:00.000Z",
    generatedBy: null,
    blueprint: {} as unknown as TaskPlanReadModel["blueprint"],
    compiledPlan: {} as unknown as TaskPlanReadModel["compiledPlan"],
    effectivePlan: {} as unknown as TaskPlanReadModel["effectivePlan"],
  };
}

function renderWorkspace(input: { savedPlan?: TaskPlanReadModel | null; planStatus?: "idle" | "waiting_acceptance" | "accepted"; executionStatus?: string } = {}) {
  const savedPlan = input.savedPlan ?? null;
  mocks.pageData = createTaskWorkspaceFixturePageData({
    task: {
      savedPlan,
      aiPlanGenerationStatus: input.planStatus ?? (savedPlan ? "waiting_acceptance" : "idle"),
    },
  });
  mocks.planState = {
    taskId: "task-1",
    aiPlanGenerationStatus: input.planStatus ?? (savedPlan ? "waiting_acceptance" : "idle"),
    savedPlan,
    generationSession: null,
  };
  mocks.currentExecution = { status: input.executionStatus ?? (savedPlan ? "started" : "no_plan") };

  render(<TaskWorkspacePage data={mocks.pageData} />, { wrapper });
}

beforeEach(() => {
  mocks.eventHandler = null;
  mocks.streamOpened = false;
  mocks.commandCalls = [];
  mocks.pageData = null;
  mocks.planState = null;
  mocks.currentExecution = { status: "no_plan" };
  mocks.setPageContext.mockClear();
  fetchMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("TaskWorkspacePage Generate Plan live header action", () => {
  it("updates Generate Plan to Accept Plan from real click plus workspace SSE events", async () => {
    renderWorkspace();
    await waitFor(() => expect(mocks.streamOpened).toBe(true));

    await act(async () => {
      pushEvent("state.snapshot", {
        type: "state.snapshot",
        state: {
          "/execution/show-generate-plan": true,
          "/execution/show-accept-plan": false,
          "/execution/can-start": false,
          "/execution/can-pause": false,
          "/execution/can-stop": false,
          "/execution/start-disabled": true,
          "/execution/status": "no_plan",
        },
      });
    });

    const generate = await screen.findByRole("button", { name: "Generate plan" });
    fireEvent.click(generate);

    await waitFor(() => expect(mocks.commandCalls[0]?.body).toMatchObject({ type: "plan.generate" }));

    await act(async () => {
      pushEvent("state.update", {
        type: "state.update",
        updates: {
          "/plan/generation/is-running": true,
          "/plan/generation/header-action-disabled": true,
          "/plan/generation/stop-disabled": false,
        },
      });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Generate plan" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Stop generation" })).toBeEnabled();

    await act(async () => {
      pushEvent("state.update", {
        type: "state.update",
        updates: {
          "/plan/saved/id": "plan-1",
          "/plan/saved/status": "draft",
          "/plan/saved/revision": 1,
          "/plan/generation/status": "completed",
          "/execution/has-plan": true,
          "/execution/has-accepted-plan": false,
          "/execution/show-accept-plan": true,
          "/execution/show-generate-plan": false,
          "/execution/can-start": false,
          "/execution/start-disabled": true,
          "/execution/start-disabled-reason": "Accept the generated plan before starting execution.",
          "/plan/generation/is-running": false,
          "/plan/generation/header-action-disabled": false,
        },
      });
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Generate plan..." })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Accept plan" })).toBeEnabled();
  });

});

describe("TaskWorkspacePage Accept Plan live header action", () => {

  it("updates Accept Plan to Start from real click plus workspace state.update", async () => {
    renderWorkspace({ savedPlan: draftPlan(), planStatus: "waiting_acceptance", executionStatus: "idle" });
    await waitFor(() => expect(mocks.streamOpened).toBe(true));
    await act(async () => {
      pushEvent("state.snapshot", {
        type: "state.snapshot",
        state: {
          "/execution/show-generate-plan": false,
          "/execution/show-accept-plan": false,
          "/execution/can-start": false,
          "/execution/can-pause": false,
          "/execution/can-stop": false,
          "/execution/start-disabled": true,
          "/execution/status": "no_plan",
        },
      });
    });

    await act(async () => {
      pushEvent("state.update", {
        type: "state.update",
        updates: {
          "/plan/saved/id": "plan-1",
          "/plan/saved/status": "draft",
          "/plan/saved/revision": 1,
          "/plan/generation/status": "completed",
          "/execution/has-plan": true,
          "/execution/has-accepted-plan": false,
          "/plan/generation/is-running": false,
          "/plan/generation/header-action-disabled": false,
          "/execution/show-generate-plan": false,
          "/execution/show-accept-plan": true,
          "/execution/can-start": false,
          "/execution/can-pause": false,
          "/execution/can-stop": false,
          "/execution/start-disabled": true,
          "/execution/start-disabled-reason": "Accept the generated plan before starting execution.",
          "/execution/status": "idle",
        },
      });
    });

    const accept = await screen.findByRole("button", { name: "Accept plan" });
    fireEvent.click(accept);

    await waitFor(() => expect(mocks.commandCalls[0]?.body).toMatchObject({ type: "plan.accept", planId: "plan-1" }));

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
          "/execution/can-pause": false,
          "/execution/can-stop": false,
          "/execution/start-disabled": false,
          "/execution/start-disabled-reason": null,
          "/execution/status": "started",
        },
      });
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Accept plan" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

});

describe("TaskWorkspacePage Start live header action", () => {

  it("updates Start, Pause, and Stop controls from real clicks plus workspace state.update", async () => {
    const acceptedPlan = { ...draftPlan(), status: "accepted" as const, updatedAt: "2026-06-13T00:00:01.000Z" };
    renderWorkspace({ savedPlan: acceptedPlan, planStatus: "accepted", executionStatus: "started" });
    await waitFor(() => expect(mocks.streamOpened).toBe(true));

    await act(async () => {
      pushEvent("state.snapshot", {
        type: "state.snapshot",
        state: {
          "/execution/show-generate-plan": false,
          "/execution/show-accept-plan": false,
          "/execution/can-start": true,
          "/execution/can-pause": false,
          "/execution/can-stop": false,
          "/execution/start-disabled": false,
          "/execution/start-disabled-reason": null,
          "/execution/status": "started",
        },
      });
    });

    const start = await screen.findByRole("button", { name: "Start" });
    fireEvent.click(start);

    await waitFor(() => expect(mocks.commandCalls[0]?.body).toMatchObject({ type: "execution.action", action: "start_manual" }));

    await act(async () => {
      pushEvent("state.update", {
        type: "state.update",
        updates: {
          "/execution/show-accept-plan": false,
          "/execution/show-generate-plan": false,
          "/execution/can-start": false,
          "/execution/can-pause": true,
          "/execution/can-stop": true,
          "/execution/start-disabled": true,
          "/execution/start-disabled-reason": "Task is already running.",
          "/execution/status": "running",
        },
      });
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(mocks.commandCalls[1]?.body).toMatchObject({ type: "execution.action", action: "pause_session" }));

    await act(async () => {
      pushEvent("state.update", {
        type: "state.update",
        updates: {
          "/execution/show-accept-plan": false,
          "/execution/show-generate-plan": false,
          "/execution/can-start": false,
          "/execution/can-pause": false,
          "/execution/can-stop": true,
          "/execution/start-disabled": true,
          "/execution/start-disabled-reason": "Task is waiting for checkpoint input.",
          "/execution/status": "waiting_for_user",
        },
      });
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(mocks.commandCalls[2]?.body).toMatchObject({ type: "execution.action", action: "cancel_session" }));

    await act(async () => {
      pushEvent("state.update", {
        type: "state.update",
        updates: {
          "/execution/show-accept-plan": false,
          "/execution/show-generate-plan": false,
          "/execution/can-start": false,
          "/execution/can-pause": false,
          "/execution/can-stop": false,
          "/execution/start-disabled": true,
          "/execution/start-disabled-reason": "Task is completed.",
          "/execution/status": "cancelled",
        },
      });
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });
});
