import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockTaskDialogAutoExecute = true;
let mockTaskDialogAutoPlanGenerationEnabled = true;

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: any) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@/components/i18n/locale-switcher", () => ({
  LocaleSwitcher: () => (
    <div>
      <a href="/en/schedule">English</a>
      <a href="/zh/schedule">中文</a>
    </div>
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

vi.mock("../../../../../features/schedule/ui", () => ({
  TaskCreateDialog: ({ isOpen, onSubmit }: { isOpen: boolean; onSubmit: (input: any) => Promise<void> }) => isOpen ? (
    <div role="dialog">
      <span>Create task dialog</span>
      <button
        type="button"
        onClick={() => onSubmit({
          title: "Created from shell",
          description: "Shell description",
          priority: "High",
          autoExecute: mockTaskDialogAutoExecute,
          autoPlanGenerationEnabled: mockTaskDialogAutoPlanGenerationEnabled,
          dueAt: null,
          scheduledStartAt: new Date(2026, 3, 15, 9, 0, 0, 0),
          scheduledEndAt: new Date(2026, 3, 15, 10, 0, 0, 0),
        })}
      >
        Submit task
      </button>
    </div>
  ) : null,
}));

vi.mock("@/lib/task-actions-client", () => ({
  createTaskFromSchedule: vi.fn(),
}));

vi.mock("@/hooks/ai/task-plan-generation-session-store", () => ({
  startTaskPlanGenerationSession: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" "),
}));

const routerPush = vi.fn();
const routerRefresh = vi.fn();

vi.mock("@/lib/router", () => ({
  useAppPathname: () => "/tasks",
  useAppRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
  }),
}));

vi.mock("@/components/assistant-surface/assistant-surface-provider", () => ({
  useAssistantSurface: () => ({
    isOpen: false,
    state: {
      topSummary: { label: "PAGE-AWARE AI", value: "Task ready" },
    },
    toggle: vi.fn(),
  }),
}));

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "nav.brandTitle": "Chrona",
        "nav.brandTagline": "Human-AI task work",
        "nav.schedule": "Schedule",
        "nav.inbox": "Inbox",
        "nav.tasks": "Tasks",
        "nav.settings": "Settings",
        "nav.newTask": "New Task",
        "components.schedulePage.firstRunTitle": "Start with Chrona in three steps",
        "components.schedulePage.firstRunDescription":
          "Connect AI, capture a real task, then review the plan before anything runs.",
        "components.schedulePage.firstRunStepConnectAiTitle": "Connect AI",
        "components.schedulePage.firstRunStepConnectAi": "Add Claude Code or Codex as the AI client Chrona will use.",
        "components.schedulePage.firstRunStepConnectAiDone": "AI client connected. Next, create a real task.",
        "components.schedulePage.firstRunStepCreateTaskTitle": "Create a task",
        "components.schedulePage.firstRunStepCreateTask": "Describe the goal, constraints, and context in one task.",
        "components.schedulePage.firstRunStepReviewPlanTitle": "Review the plan",
        "components.schedulePage.firstRunStepReviewPlan": "Chrona previews AI suggestions first; you decide what to accept or run.",
        "components.schedulePage.firstRunConnectAi": "Connect AI",
        "components.schedulePage.firstRunCreateTask": "Create first task",
        "components.schedulePage.firstRunOpenCreatedTask": "Open created task",
      };
      return map[key] ?? key;
    },
  }),
  useLocale: () => "en",
}));

import {
  SCHEDULE_AI_PREFERENCES_STORAGE_KEY,
  type ScheduleAiPreferences,
} from "@/lib/schedule-ai-preferences";
import { createTaskFromSchedule } from "@/lib/task-actions-client";
import { startTaskPlanGenerationSession } from "@/hooks/ai/task-plan-generation-session-store";
import { ControlPlaneShell } from "@/components/control-plane-shell";

const defaultWorkspace = { id: "ws-1", name: "Default" };
const mockCreateTaskFromSchedule = createTaskFromSchedule as ReturnType<typeof vi.fn>;
const mockStartTaskPlanGenerationSession = startTaskPlanGenerationSession as ReturnType<typeof vi.fn>;

function writePreferences(preferences: ScheduleAiPreferences) {
  window.localStorage.setItem(
    SCHEDULE_AI_PREFERENCES_STORAGE_KEY,
    JSON.stringify(preferences),
  );
}

function expectNavLink(label: string, href: string) {
  const links = screen.getAllByRole("link", { name: label });
  expect(links.some((link) => link.getAttribute("href") === href)).toBe(true);
  return links;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  mockTaskDialogAutoExecute = true;
  mockTaskDialogAutoPlanGenerationEnabled = true;
});

