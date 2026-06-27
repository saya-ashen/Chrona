import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useTaskWorkspacePlanState } from "../../hooks/use-task-workspace-plan-state";
import { buildCommandCenterNowSpec } from "../../../../../../../../features/execution-monitoring/ui/build-execution-overview-spec";
import { taskWorkspacePlanStateFixtures } from "../../test-support/task-workspace-test-fixtures";
import type { TaskPageData } from "../../../../../../../../features/task-workspace";
import type { TaskWorkspacePlanFlowState } from "../../../../../../../../features/task-workspace";

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
            return {
              ok: true,
              json: async () => ({ commandId: "c-1", taskId: args.param.taskId, acceptedAt: "2026-06-10T00:00:00.000Z" }),
            };
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
  it("shows accepted status after Accept", async () => {
    const initialPage = taskWorkspacePlanStateFixtures.planWaitingAcceptance.pageData as TaskPageData;
    const taskWithoutPagePlan = { ...initialPage.task, savedPlan: null } as TaskPageData["task"];
    const refreshWorkspace = vi.fn(async () => undefined);

    const { result } = renderHook(
      () => useTaskWorkspacePlanState(taskWithoutPagePlan, refreshWorkspace, []),
      { wrapper },
    );

    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.planFlowStatus).toBe("waiting_acceptance");
    expect(result.current.plan?.status).toBe("draft");

    const preSpec = buildCommandCenterNowSpec({
      primaryAction: null,
      readiness: { id: "fallback", title: "fallback", description: "", tone: "info" },
      attention: null,
      runtimeEvents: [],
      copy: {},
      planFlow: derivePlanFlow(result.current.planFlowStatus, result.current.plan),
      planSummary: mocks.planStateResponse.savedPlan?.summary ?? null,
    });
    const preStatusCard = preSpec.elements["status-card"]?.props;
    if (!preStatusCard || typeof preStatusCard !== "object") {
      throw new Error("status-card missing before accept");
    }
    const preProps = preStatusCard as Record<string, unknown>;
    expect(preProps.title).toBe("Plan ready for review");
    expect(preProps.statusLabel).toBe("Waiting for acceptance");
    expect(preProps.tone).toBe("info");
    expect(preProps.icon).toBe("sparkles");

    await act(async () => {
      await result.current.handleAcceptPlan();
    });

    expect(mocks.commandCalls).toHaveLength(1);
    expect(mocks.commandCalls[0]?.body).toMatchObject({ type: "plan.accept", planId: "plan-1" });
    expect(result.current.planFlowStatus).toBe("accepted");

    const postSpec = buildCommandCenterNowSpec({
      primaryAction: null,
      readiness: { id: "fallback", title: "fallback", description: "", tone: "info" },
      attention: null,
      runtimeEvents: [],
      copy: {},
      planFlow: derivePlanFlow(result.current.planFlowStatus, result.current.plan),
      planSummary: mocks.planStateResponse.savedPlan?.summary ?? null,
    });
    const postStatusCard = postSpec.elements["status-card"]?.props;
    if (!postStatusCard || typeof postStatusCard !== "object") {
      throw new Error("status-card missing after accept");
    }
    const postProps = postStatusCard as Record<string, unknown>;
    expect(postProps.title).toBe("Plan accepted");
    expect(postProps.statusLabel).toBe("Accepted");
    expect(postProps.tone).toBe("success");
    expect(postProps.icon).toBe("check");
  });
});