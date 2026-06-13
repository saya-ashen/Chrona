/**
 * Spec 019 — Workspace rerender after accept (test F).
 *
 * Verifies the end-to-end rerender contract: when a user accepts a plan,
 * the workspace page re-derives its "Current operation" `WorkspaceSummaryCard`
 * from the post-accept `TaskWorkspacePlanFlowState` ("accepted" variant) on
 * the very next render.
 *
 * Approach: drive the real `useTaskWorkspacePlanState` via a stubbed
 * `global.fetch` (matching the pattern in the page-state tests — the hook
 * calls `fetchTaskPlanState` and `dispatchWorkspaceCommand`, both of which
 * route through `fetch` or `@/lib/rpc-client` respectively). After the hook
 * resolves `acceptPlanById`, recompute the command-center "Now" spec via
 * `buildCommandCenterNowSpec` exactly the way `<TaskWorkspacePage>` does.
 * Assert the `status-card` props flip from the waiting_acceptance variant
 * to the accepted variant — proving the page rerender contract.
 *
 * Plan: specs/019-plan-card-and-accept-tests/plan.md §3 (test F).
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useTaskWorkspacePlanState } from "../../hooks/use-task-workspace-plan-state";
import { buildCommandCenterNowSpec } from "../../execution/build-execution-overview-spec";
import { taskWorkspacePlanStateFixtures } from "../../test-support/task-workspace-test-fixtures";
import type { TaskPageData } from "../../model/task-workspace-types";
import type { TaskWorkspacePlanFlowState } from "../../model/task-workspace-plan-flow-machine";

const mocks = vi.hoisted(() => ({
  planStateResponse: {
    taskId: "task-1",
    aiPlanGenerationStatus: "waiting_acceptance" as "idle" | "generating" | "waiting_acceptance" | "accepted",
    savedPlan: {
      id: "plan-1",
      status: "draft" as "draft" | "accepted",
      revision: 1,
      summary: "Research X, draft Y, deliver Z.",
      prompt: null,
      blueprint: null,
      generatedBy: null,
      generatedAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:00.000Z",
    },
    generationSession: null,
  },
  commandCalls: [] as Array<{ taskId: string; body: Record<string, unknown> }>,
  currentExecution: {} as Record<string, unknown>,
}));

vi.mock("@/lib/rpc-client", () => ({
  api: {
    work: {
      ":taskId": {
        commands: {
          $post: vi.fn(async (args: { param: { taskId: string }; json: Record<string, unknown> }) => {
            mocks.commandCalls.push({ taskId: args.param.taskId, body: args.json });
            if (args.json && (args.json as { type?: string }).type === "plan.accept" && mocks.planStateResponse.savedPlan) {
              mocks.planStateResponse.aiPlanGenerationStatus = "accepted";
              mocks.planStateResponse.savedPlan.status = "accepted";
            }
            return { ok: true, json: async () => ({ commandId: "c-1", taskId: args.param.taskId, acceptedAt: "2026-06-10T00:00:00.000Z" }) };
          }),
        },
      },
    },
  },
}));

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method;
  if (url.includes("/plan/generations/active")) {
    return new Response(JSON.stringify({ generationSession: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.match(/\/api\/tasks\/[^/]+\/plan(\?|$)/)) {
    return new Response(JSON.stringify(mocks.planStateResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.match(/\/api\/tasks\/[^/]+\/execution\/current(\?|$)/)) {
    return new Response(JSON.stringify(mocks.currentExecution), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (method === "POST" || method === "DELETE") {
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
});
vi.stubGlobal("fetch", fetchMock);

function derivePlanFlow(planFlowStatus: string, plan: { id: string; status: string } | null): TaskWorkspacePlanFlowState | null {
  const savedPlan = plan as unknown as import("@chrona/contracts/ai").TaskPlanReadModel | null;
  switch (planFlowStatus) {
    case "idle":
      return { status: "idle", savedPlan: null };
    case "generating":
      return { status: "generating", savedPlan: null };
    case "waiting_acceptance":
      return { status: "waiting_acceptance", savedPlan };
    case "accepting":
      return { status: "accepting", planId: plan?.id ?? "unknown", savedPlan };
    case "accepted":
      return { status: "accepted", savedPlan };
    default:
      return null;
  }
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.commandCalls = [];
  mocks.currentExecution = {};
  mocks.planStateResponse = {
    taskId: "task-1",
    aiPlanGenerationStatus: "waiting_acceptance",
    savedPlan: {
      id: "plan-1",
      status: "draft",
      revision: 1,
      summary: "Research X, draft Y, deliver Z.",
      prompt: null,
      blueprint: null,
      generatedBy: null,
      generatedAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:00.000Z",
    },
    generationSession: null,
  };
});

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

describe("F. Workspace rerender after accept", () => {
  it("re-derives the 'Current operation' card from waiting_acceptance → accepted after Accept", async () => {
    const initialPage = taskWorkspacePlanStateFixtures.planWaitingAcceptance.pageData as TaskPageData;
    // Strip `task.savedPlan` so the hook's reconciliation pipeline relies
    // on the plan-state query alone (the page query's snapshot is not
    // mutated by the server on accept).
    const taskWithoutPagePlan = { ...initialPage.task, savedPlan: null } as TaskPageData["task"];
    const refreshWorkspace = vi.fn(async () => undefined);

    const { result } = renderHook(
      () => useTaskWorkspacePlanState(taskWithoutPagePlan, refreshWorkspace, []),
      { wrapper },
    );

    // Let the plan-state query fetch resolve so the hook sees the
    // `waiting_acceptance` snapshot from the (mocked) server.
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    // Pre-accept: hook reports waiting_acceptance + draft plan.
    expect(result.current.planFlowStatus).toBe("waiting_acceptance");
    expect(result.current.plan?.status).toBe("draft");

    // Compute the command-center spec the way the page does.
    const preSpec = buildCommandCenterNowSpec({
      primaryAction: null,
      readiness: { id: "fallback", title: "fallback", description: "", tone: "info" },
      attention: null,
      runtimeEvents: [],
      copy: {},
      planFlow: derivePlanFlow(result.current.planFlowStatus, result.current.plan),
      planSummary: mocks.planStateResponse.savedPlan?.summary ?? null,
    });
    const preStatusCard = (preSpec.elements["status-card"]?.props ?? {}) as {
      title?: string;
      statusLabel?: string;
      tone?: string;
      icon?: string;
    };
    expect(preStatusCard.title).toBe("Plan ready for review");
    expect(preStatusCard.statusLabel).toBe("Waiting for acceptance");
    expect(preStatusCard.tone).toBe("info");
    expect(preStatusCard.icon).toBe("sparkles");

    // Fire Accept.
    await act(async () => {
      await result.current.handleAcceptPlan();
    });

    // Dispatch fired once with the right body.
    expect(mocks.commandCalls).toHaveLength(1);
    expect(mocks.commandCalls[0]?.body).toMatchObject({ type: "plan.accept", planId: "plan-1" });

    // Post-accept: the hook's `planFlowStatus` MUST land on "accepted"
    // so the page-level `buildCommandCenterNowSpec` rerender produces
    // the accepted-variant `status-card`.
    expect(result.current.planFlowStatus).toBe("accepted");

    // Recompute the spec with the post-accept flow.
    const postSpec = buildCommandCenterNowSpec({
      primaryAction: null,
      readiness: { id: "fallback", title: "fallback", description: "", tone: "info" },
      attention: null,
      runtimeEvents: [],
      copy: {},
      planFlow: derivePlanFlow(result.current.planFlowStatus, result.current.plan),
      planSummary: mocks.planStateResponse.savedPlan?.summary ?? null,
    });
    const postStatusCard = (postSpec.elements["status-card"]?.props ?? {}) as {
      title?: string;
      statusLabel?: string;
      tone?: string;
      icon?: string;
    };
    expect(postStatusCard.title).toBe("Plan accepted");
    expect(postStatusCard.statusLabel).toBe("Accepted");
    expect(postStatusCard.tone).toBe("success");
    expect(postStatusCard.icon).toBe("check");
  });
});