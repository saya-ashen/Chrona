import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { PropsWithChildren } from "react";

import { buildResultSpec } from "@chrona/ui-protocol";

import { createTestQueryClient } from "@/test/fixtures";
import { server } from "@/test/msw/server";
import { useTaskWorkspacePageState } from "../hooks/use-task-workspace-page-state";
import { taskWorkspaceStateFixtures } from "../test-support/task-workspace-test-fixtures";
import type { TaskPageData } from "../model/task-workspace-types";

const emptyCommandCenterDocuments = {
  documents: {
    now: buildResultSpec([], { emptyMessage: "No current operation." }),
    output: buildResultSpec([], { emptyMessage: "No output yet." }),
    trail: buildResultSpec([], { emptyMessage: "No activity yet." }),
  },
};

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function splitWorkspaceHandlers(data: TaskPageData, onPageRequest?: () => void) {
  return [
    http.get("/api/tasks/:taskId", () => {
      onPageRequest?.();
      return HttpResponse.json({ task: data.task, reconciliation: data.reconciliation });
    }),
    http.get("/api/tasks/:taskId/runtime-context", () => HttpResponse.json({
      defaultExecutionRuntime: data.defaultExecutionRuntime,
      executionRuntimes: data.executionRuntimes,
    })),
    http.get("/api/tasks/:taskId/review-context", () => HttpResponse.json({
      latestRunSummary: data.latestRunSummary,
      scheduleProposals: data.scheduleProposals,
      approvals: data.approvals,
    })),
    http.get("/api/tasks/:taskId/command-center", () => HttpResponse.json(
      data.commandCenter ?? emptyCommandCenterDocuments,
    )),
    http.get("/api/tasks/:taskId/workspace/header", () => HttpResponse.json(
      data.header ?? { spec: { root: "root", elements: { root: { type: "Card", props: {}, children: [] } } } },
    )),
  ];
}

describe("Task workspace MSW integration", () => {
  it("refreshes task workspace data after workspace update events", async () => {
    const initialData = taskWorkspaceStateFixtures.running.pageData;
    let pageRequests = 0;
    const refreshedData: TaskPageData = {
      ...initialData,
      task: {
        ...initialData.task,
        title: "Workspace refreshed by MSW",
        status: "Blocked",
        blockReason: {
          blockType: "provider_unavailable",
          actionRequired: "retry_after_provider_fix",
          scope: "provider",
        },
      },
      latestRunSummary: {
        id: "run-msw-refresh",
        status: "Blocked",
        startedAt: "2026-06-01T09:00:00.000Z",
        syncStatus: "fresh",
      },
    };

    server.use(
      http.get("/api/work/:taskId/events", () => new Response([
        "event: ready",
        "data: {}",
        "",
        "event: task_workspace_updated",
        "data: {\"sequence\":2,\"eventKind\":\"task.updated\"}",
        "",
      ].join("\n"), {
        headers: { "Content-Type": "text/event-stream" },
      })),
      ...splitWorkspaceHandlers(refreshedData, () => {
        pageRequests += 1;
      }),
    );

    const { result } = renderHook(() => useTaskWorkspacePageState(initialData), { wrapper });

    await waitFor(() => expect(result.current.pageData.task.title).toBe("Workspace refreshed by MSW"));
    expect(result.current.pageData.task.blockReason?.actionRequired).toBe("retry_after_provider_fix");
    expect(pageRequests).toBeGreaterThan(0);
  });

  it("retains initial workspace state when refresh endpoint returns an error", async () => {
    const initialData = taskWorkspaceStateFixtures.staleError.pageData;
    let pageRequests = 0;

    server.use(
      http.get("/api/work/:taskId/events", () => new Response([
        "event: task_workspace_updated",
        "data: {\"sequence\":7,\"eventKind\":\"execution.state.updated\"}",
        "",
      ].join("\n"), {
        headers: { "Content-Type": "text/event-stream" },
      })),
      http.get("/api/tasks/:taskId", () => {
        pageRequests += 1;
        return HttpResponse.json({ error: "Workspace temporarily unavailable" }, { status: 503 });
      }),
      http.get("/api/tasks/:taskId/runtime-context", () => HttpResponse.json({})),
      http.get("/api/tasks/:taskId/review-context", () => HttpResponse.json({})),
      http.get("/api/tasks/:taskId/command-center", () => HttpResponse.json({})),
    );

    const { result } = renderHook(() => useTaskWorkspacePageState(initialData), { wrapper });

    await waitFor(() => expect(pageRequests).toBeGreaterThan(0));
    expect(result.current.pageData.task.title).toBe(initialData.task.title);
    expect(result.current.pageData.task.blockReason?.actionRequired).toBe(initialData.task.blockReason?.actionRequired);
  });
});
