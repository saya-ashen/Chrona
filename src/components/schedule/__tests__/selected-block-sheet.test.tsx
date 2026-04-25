import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
      />
    );
  },
}));

// Mock the task context links
vi.mock("@/components/ui/task-context-links", () => ({
  TaskContextLinks: () => <div data-testid="task-context-links" />,
}));

// Mock fetch for subtasks
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => [],
});

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: (...args: Parameters<typeof fetch>) => mockFetch(...args),
});

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
  onSaveTaskConfigAction: vi.fn(),
  onMutatedAction: vi.fn(),
  buildScheduleHref: (day: string, taskId?: string) =>
    taskId ? `/schedule/${day}/${taskId}` : `/schedule/${day}`,
};

afterEach(() => {
  cleanup();
  taskConfigSubmitHandlers.length = 0;
  taskConfigDraftStateHandlers.length = 0;
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
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