describe("ControlPlaneShell", () => {
  it("renders primary navigation with Schedule, Tasks, and Settings", () => {
    render(
      <ControlPlaneShell defaultWorkspace={defaultWorkspace}>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    const chronaLinks = screen.getAllByRole("link", { name: "Chrona" });
    expect(chronaLinks.length).toBeGreaterThan(0);
    expect(chronaLinks[0]).toHaveAttribute("href", "/en/schedule");
    expectNavLink("Schedule", "/en/schedule");
    const taskLinks = expectNavLink("Tasks", "/en/tasks");
    expect(taskLinks.some((link) => link.getAttribute("aria-current") === "page")).toBe(true);
    expectNavLink("Settings", "/en/settings");

    // Should NOT show inactive or legacy workspace navigation.
    expect(screen.queryByRole("link", { name: "Memory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Workspaces" })).not.toBeInTheDocument();

    const assistantStatus = screen.getByRole("button", { name: "components.assistantSurface.entryLabel" });
    expect(assistantStatus).toBeDisabled();
    expect(screen.getByText("PAGE-AWARE AI")).toBeInTheDocument();
    expect(screen.getByText("Task ready")).toBeInTheDocument();
  });


  it("opens the create task dialog without linking away from the current page", async () => {
    const user = userEvent.setup();

    render(
      <ControlPlaneShell defaultWorkspace={defaultWorkspace}>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    const newTaskButton = screen.getByRole("button", { name: "New Task" });
    expect(screen.queryByRole("link", { name: "New Task" })).not.toBeInTheDocument();

    await user.click(newTaskButton);

    expect(screen.getByRole("dialog")).toHaveTextContent("Create task dialog");
  });

  it("passes dialog automation choices into task creation", async () => {
    const user = userEvent.setup();
    writePreferences({
      autoSuggestionsEnabled: false,
      autoPlanGenerationEnabled: false,
      defaultAutoExecuteEnabled: false,
    });
    mockCreateTaskFromSchedule.mockResolvedValueOnce({ taskId: "created-task" });

    render(
      <ControlPlaneShell defaultWorkspace={defaultWorkspace}>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    await user.click(screen.getByRole("button", { name: "New Task" }));
    await user.click(screen.getByRole("button", { name: "Submit task" }));

    await waitFor(() => {
      expect(mockCreateTaskFromSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          title: "Created from shell",
          description: "Shell description",
          priority: "High",
          autoPlanGeneration: true,
          autoExecute: true,
        }),
      );
    });
    expect(mockStartTaskPlanGenerationSession).not.toHaveBeenCalled();
  });

  it("advances onboarding to plan review after creating a task", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ clients: [{ id: "client-1", enabled: true }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    mockCreateTaskFromSchedule.mockResolvedValueOnce({ taskId: "created-task" });

    render(
      <ControlPlaneShell defaultWorkspace={defaultWorkspace}>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    expect(await screen.findByRole("button", { name: "Create first task" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create first task" }));
    await user.click(screen.getByRole("button", { name: "Submit task" }));

    await waitFor(() => {
      expect(mockCreateTaskFromSchedule).toHaveBeenCalledWith(expect.objectContaining({ title: "Created from shell" }));
    });
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Review the plan");
    expect(screen.getByRole("button", { name: "Open created task" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open created task" }));
    expect(routerPush).toHaveBeenCalledWith("/en/tasks/created-task");
    expect(screen.queryByText("Start with Chrona in three steps")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open created task" })).not.toBeInTheDocument();
  });

  it("forces plan generation when auto-execute is enabled", async () => {
    const user = userEvent.setup();
    mockTaskDialogAutoExecute = true;
    mockTaskDialogAutoPlanGenerationEnabled = false;
    mockCreateTaskFromSchedule.mockResolvedValueOnce({ taskId: "created-task" });

    render(
      <ControlPlaneShell defaultWorkspace={defaultWorkspace}>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    await user.click(screen.getByRole("button", { name: "New Task" }));
    await user.click(screen.getByRole("button", { name: "Submit task" }));

    await waitFor(() => {
      expect(mockCreateTaskFromSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          autoPlanGeneration: true,
          autoExecute: true,
        }),
      );
    });
    expect(mockStartTaskPlanGenerationSession).not.toHaveBeenCalled();
  });

  it("does not request auto plan generation when both task automation switches are disabled", async () => {
    const user = userEvent.setup();
    mockTaskDialogAutoExecute = false;
    mockTaskDialogAutoPlanGenerationEnabled = false;
    writePreferences({
      autoSuggestionsEnabled: false,
      autoPlanGenerationEnabled: true,
      defaultAutoExecuteEnabled: false,
    });
    mockCreateTaskFromSchedule.mockResolvedValueOnce({ taskId: "created-task" });

    render(
      <ControlPlaneShell defaultWorkspace={defaultWorkspace}>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    await user.click(screen.getByRole("button", { name: "New Task" }));
    await user.click(screen.getByRole("button", { name: "Submit task" }));

    await waitFor(() => {
      expect(mockCreateTaskFromSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Created from shell",
          autoPlanGeneration: false,
          autoExecute: false,
        }),
      );
    });
    expect(mockStartTaskPlanGenerationSession).not.toHaveBeenCalled();
  });
});
