import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { useTaskWorkspacePageState, type TaskWorkspaceSseEvent } from "./use-task-workspace-page-state";
import { taskWorkspaceStateFixtures } from "../../../../../../../features/task-workspace/test-support/task-workspace-test-fixtures";
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
  // Toggle to control which events the mock would push; tests still drive
  // the handler directly so this is only used for sanity assertions.
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
        $get: vi.fn(async () => ({
          ok: true,
          json: async () => initialPageForTest,
        })),
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

// `vi.mock` factory closes over module-scope bindings; pull initial data from
// a hoisted-safe value so the rpc mock above can return a real TaskPageData.
let initialPageForTest: TaskPageData = taskWorkspaceStateFixtures.idle.pageData;

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

afterEach(() => {
  mocks.eventHandler = null;
  mocks.streamOpened = false;
});

describe("useTaskWorkspacePageState — spec.patch dispatch (regression for plan generation button)", () => {
  it("applies a header spec.patch from the workspace event stream to headerSpec", async () => {
    initialPageForTest = taskWorkspaceStateFixtures.idle.pageData;
    const { result } = renderHook(() => useTaskWorkspacePageState(initialPageForTest), { wrapper });

    await waitFor(() => expect(mocks.streamOpened).toBe(true));
    const beforeSpec = result.current.headerSpec;
    expect(
      (beforeSpec.elements["action:generate-plan"]?.props as { disabled?: unknown } | undefined)?.disabled,
    ).toEqual({ $state: "/plan/generation/header-action-disabled" });

    const patch: TaskWorkspaceSseEvent = {
      type: "spec.patch",
      document: "header",
      patches: [
        { op: "replace", path: "/elements/action:generate-plan/props/label", value: "Generate plan..." },
        { op: "replace", path: "/elements/action:generate-plan/props/disabled", value: true },
      ],
    };

    await act(async () => {
      pushEvent("spec.patch", patch as unknown as Record<string, unknown>);
    });

    await waitFor(() => {
      const props = result.current.headerSpec.elements["action:generate-plan"]?.props as
        | { label?: string; disabled?: boolean }
        | undefined;
      expect(props?.disabled).toBe(true);
      expect(props?.label).toBe("Generate plan...");
    });
    expect(result.current.headerSpec).not.toBe(beforeSpec);
  });

  it("applies a reset spec.patch (label='Generate plan', disabled removed) to headerSpec", async () => {
    initialPageForTest = taskWorkspaceStateFixtures.idle.pageData;
    const { result } = renderHook(() => useTaskWorkspacePageState(initialPageForTest), { wrapper });

    await waitFor(() => expect(mocks.streamOpened).toBe(true));

    // First, simulate the disable patch that the server emits when plan.generate
    // is accepted.
    await act(async () => {
      pushEvent("spec.patch", {
        type: "spec.patch",
        document: "header",
        patches: [
          { op: "replace", path: "/elements/action:generate-plan/props/label", value: "Generate plan..." },
          { op: "replace", path: "/elements/action:generate-plan/props/disabled", value: true },
        ],
      });
    });
    await waitFor(() => {
      const props = result.current.headerSpec.elements["action:generate-plan"]?.props as
        | { label?: string; disabled?: boolean }
        | undefined;
      expect(props?.disabled).toBe(true);
    });

    // Then, simulate the reset patch (the one the server currently omits on success).
    await act(async () => {
      pushEvent("spec.patch", {
        type: "spec.patch",
        document: "header",
        patches: [
          { op: "replace", path: "/elements/action:generate-plan/props/label", value: "Generate plan" },
          { op: "remove", path: "/elements/action:generate-plan/props/disabled" },
        ],
      });
    });

    await waitFor(() => {
      const props = result.current.headerSpec.elements["action:generate-plan"]?.props as
        | { label?: string; disabled?: boolean }
        | undefined;
      expect(props?.label).toBe("Generate plan");
      expect(props?.disabled).toBeUndefined();
    });
  });
});
