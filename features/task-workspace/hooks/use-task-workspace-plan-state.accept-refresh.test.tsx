import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import type * as SharedHttp from "@shared/http";

import { useTaskWorkspacePlanState } from "./use-task-workspace-plan-state";
import { useTaskWorkspacePageState } from "./use-task-workspace-page-state";
import { taskWorkspaceStateFixtures } from "@features/task-workspace/test";
import type { TaskPageData } from "@features/task-workspace"

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
    generationSession: { generationId: "generation-1", taskId: "task-1", headStateVersion: 2, status: "completed" as const, phase: null, statusMessage: null, error: null, startedAt: "2026-06-10T00:00:00.000Z", finishedAt: "2026-06-10T00:00:00.000Z" },
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
    generationSession: { generationId: "generation-1", taskId: "task-1", headStateVersion: 3, status: "completed" as const, phase: null, statusMessage: null, error: null, startedAt: "2026-06-10T00:00:00.000Z", finishedAt: "2026-06-10T00:00:01.000Z" },
  },
  commandCalls: [] as Array<{ taskId: string; body: Record<string, unknown> }>,
  settleAcceptPlan: true,
}));

vi.mock("@shared/http", async (importOriginal) => ({
  ...(await importOriginal<typeof SharedHttp>()),
  apiJson: vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (path === "/api/tasks/task-1/plan/generations/active") {
      return { generationSession: null };
    }
    if (path === "/api/tasks/task-1/plan") return structuredClone(mocks.planStateResponse);
    if (path === "/api/tasks/task-1/execution/current") return {};
    if (path === "/api/work/task-1/commands" && method === "POST") {
      const parsedBody: unknown = JSON.parse(String(init?.body ?? "{}"));
      if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
        throw new Error("Expected command request body to be an object");
      }
      const body = parsedBody as Record<string, unknown>;
      mocks.commandCalls.push({ taskId: "task-1", body });
      if (mocks.settleAcceptPlan) {
        mocks.planStateResponse = mocks.acceptedPlanResponse;
      }
      return {
        commandId: "c-1",
        taskId: "task-1",
        acceptedAt: "2026-06-10T00:00:00.000Z",
      };
    }
    throw new Error(`Unhandled API request: ${method} ${path}`);
  }),
  fetchJsonEventSource: vi.fn(async () => undefined),
}));

let initialPageForTest: TaskPageData = taskWorkspaceStateFixtures.idle.pageData;

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.commandCalls = [];
  mocks.settleAcceptPlan = true;
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
    generationSession: { generationId: "generation-1", taskId: "task-1", headStateVersion: 2, status: "completed" as const, phase: null, statusMessage: null, error: null, startedAt: "2026-06-10T00:00:00.000Z", finishedAt: "2026-06-10T00:00:00.000Z" },
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
  it("keeps plan acceptance pending after a 202 until durable state arrives", async () => {
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

    await waitFor(() => expect(result.current.plan.canAcceptPlan).toBe(false));
    expect(result.current.plan.planGenerationStatus).toBe("waiting_acceptance");
    expect(result.current.plan.planFlowStatus).toBe("accepting");
    expect(result.current.plan.pendingCommand).toMatchObject({ commandId: "c-1", status: "pending" });
    expect(mocks.commandCalls[0]?.body).toMatchObject({ type: "plan.accept", planId: "plan-1" });
  });

  it("fails a missed asynchronous acceptance after an SSE reconnect snapshot remains draft", async () => {
    mocks.settleAcceptPlan = false;
    initialPageForTest = taskWorkspaceStateFixtures.idle.pageData;
    const { result, rerender } = renderHook(
      ({ workspaceEvents }) => {
        const workspace = useTaskWorkspacePageState(initialPageForTest);
        const plan = useTaskWorkspacePlanState(
          workspace.pageData.task,
          workspace.refreshWorkspace,
          workspaceEvents,
        );
        return { workspace, plan };
      },
      {
        initialProps: {
          workspaceEvents: [] as Array<{
            type: string;
            sequence: number;
            workBlockId?: string | null;
          }>,
        },
        wrapper,
      },
    );

    await waitFor(() => expect(result.current.plan.planGenerationStatus).toBe("waiting_acceptance"));
    await act(async () => {
      await result.current.plan.acceptPlanById("plan-1");
    });
    expect(result.current.plan.planFlowStatus).toBe("accepting");

    rerender({
      workspaceEvents: [{
        type: "state.snapshot",
        sequence: 999,
        workBlockId: result.current.workspace.pageData.task.currentWorkBlock?.id ?? null,
      }],
    });

    await waitFor(() => {
      expect(result.current.plan.planFlowStatus).toBe("failed");
      expect(result.current.plan.acceptPlanError).toBe(
        "Plan acceptance did not complete. Review and try again.",
      );
    });
  });
});
