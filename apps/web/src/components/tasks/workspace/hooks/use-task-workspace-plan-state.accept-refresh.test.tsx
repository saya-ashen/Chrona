import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { useTaskWorkspacePlanState } from "./use-task-workspace-plan-state";
import { useTaskWorkspacePageState } from "./use-task-workspace-page-state";
import { taskWorkspaceStateFixtures } from "../../../../../../../features/task-workspace/test-support/task-workspace-test-fixtures";
import type { TaskPageData } from "../../../../../../../features/task-workspace";

const mocks = vi.hoisted(() => ({
  planStateResponse: {
    taskId: "task-1",
    aiPlanGenerationStatus: "waiting_acceptance" as "idle" | "generating" | "waiting_acceptance" | "accepted",
    savedPlan: {
      id: "plan-1",
      status: "draft",
      revision: 1,
      summary: "Generated plan",
      prompt: "Generated plan",
      blueprint: null,
      generatedBy: null,
      generatedAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    },
    generationSession: null,
  },
  acceptedPlanResponse: {
    taskId: "task-1",
    aiPlanGenerationStatus: "accepted" as const,
    savedPlan: {
      id: "plan-1",
      status: "accepted",
      revision: 1,
      summary: "Generated plan",
      prompt: "Generated plan",
      blueprint: null,
      generatedBy: null,
      generatedAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:01.000Z",
    },
    generationSession: null,
  },
  commandCalls: [] as Array<{ taskId: string; body: Record<string, unknown> }>,
}));

vi.mock("@/lib/rpc-client", () => ({
  api: {
    tasks: {
      ":taskId": {
        $get: vi.fn(async () => ({ ok: true, json: async () => taskWorkspaceStateFixtures.idle.pageData })),
        plan: {
          $get: vi.fn(async () => ({ ok: true, json: async () => mocks.planStateResponse })),
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
          $post: vi.fn(async (args: { param: { taskId: string }; json: Record<string, unknown> }) => {
            mocks.commandCalls.push({ taskId: args.param.taskId, body: args.json });
            // Simulate backend processing: after the command is
            // accepted, the next /plan fetch should return the
            // accepted state. (In production the SSE task_projection_updated
            // event triggers the refetch; the mock just toggles on the
            // next fetch.)
            mocks.planStateResponse = mocks.acceptedPlanResponse;
            return {
              ok: true,
              json: async () => ({
                commandId: "c-1",
                taskId: "task-1",
                acceptedAt: "2026-06-10T00:00:00.000Z",
              }),
            };
          }),
        },
      },
    },
  },
}));

/**
 * `useTaskWorkspacePageState` opens a real `fetchJsonEventSource` against
 * `/api/work/:taskId/events` on mount. Without this mock the helper keeps
 * the stream alive (it owns reconnect timers and a `window`-bound fetch
 * implementation from `@microsoft/fetch-event-source`), so React 19's
 * scheduler queues a `processImmediate` callback that fires AFTER vitest
 * tears the per-test jsdom window down. That callback references
 * `window.event` inside `react-dom-client.development.js:17920` and
 * throws `ReferenceError: window is not defined` — counted as an
 * unhandled error even though every assertion passed. Mocking the helper
 * matches the pattern used by every other workspace hook test
 * (e.g. `use-task-workspace-sse-refresh.test.tsx`,
 * `use-task-workspace-page-state.state-events.test.tsx`).
 */
vi.mock("@/lib/fetch-json-event-source", () => ({
  fetchJsonEventSource: vi.fn(async () => undefined),
}));


const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/plan/generations/active")) {
    return new Response(JSON.stringify({ generationSession: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (/\/api\/tasks\/[^/]+\/plan(\?|$)/.test(url)) {
    return new Response(JSON.stringify(mocks.planStateResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (/\/api\/tasks\/[^/]+\?/.test(url) || /\/api\/work\/[^/]+(\?|$)/.test(url) || /\/api\/tasks\/[^/]+$/.test(url)) {
    return new Response(JSON.stringify(taskWorkspaceStateFixtures.idle.pageData), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
});
vi.stubGlobal("fetch", fetchMock);

let initialPageForTest: TaskPageData = taskWorkspaceStateFixtures.idle.pageData;

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.commandCalls = [];
  mocks.planStateResponse = {
    taskId: "task-1",
    aiPlanGenerationStatus: "waiting_acceptance",
    savedPlan: {
      id: "plan-1",
      status: "draft",
      revision: 1,
      summary: "Generated plan",
      prompt: "Generated plan",
      blueprint: null,
      generatedBy: null,
      generatedAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    },
    generationSession: null,
  };
});

afterEach(async () => {
  cleanup();
  // Flush React 19's pending `setImmediate` scheduler callbacks before
  // vitest destroys the per-test jsdom environment. Without this, the
  // scheduler callback reads `window.event` after `window` is gone and
  // vitest reports an unhandled `ReferenceError`.
  await new Promise<void>((resolve) => setImmediate(resolve));
  vi.unstubAllGlobals();
});

describe("useTaskWorkspacePlanState — accept plan", () => {
  it("flips canAcceptPlan to false after acceptPlanById resolves", async () => {
    initialPageForTest = taskWorkspaceStateFixtures.idle.pageData;
    const { result } = renderHook(() => {
      const workspace = useTaskWorkspacePageState(initialPageForTest);
      const plan = useTaskWorkspacePlanState(
        workspace.pageData.task,
        workspace.refreshWorkspace,
        workspace.workspaceEvents,
      );
      return { workspace, plan };
    }, { wrapper });

    // Give the plan query time to settle at the waiting_acceptance snapshot.
    await waitFor(() => expect(result.current.plan.planGenerationStatus).toBe("waiting_acceptance"));
    expect(result.current.plan.canAcceptPlan).toBe(true);

    await act(async () => {
      await result.current.plan.acceptPlanById("plan-1");
    });

    // Optimistic update: the flow should already be 'accepted' by the
    // time the command POST resolves, because the local plan flow
    // machine flips to 'completed' state synchronously after the 202
    // returns. The plan state query is not yet refetched (the SSE
    // task_projection_updated event would normally trigger that), so
    // the status shown is the optimistic 'accepted'.
    await waitFor(() => expect(result.current.plan.canAcceptPlan).toBe(false));
    expect(result.current.plan.planGenerationStatus).toBe("accepted");
    expect(mocks.commandCalls[0]?.body).toMatchObject({ type: "plan.accept", planId: "plan-1" });
  });
});
