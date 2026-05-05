import type { ElementType, ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

vi.mock("@/i18n/routing", () => ({
  localizeHref: (_locale: string, href: string) => href,
}));

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/router", () => ({
  useAppRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  AppLink: ({ to, children, ...props }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));


vi.mock("@/components/ui/button", () => ({ buttonVariants: () => "btn" }));


vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children, tone }: { children?: React.ReactNode; tone?: string }) => (
    <span data-tone={tone}>{children}</span>
  ),
}));


vi.mock("@/components/ui/surface-card", () => ({
  SurfaceCard: ({ children, as: Component = "div", ...props }: { children?: ReactNode; as?: ElementType }) => (
    <Component {...props}>{children}</Component>
  ),
  SurfaceCardHeader: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  SurfaceCardTitle: ({ children, ...props }: { children?: ReactNode }) => <h3 {...props}>{children}</h3>,
}));

// Mock the schedule editor form
vi.mock("@/components/schedule/schedule-editor-form", () => ({
  ScheduleEditorForm: () => <div data-testid="schedule-editor-form" />,
}));

const taskConfigSubmitHandlers: Array<(input: unknown) => Promise<void> | void> = [];
const taskConfigDraftStateHandlers: Array<(state: unknown) => void> = [];

// Mock the task config form
vi.mock("@/components/schedule/task-config-form", () => ({
  TaskConfigForm: ({
    onSubmitAction,
    onDraftStateChange,
  }: {
    onSubmitAction: (input: unknown) => Promise<void> | void;
    onDraftStateChange?: (state: unknown) => void;
  }) => {
    taskConfigSubmitHandlers.push(onSubmitAction);
    if (onDraftStateChange) {
      taskConfigDraftStateHandlers.push(onDraftStateChange);
    }
    return <div data-testid="task-config-form" />;
  },
}));

const taskDecompositionPanelProps = vi.fn();



vi.mock("@/components/schedule/panels/selected-block-sheet/selected-block-main-column", () => ({
  SelectedBlockMainColumn: ({ onTaskConfigDraftStateChange, onSaveTaskConfig }: { onTaskConfigDraftStateChange: (state: unknown) => void; onSaveTaskConfig: (input: unknown) => Promise<void> | void }) => {
    taskConfigDraftStateHandlers.push(onTaskConfigDraftStateChange);
    taskConfigSubmitHandlers.push(onSaveTaskConfig);
    return (
      <div data-testid="selected-block-main-column">
        <div data-testid="schedule-editor-form" />
        <div data-testid="task-config-form" />
      </div>
    );
  },
}));

vi.mock("@/components/schedule/panels/selected-block-sheet/selected-block-sheet-header", () => ({
  SelectedBlockSheetHeader: ({ item }: { item: { title: string } }) => (
    <div data-testid="selected-block-sheet-header"><h2 id="schedule-task-sheet-title">{item.title}</h2></div>
  ),
}));

// Mock the task decomposition panel
vi.mock("@/components/schedule/task-planning-panel", () => ({
  TaskDecompositionPanel: (props: {
    activeAcceptedPlanId?: string | null;
    title?: string;
    description?: string | null;
    priority?: string;
    dueAt?: Date | null;
  }) => {
    taskDecompositionPanelProps(props);
    return (
      <div
        data-testid="task-decomposition-panel"
        data-active-accepted-plan-id={props.activeAcceptedPlanId ?? ""}
        data-title={props.title ?? ""}
        data-description={props.description ?? ""}
        data-draft-dirty={String(Boolean((props as { hasUnsavedConfigChanges?: boolean }).hasUnsavedConfigChanges))}
        data-saved-plan-id={(props as { savedPlan?: { id?: string } | null }).savedPlan?.id ?? ""}
        data-generation-status={(props as { generationStatus?: string }).generationStatus ?? ""}
      />
    );
  },
}));

// Mock the task context links
vi.mock("@/components/ui/task-context-links", () => ({
  TaskContextLinks: () => <div data-testid="task-context-links" />,
}));

// Mock fetch for subtasks
const mockFetch = vi.fn();

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: (...args: Parameters<typeof fetch>) => mockFetch(...args),
});

function createJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

