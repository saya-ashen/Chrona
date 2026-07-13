import type { ElementType, ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@chrona/i18n/react", async () => {
  const { fallbackMessages } = await import("@chrona/i18n/messages");
  return {
    useI18n: () => ({ messages: fallbackMessages, t: (key: string) => key }),
    useLocale: () => "en",
  };
});

vi.mock("@chrona/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@chrona/i18n")>()),
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


vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: any) => {
    if (asChild && children) {
      return <>{children}</>;
    }
    return <button {...props}>{children}</button>;
  },
}));


vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant }: { children?: React.ReactNode; variant?: string }) => (
    <span data-variant={variant}>{children}</span>
  ),
}));


vi.mock("@/components/ui/card", () => ({
  Card: ({ children, as: Component = "div", ...props }: { children?: ReactNode; as?: ElementType }) => (
    <Component {...props}>{children}</Component>
  ),
  CardHeader: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: { children?: ReactNode }) => <h3 {...props}>{children}</h3>,
}));

// Mock the schedule editor form
vi.mock("../forms/schedule-editor-form", () => ({
  ScheduleEditorForm: () => <div data-testid="schedule-editor-form" />,
}));

const taskConfigSubmitHandlers: Array<(input: unknown) => Promise<void> | void> = [];
const taskConfigDraftStateHandlers: Array<(state: unknown) => void> = [];

