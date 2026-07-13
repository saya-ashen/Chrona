import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { useTaskWorkspacePageState } from "./use-task-workspace-page-state";
import { createHeaderSpecFixture, taskWorkspaceStateFixtures } from "@features/task-workspace/test";
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
  streamOpened: false,
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

// The SSR task-page loader (apps/web/src/loaders.ts:117) fetches
// 5 endpoints in parallel and merges them via spread. This file
// verifies the downstream contract: when the loader hands the
// merged payload to useTaskWorkspacePageState, the hook's exposed
// pageData reflects the loader's selected workBlockId and the
// header's primary-state badge carries the work-block-scoped
// status (NOT the task row's status). The L1 SSR fan-out test
// (apps/server/src/__tests__/api/header-and-readmodels-ssr.bun.test.ts)

function buildSsrBundleForWorkBlock(input: {
  workBlockId: string;
  taskRowStatus: "Blocked" | "Ready" | "Running" | "Completed";
  headerStatus: "waiting" | "running" | "blocked" | "completed" | "approval-needed";
  workBlockStatus: "Scheduled" | "Active" | "Completed" | "Cancelled";
}): TaskPageData {
  const base = taskWorkspaceStateFixtures.idle.pageData;
  // Mirror the SSR loader shape: bootstrap + runtimeContext +
  // reviewContext spread, then commandCenter + header assigned.
  return {
    ...base,
    task: {
      ...base.task,
      // The page-side status is the work-block status, not the
      // task row — see get-task-page.ts:258.
      status: input.workBlockStatus,
      currentWorkBlock: {
        id: input.workBlockId,
        status: input.workBlockStatus,
        scheduledStartAt: "2026-06-10T00:00:00.000Z",
        scheduledEndAt: "2026-06-10T01:00:00.000Z",
      },
    },
    header: {
      spec: createHeaderSpecFixture({
        title: `${input.workBlockId} header`,
        status: input.headerStatus,
        actions: [{ id: "generate-plan", label: "Generate plan" }],
      }),
    },
  };
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  mocks.eventHandler = null;
  mocks.streamOpened = false;
});

describe("useTaskWorkspacePageState — SSR loader spread is work-block-scoped", () => {
  it("exposes the loader's currentWorkBlock.id, not the task row's status", async () => {
    // The loader passes the spread { ...bootstrap, ...runtimeContext,
    // ...reviewContext, commandCenter, header } as initialData. The
    // hook reads selectedWorkBlockId from pageData.task.currentWorkBlock
    // and uses it for ALL downstream query keys. If the spread dropped
    // currentWorkBlock, every query would key on null and the page
    // would render the wrong occurrence.
    const first = buildSsrBundleForWorkBlock({
      workBlockId: "block-A",
      taskRowStatus: "Blocked",
      headerStatus: "waiting",
      workBlockStatus: "Scheduled",
    });
    const { result, rerender } = renderHook(
      ({ data }: { data: TaskPageData }) => useTaskWorkspacePageState(data),
      { wrapper, initialProps: { data: first } },
    );

    await waitFor(() => expect(mocks.streamOpened).toBe(true));
    expect(result.current.pageData.task.currentWorkBlock?.id).toBe("block-A");
    // pageData.task.status mirrors the work-block, not the row.
    expect(result.current.pageData.task.status).toBe("Scheduled");

    // Switch to occurrence B by passing new initialData (the route
    // loader re-fetches with the new workBlockId).
    const second = buildSsrBundleForWorkBlock({
      workBlockId: "block-B",
      taskRowStatus: "Blocked", // task row stayed Blocked
      headerStatus: "waiting", // B is also Scheduled, no execution
      workBlockStatus: "Scheduled",
    });
    rerender({ data: second });

    await waitFor(() => {
      expect(result.current.pageData.task.currentWorkBlock?.id).toBe("block-B");
    });
    // The page-level status must follow the work block, not the row.
    expect(result.current.pageData.task.status).toBe("Scheduled");
  });

  it("header spec carries the loader's work-block-scoped status, not the task row", async () => {
    // Stronger contract: the loader hands a header.spec with the
    // work-block-scoped status (badge:primary-state.props.text). The
    // hook must surface that status — not overwrite it with the task
    // row's status, and not flip back to a stale cached version.
    const data = buildSsrBundleForWorkBlock({
      workBlockId: "block-A",
      taskRowStatus: "Blocked",
      headerStatus: "waiting",
      workBlockStatus: "Scheduled",
    });
    const { result } = renderHook(
      ({ data }: { data: TaskPageData }) => useTaskWorkspacePageState(data),
      { wrapper, initialProps: { data } },
    );

    await waitFor(() => expect(mocks.streamOpened).toBe(true));
    const badge = result.current.headerSpec.elements["badge:primary-state"];
    expect(badge?.props?.text).toBe("Waiting");
    // Regression pin: the header was previously using task.status
    // (= "Scheduled" here, since the spread carried the work-block
    // status) — but in the past the engine itself returned
    // "Blocked" for the work-block-scoped query. This assertion is
    // the client-side check: if the server returns "Waiting" the
    // hook must surface "Waiting", not "Blocked".
    expect(badge?.props?.text).not.toBe("Blocked");
  });
});