import { SelectedBlockSheet } from "@/components/schedule/schedule-page-panels";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const mockItem: ScheduledItem = {
  taskId: "task-1",
  workspaceId: "ws-1",
  title: "Test task",
  description: "A description",
  priority: "Medium",
  ownerType: "human",
  assigneeAgentId: null,
  persistedStatus: "Ready",
  displayState: null,
  actionRequired: null,
  approvalPendingCount: 0,
  scheduleStatus: "Scheduled",
  scheduleSource: "human",
  dueAt: new Date(2026, 3, 20),
  scheduledStartAt: new Date(2026, 3, 15, 9, 0),
  scheduledEndAt: new Date(2026, 3, 15, 10, 0),
  latestRunStatus: null,
  scheduleProposalCount: 0,
  lastActivityAt: null,
  runtimeAdapterKey: "openclaw",
  runtimeInput: {},
  runtimeInputVersion: "openclaw-v1",
  runtimeModel: null,
  prompt: null,
  runtimeConfig: null,
  isRunnable: true,
  runnabilityState: "ready",
  runnabilitySummary: "Ready",
  parentTaskId: null,
};

const defaultSheetProps = {
  item: mockItem,
  selectedDay: "2026-04-15",
  runtimeAdapters: [
    {
      key: "openclaw",
      label: "OpenClaw",
      spec: {
        adapterKey: "openclaw",
        version: "openclaw-v1",
        fields: [],
        runnability: { requiredPaths: [] },
      },
    },
  ],
  defaultRuntimeAdapterKey: "openclaw",
  isPending: false,
  onClose: vi.fn(),
  onSaveTaskConfigAction: vi.fn(),
  onMutatedAction: vi.fn(),
  buildScheduleHref: (day: string, taskId?: string) =>
    taskId ? `/schedule/${day}/${taskId}` : `/schedule/${day}`,
};

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url.includes("/api/tasks/") && url.includes("/plan-state")) {
      return Promise.resolve(createJsonResponse({
        taskId: "task-1",
        aiPlanGenerationStatus: "idle",
        savedAiPlan: null,
      }));
    }

    if (url.includes("/api/ai/task-plan/accept")) {
      return Promise.resolve(createJsonResponse({ ok: true }));
    }

    return Promise.resolve(createJsonResponse([]));
  });
});