// Mock the task config form
vi.mock("../forms/task-config-form", () => ({
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



vi.mock("../panels/selected-block-sheet/selected-block-main-column", () => ({
  SelectedBlockMainColumn: ({
    acceptedPlan,
    generationStatus,
    hasUnsavedConfigChanges,
    onApplyPlan,
    onPlanLoaded,
    onSaveConfigBeforeRegenerate,
    onSaveTaskConfig,
    onTaskConfigDraftStateChange,
    planningTaskDraft,
    savedPlan,
    unsavedConfigDraft,
  }: {
    acceptedPlan?: { id?: string } | null;
    generationStatus?: string;
    hasUnsavedConfigChanges?: boolean;
    onApplyPlan?: (result: unknown) => Promise<void> | void;
    onPlanLoaded?: (savedPlan: unknown) => void;
    onSaveConfigBeforeRegenerate?: () => Promise<void> | void;
    onSaveTaskConfig: (input: unknown) => Promise<void> | void;
    onTaskConfigDraftStateChange: (state: unknown) => void;
    planningTaskDraft?: {
      title?: string;
      description?: string | null;
      priority?: string;
      dueAt?: Date | null;
    };
    savedPlan?: { id?: string } | null;
    unsavedConfigDraft?: unknown;
  }) => {
    taskConfigDraftStateHandlers.push(onTaskConfigDraftStateChange);
    taskConfigSubmitHandlers.push(onSaveTaskConfig);
    taskDecompositionPanelProps({
      activeAcceptedPlanId: acceptedPlan?.id ?? null,
      generationStatus,
      hasUnsavedConfigChanges,
      onApply: onApplyPlan,
      onPlanLoaded,
      onSaveConfigBeforeRegenerate,
      savedPlan,
      title: planningTaskDraft?.title,
      description: planningTaskDraft?.description,
      priority: planningTaskDraft?.priority,
      dueAt: planningTaskDraft?.dueAt,
      unsavedConfigDraft,
    });
    return (
      <div data-testid="selected-block-main-column">
        <div data-testid="schedule-editor-form" />
        <div data-testid="task-config-form" />
        <div
          data-testid="task-decomposition-panel"
          data-active-accepted-plan-id={acceptedPlan?.id ?? ""}
          data-title={planningTaskDraft?.title ?? ""}
          data-description={planningTaskDraft?.description ?? ""}
          data-draft-dirty={String(Boolean(hasUnsavedConfigChanges))}
          data-saved-plan-id={savedPlan?.id ?? ""}
          data-generation-status={generationStatus ?? ""}
        />
        <div data-testid="task-context-links" />
      </div>
    );
  },
}));

vi.mock("../panels/selected-block-sheet/selected-block-sheet-header", () => ({
  SelectedBlockSheetHeader: ({ item }: { item: { title: string } }) => (
    <div data-testid="selected-block-sheet-header"><h2 id="schedule-task-sheet-title">{item.title}</h2></div>
  ),
}));

vi.mock("@features/task-workspace", () => ({
  TaskPlanGenerationPanel: (props: {
    activeAcceptedPlanId?: string | null;
    title?: string;
    description?: string | null;
    priority?: string;
    dueAt?: Date | null;
    hasUnsavedConfigChanges?: boolean;
    savedPlan?: { id?: string } | null;
    generationStatus?: string | null;
  }) => {
    taskDecompositionPanelProps(props);
    return (
      <div
        data-testid="task-decomposition-panel"
        data-active-accepted-plan-id={props.activeAcceptedPlanId ?? ""}
        data-title={props.title ?? ""}
        data-description={props.description ?? ""}
        data-draft-dirty={String(Boolean(props.hasUnsavedConfigChanges))}
        data-saved-plan-id={props.savedPlan?.id ?? ""}
        data-generation-status={props.generationStatus ?? ""}
      />
    );
  },
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

import { SelectedBlockSheet } from "../panels/schedule-page-panels";
import type { ScheduledItem, ScheduledAiTaskPlan, ScheduleTaskPlanSnapshot } from "../schedule-page-types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const mockItem: ScheduledItem = {
  taskId: "task-1",
  workspaceId: "ws-1",
  title: "Test task",
  description: "A description",
  priority: "Medium",
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
  executionRuntime: "hermes",
  executionConfig: {},
  autoPlanGeneration: false,
  autoExecute: false,
  autoPlanGenerationTiming: "at_start",
  autoExecuteTiming: "at_start",
  isRunnable: true,
  runnabilityState: "ready",
  runnabilitySummary: "Ready",
  parentTaskId: null,
};

function makeStubTaskPlanReadModel(overrides: Partial<ScheduledAiTaskPlan> = {}): ScheduledAiTaskPlan {
  return {
    id: overrides.id ?? "plan-stub",
    status: overrides.status ?? "draft",
    revision: overrides.revision ?? 5,
    prompt: overrides.prompt ?? null,
    summary: overrides.summary ?? "stub draft",
    updatedAt: overrides.updatedAt ?? "2026-04-25T14:45:00.000Z",
    generatedBy: overrides.generatedBy ?? "generate-task-plan",
    blueprint: overrides.blueprint ?? {
      title: "stub plan",
      goal: "stub goal",
      assumptions: [],
      nodes: [],
      edges: [],
    },
    compiledPlan: overrides.compiledPlan ?? {
      id: overrides.id ?? "plan-stub",
      editablePlanId: "editable-stub",
      sourceVersion: 5,
      title: "stub plan",
      goal: "stub goal",
      assumptions: [],
      nodes: [],
      edges: [],
      entryNodeIds: [],
      terminalNodeIds: [],
      topologicalOrder: [],
      completionPolicy: { type: "all_tasks_completed" },
      validationWarnings: [],
    },
    effectivePlan: overrides.effectivePlan ?? {
      graphId: overrides.id ?? "graph-stub",
      basePlanId: overrides.id ?? "plan-stub",
      resolvedAt: "2026-04-20T09:00:00.000Z",
      resolvedVersion: 1,
      nodes: [],
      edges: [],
      entryNodeIds: [],
      terminalNodeIds: [],
      readyNodeIds: [],
      blockedNodeIds: [],
      waitingNodeIds: [],
      waitingForUserNodeIds: [],
      waitingForApprovalNodeIds: [],
      degradedNodeIds: [],
      skippedNodeIds: [],
      cancelledNodeIds: [],
      completedNodeIds: [],
      runningNodeIds: [],
      invalidatedNodeIds: [],
      failedNodeIds: [],
      pendingNodeIds: [],
    },
  };
}

function makeSchedulePlanSnapshot(overrides: Partial<ScheduleTaskPlanSnapshot> = {}): ScheduleTaskPlanSnapshot {
  return {
    id: overrides.id ?? "plan-snapshot",
    status: overrides.status ?? "draft",
    revision: overrides.revision ?? 2,
    summary: overrides.summary ?? "snapshot summary",
    updatedAt: overrides.updatedAt ?? "2026-04-25T10:00:00.000Z",
    generatedBy: overrides.generatedBy ?? "generate-task-plan",
  };
}

const defaultSheetProps = {
  item: mockItem,
  selectedDay: "2026-04-15",
  executionRuntimes: [
    {
      key: "hermes",
      label: "Hermes",
      spec: {
        runtime: "hermes",
        version: "hermes-v1",
        fields: [],
        runnability: { requiredPaths: [] },
      },
    },
  ],
  defaultExecutionRuntime: "hermes",
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

    if (url.includes("/api/tasks/") && url.endsWith("/plan")) {
      return Promise.resolve(createJsonResponse({
        taskId: "task-1",
        aiPlanGenerationStatus: "idle",
        savedPlan: null,
      }));
    }

    if (url.includes("/api/tasks/") && url.includes("/plan/accept")) {
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

  it("renders planning and context links in the popup main column", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    const mainColumn = document.body.querySelector("[data-testid='selected-block-main-column']");

    expect(mainColumn).toBeTruthy();
    expect(mainColumn).toContainElement(screen.getByTestId("task-decomposition-panel"));
    expect(mainColumn).toContainElement(screen.getByTestId("task-context-links"));
  });

  it("keeps schedule editing, task config, and planning in the main popup column", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    const mainColumn = document.body.querySelector("[data-testid='selected-block-main-column']");

    expect(mainColumn).toContainElement(screen.getByTestId("schedule-editor-form"));
    expect(mainColumn).toContainElement(screen.getByTestId("task-config-form"));
    expect(mainColumn).toContainElement(screen.getByTestId("task-decomposition-panel"));
    expect(mainColumn).toContainElement(screen.getByTestId("task-context-links"));
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

  it("renders the cockpit outside the local page container", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    render(
      <div data-testid="host-shell">
        <SelectedBlockSheet {...defaultSheetProps} />
      </div>,
      { container: host },
    );

    const dialog = screen.getByRole("dialog");
    expect(host).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
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
      latestPanelProps.onPlanLoaded?.(makeStubTaskPlanReadModel({
        id: "plan-new",
        status: "draft",
        revision: 3,
        summary: "new generated plan",
        updatedAt: "2026-04-25T12:00:00.000Z",
      }));
    });

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "plan-new");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "waiting_acceptance");
  });

  it("keeps the generated plan visible after accepting it", async () => {
    const generatedPlan = makeStubTaskPlanReadModel({
      id: "plan-generated",
      status: "draft",
      revision: 3,
      summary: "generated plan",
      updatedAt: "2026-04-25T12:00:00.000Z",
    });
    const acceptedPlan = { ...generatedPlan, status: "accepted" as const };
    const onMutatedAction = vi.fn().mockResolvedValue(undefined);
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes("/api/tasks/") && url.includes("/plan/accept")) {
        return Promise.resolve(createJsonResponse({ savedPlan: acceptedPlan }));
      }

      return Promise.resolve(createJsonResponse([]));
    });

    const { rerender } = render(<SelectedBlockSheet {...defaultSheetProps} onMutatedAction={onMutatedAction} />);

    const loadedPanelProps = taskDecompositionPanelProps.mock.calls.at(-1)?.[0] as {
      onPlanLoaded?: (savedPlan: unknown) => void;
    };
    await act(async () => {
      loadedPanelProps.onPlanLoaded?.(generatedPlan);
    });

    const applyPanelProps = taskDecompositionPanelProps.mock.calls.at(-1)?.[0] as {
      onApply?: (savedPlan: unknown) => Promise<void> | void;
    };
    await act(async () => {
      await applyPanelProps.onApply?.(generatedPlan);
    });

    expect(onMutatedAction).toHaveBeenCalledOnce();
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "plan-generated");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-active-accepted-plan-id", "plan-generated");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "accepted");

    rerender(<SelectedBlockSheet {...defaultSheetProps} onMutatedAction={onMutatedAction} item={{
      ...mockItem,
      aiPlanGenerationStatus: "waiting_acceptance",
      savedPlan: makeSchedulePlanSnapshot({
        id: "plan-generated",
        status: "draft",
        revision: 3,
        updatedAt: "2026-04-25T12:00:00.000Z",
      }),
    }} />);

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "plan-generated");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-active-accepted-plan-id", "plan-generated");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "accepted");
  });


  it("syncs the sidebar status and plan when the selected task prop changes", async () => {
    const { rerender } = render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "");

    rerender(<SelectedBlockSheet {...defaultSheetProps} item={{ ...mockItem, aiPlanGenerationStatus: "generating" }} />);
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "generating");

    const itemWithNewPlan: ScheduledItem = {
      ...mockItem,
      aiPlanGenerationStatus: "waiting_acceptance",
      savedPlan: makeStubTaskPlanReadModel({
        id: "plan-from-parent",
        status: "draft",
        revision: 4,
        summary: "parent refreshed plan",
        updatedAt: "2026-04-25T13:00:00.000Z",
      }),
    };

    rerender(<SelectedBlockSheet {...defaultSheetProps} item={itemWithNewPlan} />);

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "plan-from-parent");
    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "waiting_acceptance");
  });

  it("loads the full saved plan when schedule data only includes a lightweight snapshot", async () => {
    const fullPlan = makeStubTaskPlanReadModel({
      id: "plan-full",
      status: "draft",
      revision: 2,
      summary: "loaded full plan",
      updatedAt: "2026-04-25T10:00:00.000Z",
    });
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes("/api/tasks/") && url.endsWith("/plan")) {
        return Promise.resolve(createJsonResponse({
          taskId: "task-1",
          aiPlanGenerationStatus: "waiting_acceptance",
          savedPlan: fullPlan,
        }));
      }

      return Promise.resolve(createJsonResponse([]));
    });

    render(<SelectedBlockSheet {...defaultSheetProps} item={{
      ...mockItem,
      aiPlanGenerationStatus: "waiting_acceptance",
      savedPlan: makeSchedulePlanSnapshot({ id: "plan-full" }),
    }} />);

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "plan-full");
    expect(mockFetch.mock.calls.some(([input]) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
      return url.includes("/api/tasks/task-1/plan");
    })).toBe(true);
  });

  it("does not poll the task plan endpoint while the edit sheet is open", async () => {
    render(<SelectedBlockSheet {...defaultSheetProps} item={{ ...mockItem, aiPlanGenerationStatus: "generating" }} />);

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-generation-status", "generating");
    expect(mockFetch).not.toHaveBeenCalledWith("/api/tasks/task-1/plan", expect.any(Object));
    expect(defaultSheetProps.onMutatedAction).not.toHaveBeenCalled();
  });

  it("does not probe the task plan endpoint for a selected task without a saved plan", async () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("task-decomposition-panel")).toHaveAttribute("data-saved-plan-id", "");
    expect(mockFetch).not.toHaveBeenCalledWith("/api/tasks/task-1/plan", expect.any(Object));
    expect(defaultSheetProps.onMutatedAction).not.toHaveBeenCalled();
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
        runtimeAdapterKey: "hermes",
        runtimeInput: {},
        runtimeInputVersion: "hermes-v1",
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
