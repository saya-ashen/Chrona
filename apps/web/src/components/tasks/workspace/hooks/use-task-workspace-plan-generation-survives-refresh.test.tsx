import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { useTaskWorkspacePlanState } from "./use-task-workspace-plan-state";
import { taskWorkspaceStateFixtures } from "../test-support/task-workspace-test-fixtures";
import type { TaskWorkspaceSseEvent } from "./use-task-workspace-page-state";
import type { TaskData } from "../../../../../../../features/task-workspace";

const mocks = vi.hoisted(() => ({
  planStateResponse: {
    taskId: "task-1",
    aiPlanGenerationStatus: "idle" as "idle" | "generating" | "waiting_acceptance" | "accepted",
    savedPlan: null as unknown,
    generationSession: null as unknown,
  },
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
  },
}));

// Stub global fetch so the session store's HTTP hydrate and the
// per-task plan state query both resolve to the per-test fixture.
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
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
});
vi.stubGlobal("fetch", fetchMock);

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function makeTask(aiPlanGenerationStatus: TaskData["aiPlanGenerationStatus"]): TaskData {
  // The fixture task already has every field `useTaskWorkspacePlanState`
  // needs. We only need to flip the persisted plan-generation status to
  // mirror what the page loader would have stamped on a refresh while a
  // generation is in flight.
  return {
    ...taskWorkspaceStateFixtures.idle.pageData.task,
    aiPlanGenerationStatus,
  } as TaskData;
}

beforeEach(() => {
  mocks.planStateResponse = {
    taskId: "task-1",
    aiPlanGenerationStatus: "idle",
    savedPlan: null,
    generationSession: null,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTaskWorkspacePlanState — plan generation state survives a page refresh", () => {
  it("flips to 'generating' from the spec API signal alone, with no in-memory session", async () => {
    // The page loader on a hard refresh would have computed
    // `task.aiPlanGenerationStatus: "generating"` from
    // `isTaskPlanGenerationRunning` on the server. The `useTaskWorkspacePlanState`
    // hook must surface that as a generating plan state on the very
    // first render, before any SSE or session-store hydrate has had a
    // chance to fire.
    mocks.planStateResponse = {
      taskId: "task-1",
      aiPlanGenerationStatus: "generating",
      savedPlan: null,
      generationSession: null,
    };

    const task = makeTask("generating");
    const { result } = renderHook(
      () => useTaskWorkspacePlanState(task, vi.fn(async () => undefined), [] as TaskWorkspaceSseEvent[]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.planGenerationStatus).toBe("generating"));
  });

  it("stays 'idle' when the spec API and session store both report no active session", async () => {
    mocks.planStateResponse = {
      taskId: "task-1",
      aiPlanGenerationStatus: "idle",
      savedPlan: null,
      generationSession: null,
    };

    const task = makeTask("idle");
    const { result } = renderHook(
      () => useTaskWorkspacePlanState(task, vi.fn(async () => undefined), [] as TaskWorkspaceSseEvent[]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.planGenerationStatus).toBe("idle"));
  });
});
