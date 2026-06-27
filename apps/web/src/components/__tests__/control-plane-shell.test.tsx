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

vi.mock("@/lib/router", () => ({
  useAppPathname: () => "/tasks",
  useAppRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
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
      };
      return map[key] ?? key;
    },
  }),
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
  it("renders primary navigation with Schedule, Inbox, Tasks, and Settings", () => {
    render(
      <ControlPlaneShell defaultWorkspace={defaultWorkspace}>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    const chronaLinks = screen.getAllByRole("link", { name: "Chrona" });
    expect(chronaLinks.length).toBeGreaterThan(0);
    expect(chronaLinks[0]).toHaveAttribute("href", "/en/schedule");
    expectNavLink("Schedule", "/en/schedule");
    expectNavLink("Inbox", "/en/inbox");
    const taskLinks = expectNavLink("Tasks", "/en/tasks");
    expect(taskLinks.some((link) => link.getAttribute("aria-current") === "page")).toBe(true);
    expectNavLink("Settings", "/en/settings");

    // Should NOT show inactive or legacy workspace navigation.
    expect(screen.queryByRole("link", { name: "Memory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Workspaces" })).not.toBeInTheDocument();
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