afterEach(() => {
  cleanup();
  taskConfigSubmitHandlers.length = 0;
  taskConfigDraftStateHandlers.length = 0;
  vi.clearAllMocks();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("SelectedBlockSheet – layout order", () => {
  it("renders the title", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByText("Test task")).toBeInTheDocument();
  });

  it("renders schedule editor form (time adjustment)", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("schedule-editor-form")).toBeInTheDocument();
  });

  it("renders task config form", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("task-config-form")).toBeInTheDocument();
  });

  it("renders the task decomposition sidebar", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("task-decomposition-panel")).toBeInTheDocument();
  });

  it("renders task context links", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("task-context-links")).toBeInTheDocument();
  });

  it("renders a dedicated AI sidebar for the popup", () => {
    const { container } = render(<SelectedBlockSheet {...defaultSheetProps} />);

    const mainColumn = container.querySelector("[data-testid='selected-block-main-column']");
    const aiSidebar = container.querySelector("[data-testid='selected-block-ai-sidebar']");

    expect(mainColumn).toBeTruthy();
    expect(aiSidebar).toBeTruthy();
    expect(aiSidebar).toContainElement(screen.getByTestId("task-decomposition-panel"));
    expect(aiSidebar).toContainElement(screen.getByTestId("task-context-links"));
  });

  it("keeps schedule editing and task config merged in the main popup column while planning lives in the sidebar", () => {
    const { container } = render(<SelectedBlockSheet {...defaultSheetProps} />);

    const mainColumn = container.querySelector("[data-testid='selected-block-main-column']");
    const aiSidebar = container.querySelector("[data-testid='selected-block-ai-sidebar']");

    expect(mainColumn).toContainElement(screen.getByTestId("schedule-editor-form"));
    expect(mainColumn).toContainElement(screen.getByTestId("task-config-form"));
    expect(aiSidebar).toContainElement(screen.getByTestId("task-decomposition-panel"));
    expect(aiSidebar).toContainElement(screen.getByTestId("task-context-links"));
  });

  it("passes no accepted plan id into the sidebar before apply", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-active-accepted-plan-id", "");
  });

  it("has a dialog with proper aria attributes", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("does not repeatedly push identical clean draft state back into the parent", async () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    const notifyDraftState = taskConfigDraftStateHandlers.at(-1);
    expect(notifyDraftState).toBeTypeOf("function");

    const cleanState = {
      isDirty: false,
      values: {
        title: "Test task",
        description: "Task description",
        priority: "Medium",
        dueAt: new Date(2026, 3, 15, 11, 0),
      },
    };

    await act(async () => {
      notifyDraftState?.(cleanState);
    });
    const callCountAfterFirstCleanState = taskDecompositionPanelProps.mock.calls.length;

    await act(async () => {
      notifyDraftState?.(cleanState);
    });

    expect(taskDecompositionPanelProps.mock.calls.length).toBe(callCountAfterFirstCleanState);
  });

  it("marks the AI planning sidebar dirty when task config has unsaved edits", async () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    const notifyDraftState = taskConfigDraftStateHandlers.at(-1);
    expect(notifyDraftState).toBeTypeOf("function");

    await act(async () => {
      notifyDraftState?.({
        isDirty: true,
        values: {
          title: "Unsaved draft title",
          description: "Unsaved draft description",
          priority: "Urgent",
          dueAt: new Date(2026, 3, 21, 13, 0),
        },
      });
    });

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-draft-dirty", "true");
    expect(taskDecompositionPanelProps).toHaveBeenLastCalledWith(expect.objectContaining({
      hasUnsavedConfigChanges: true,
      unsavedConfigDraft: expect.objectContaining({
        title: "Unsaved draft title",
        description: "Unsaved draft description",
        priority: "Urgent",
      }),
    }));
  });

  it("updates the AI sidebar immediately when a regenerated draft plan is loaded", async () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "idle");

    const latestPanelProps = taskDecompositionPanelProps.mock.calls.at(-1)?.[0] as {
      onPlanLoaded?: (savedPlan: unknown) => void;
    };
    expect(latestPanelProps.onPlanLoaded).toBeTypeOf("function");

    await act(async () => {
      latestPanelProps.onPlanLoaded?.({
        id: "plan-new",
        status: "draft",
        prompt: null,
        revision: 3,
        summary: "new generated plan",
        updatedAt: "2026-04-25T12:00:00.000Z",
        plan: {
          id: "plan-new",
          taskId: "task-1",
          status: "draft",
          revision: 3,
          source: "ai",
          generatedBy: "generate-task-plan",
          prompt: null,
          summary: "new generated plan",
          changeSummary: null,
          createdAt: "2026-04-25T12:00:00.000Z",
          updatedAt: "2026-04-25T12:00:00.000Z",
          nodes: [],
          edges: [],
        },
      });
    });

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "plan-new");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "waiting_acceptance");
  });


  it("syncs the sidebar status and plan when the selected task prop changes", async () => {
    const { rerender } = render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "");

    rerender(<SelectedBlockSheet {...defaultSheetProps} item={{ ...mockItem, aiPlanGenerationStatus: "generating" }} />);
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "generating");

    const itemWithNewPlan: ScheduledItem = {
      ...mockItem,
      aiPlanGenerationStatus: "waiting_acceptance",
      savedAiPlan: {
        id: "plan-from-parent",
        status: "draft",
        prompt: null,
        revision: 4,
        summary: "parent refreshed plan",
        updatedAt: "2026-04-25T13:00:00.000Z",
        plan: {
          id: "plan-from-parent",
          editablePlanId: "editable-plan-1",
          sourceVersion: 4,
          title: "parent refreshed plan",
          goal: "parent refreshed plan",
          assumptions: [],
          nodes: [],
          edges: [],
          entryNodeIds: [],
          terminalNodeIds: [],
          topologicalOrder: [],
          completionPolicy: { type: "all_tasks_completed" as const },
          validationWarnings: [],
        },
      },
    };

    rerender(<SelectedBlockSheet {...defaultSheetProps} item={itemWithNewPlan} />);

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "plan-from-parent");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "waiting_acceptance");
  });

  it("polls the lightweight task plan-state endpoint instead of refreshing schedule projection while generation runs", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes("/api/tasks/task-1/plan-state")) {
        return Promise.resolve(createJsonResponse({
          taskId: "task-1",
          aiPlanGenerationStatus: "waiting_acceptance",
          savedAiPlan: {
            id: "plan-polled",
            status: "draft",
            prompt: null,
            revision: 5,
            summary: "polled draft",
            updatedAt: "2026-04-25T14:45:00.000Z",
            plan: {
              id: "plan-polled",
              taskId: "task-1",
              status: "draft",
              revision: 5,
              source: "ai",
              generatedBy: "generate-task-plan",
              prompt: null,
              summary: "polled draft",
              changeSummary: null,
              createdAt: "2026-04-25T14:45:00.000Z",
              updatedAt: "2026-04-25T14:45:00.000Z",
              nodes: [],
              edges: [],
            },
          },
        }));
      }

      if (url.includes("/api/schedule/projection")) {
        throw new Error("schedule projection should not be fetched during plan polling");
      }

      if (url.includes("/api/ai/task-plan/accept")) {
        return Promise.resolve(createJsonResponse({ ok: true }));
      }

      return Promise.resolve(createJsonResponse([]));
    });

    render(<SelectedBlockSheet {...defaultSheetProps} item={{ ...mockItem, aiPlanGenerationStatus: "generating" }} />);

    await act(async () => {
      vi.advanceTimersByTime(1900);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "plan-polled");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "waiting_acceptance");
    expect(mockFetch).toHaveBeenCalledWith("/api/tasks/task-1/plan-state", { cache: "no-store" });
    expect(defaultSheetProps.onMutatedAction).not.toHaveBeenCalled();
  });

  it("probes the lightweight task plan-state endpoint for a newly created task without a saved plan", async () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/tasks/task-1/plan-state", { cache: "no-store" });
    expect(defaultSheetProps.onMutatedAction).not.toHaveBeenCalled();
  });

  it("does not collapse back to no-plan when polling briefly returns idle during generation", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes("/api/tasks/task-1/plan-state")) {
        return Promise.resolve(createJsonResponse({
          taskId: "task-1",
          aiPlanGenerationStatus: "idle",
          savedAiPlan: null,
        }));
      }

      if (url.includes("/api/ai/task-plan/accept")) {
        return Promise.resolve(createJsonResponse({ ok: true }));
      }

      return Promise.resolve(createJsonResponse([]));
    });

    render(<SelectedBlockSheet {...defaultSheetProps} item={{ ...mockItem, aiPlanGenerationStatus: "generating" }} />);

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "generating");

    await act(async () => {
      vi.advanceTimersByTime(1900);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "generating");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "");
    expect(mockFetch).toHaveBeenCalledWith("/api/tasks/task-1/plan-state", { cache: "no-store" });
  });

  it("keeps polling while generation remains unchanged across responses", async () => {
    let pollCount = 0;
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes("/api/tasks/task-1/plan-state")) {
        pollCount += 1;
        return Promise.resolve(createJsonResponse({
          taskId: "task-1",
          aiPlanGenerationStatus: "generating",
          savedAiPlan: null,
        }));
      }

      if (url.includes("/api/ai/task-plan/accept")) {
        return Promise.resolve(createJsonResponse({ ok: true }));
      }

      return Promise.resolve(createJsonResponse([]));
    });

    render(<SelectedBlockSheet {...defaultSheetProps} item={{ ...mockItem, aiPlanGenerationStatus: "generating" }} />);

    await act(async () => {
      vi.advanceTimersByTime(1900);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(1900);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "generating");
  });

  it("continues new-task probing when idle snapshots stay unchanged", async () => {
    let pollCount = 0;
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes("/api/tasks/task-1/plan-state")) {
        pollCount += 1;
        return Promise.resolve(createJsonResponse({
          taskId: "task-1",
          aiPlanGenerationStatus: "idle",
          savedAiPlan: null,
        }));
      }

      if (url.includes("/api/ai/task-plan/accept")) {
        return Promise.resolve(createJsonResponse({ ok: true }));
      }

      return Promise.resolve(createJsonResponse([]));
    });

    render(<SelectedBlockSheet {...defaultSheetProps} />);

    await act(async () => {
      vi.advanceTimersByTime(450);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(1400);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(1400);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pollCount).toBe(3);
  });

  it("clears the dirty marker and updates the AI sidebar after the task config is saved", async () => {
    const onSaveTaskConfigAction = vi.fn().mockResolvedValue(undefined);
    render(<SelectedBlockSheet {...defaultSheetProps} onSaveTaskConfigAction={onSaveTaskConfigAction} />);

    const notifyDraftState = taskConfigDraftStateHandlers.at(-1);
    await act(async () => {
      notifyDraftState?.({
        isDirty: true,
        values: {
          title: "Unsaved draft title",
          description: "Unsaved draft description",
          priority: "Urgent",
          dueAt: new Date(2026, 3, 21, 13, 0),
        },
      });
    });

    const submit = taskConfigSubmitHandlers.at(-1);
    expect(submit).toBeTypeOf("function");

    await act(async () => {
      await submit?.({
        title: "Unsaved draft title",
        description: "Unsaved draft description",
        priority: "Urgent",
        dueAt: new Date(2026, 3, 21, 13, 0),
        runtimeAdapterKey: "openclaw",
        runtimeInput: {},
        runtimeInputVersion: "openclaw-v1",
        runtimeModel: null,
        prompt: null,
        runtimeConfig: null,
      });
    });

    expect(onSaveTaskConfigAction).toHaveBeenCalledOnce();
    expect(taskDecompositionPanelProps).toHaveBeenLastCalledWith(expect.objectContaining({
      title: "Unsaved draft title",
      description: "Unsaved draft description",
      priority: "Urgent",
      hasUnsavedConfigChanges: false,
    }));
  });
});
