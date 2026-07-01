import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { useTaskWorkspacePageState } from "./use-task-workspace-page-state";
import { createHeaderSpecFixture, taskWorkspaceStateFixtures } from "../test-support/task-workspace-test-fixtures";
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

function buildPageData(workBlockId: string, headerTitle: string): TaskPageData {
  const base = taskWorkspaceStateFixtures.idle.pageData;
  return {
    ...base,
    task: {
      ...base.task,
      currentWorkBlock: {
        id: workBlockId,
        status: "Scheduled",
        scheduledStartAt: "2026-06-10T00:00:00.000Z",
        scheduledEndAt: "2026-06-10T01:00:00.000Z",
      },
    },
    header: {
      spec: createHeaderSpecFixture({
        title: headerTitle,
        status: "waiting",
        actions: [{ id: "generate-plan", label: "Generate plan" }, { id: "edit", label: "Edit" }, { id: "delete", label: "Delete Task" }],
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

describe("useTaskWorkspacePageState — occurrence switch resets header", () => {
  it("replaces the header spec when initialData switches to a different work block", async () => {
    const first = buildPageData("block-A", "First occurrence");
    const { result, rerender } = renderHook(
      ({ data }: { data: TaskPageData }) => useTaskWorkspacePageState(data),
      { wrapper, initialProps: { data: first } },
    );

    await waitFor(() => expect(mocks.streamOpened).toBe(true));
    expect(result.current.headerSpec.elements["action:generate-plan"]).toBeDefined();

    // Apply a SSE spec.patch on the first occurrence to mark the generate-plan
    // button as disabled, mirroring what the server emits when the user
    // requests plan generation.
    await act(async () => {
      mocks.eventHandler!({
        event: "spec.patch",
        data: {
          type: "spec.patch",
          document: "header",
          patches: [
            { op: "replace", path: "/elements/action:generate-plan/props/disabled", value: true },
            { op: "replace", path: "/elements/action:generate-plan/props/label", value: "Generating plan..." },
          ],
        } as unknown as Record<string, unknown>,
        message: { data: "{}", event: "spec.patch" } as unknown,
      });
    });
    await waitFor(() => {
      const props = result.current.headerSpec.elements["action:generate-plan"]?.props as
        | { disabled?: boolean; label?: string }
        | undefined;
      expect(props?.disabled).toBe(true);
    });

    // Switch to a different work block by passing new initialData. The route
    // loader re-runs and provides a fresh header payload.
    const second = buildPageData("block-B", "Second occurrence");
    rerender({ data: second });

    // The header spec should be the new occurrence's spec, not the patched
    // first-occurrence spec.
    await waitFor(() => {
      const props = result.current.headerSpec.elements["action:generate-plan"]?.props as
        | { disabled?: unknown; label?: string }
        | undefined;
      expect(props?.disabled).toEqual({ $state: "/plan/generation/header-action-disabled" });
      expect(props?.label).toBe("Generate plan");
    });
    expect(result.current.pageData.task.currentWorkBlock?.id).toBe("block-B");
  });

  it("clears the header state store when initialData switches to a different work block", async () => {
    const first = buildPageData("block-A", "First occurrence");
    const { result, rerender } = renderHook(
      ({ data }: { data: TaskPageData }) => useTaskWorkspacePageState(data),
      { wrapper, initialProps: { data: first } },
    );

    await waitFor(() => expect(mocks.streamOpened).toBe(true));

    // Drive a state.update SSE so the store gains pointer-paths.
    await act(async () => {
      mocks.eventHandler!({
        event: "state.update",
        data: {
          type: "state.update",
          updates: { "/plan/generation/phase": "connecting", "/plan/generation/error/message": "boom" },
        } as unknown as Record<string, unknown>,
        message: { data: "{}", event: "state.update" } as unknown,
      });
    });
    await waitFor(() => {
      expect(result.current.headerStore.getSnapshot()).toMatchObject({
        plan: { generation: { phase: "connecting" } },
      });
    });

    const second = buildPageData("block-B", "Second occurrence");
    rerender({ data: second });

    // The store should be reset to an empty snapshot so the new occurrence's
    // header does not pick up the prior occurrence's plan generation
    // session state.
    await waitFor(() => {
      const snapshot = result.current.headerStore.getSnapshot() as Record<string, unknown>;
      expect(Object.keys(snapshot)).toEqual([]);
    });
  });

  it("does not reset when initialData is re-rendered with the same work block", async () => {
    const first = buildPageData("block-A", "First occurrence");
    const { result, rerender } = renderHook(
      ({ data }: { data: TaskPageData }) => useTaskWorkspacePageState(data),
      { wrapper, initialProps: { data: first } },
    );

    await waitFor(() => expect(mocks.streamOpened).toBe(true));

    await act(async () => {
      mocks.eventHandler!({
        event: "state.update",
        data: {
          type: "state.update",
          updates: { "/plan/generation/phase": "connecting" },
        } as unknown as Record<string, unknown>,
        message: { data: "{}", event: "state.update" } as unknown,
      });
    });
    const before = result.current.headerStore.getSnapshot();

    // Same work block, new initialData reference. The store must be retained
    // so an unrelated refetch (e.g. a workspace event refresh) does not
    // wipe locally-built header state.
    const refetched: TaskPageData = { ...first, reconciliation: null };
    rerender({ data: refetched });

    expect(result.current.headerStore.getSnapshot()).toBe(before);
  });
});
