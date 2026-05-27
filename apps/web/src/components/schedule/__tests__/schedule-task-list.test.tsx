import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleTaskList, type ScheduleTaskListItem } from "../schedule-task-list";

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({ t: (key: string) => key, messages: {} }),
  useLocale: () => "en",
}));
vi.mock("@chrona/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@chrona/i18n")>()),
  localizeHref: (_: string, href: string) => href,
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
  Badge: ({ children }: any) => <span data-testid="status-badge">{children}</span>,
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
}));
vi.mock("@/components/tasks/shared/task-context-links", () => ({ TaskContextLinks: () => null }));
vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/schedule/forms/task-config-form", () => ({
  TaskConfigForm: () => <div data-testid="task-config-form" />,
}));
vi.mock("@/lib/utils", () => ({ cn: (...args: any[]) => args.filter(Boolean).join(" ") }));

function makeItem(overrides: Partial<ScheduleTaskListItem> & { taskId: string; title: string }): ScheduleTaskListItem {
  return {
    workspaceId: "ws-1",
    description: null,
    priority: "Medium",
    persistedStatus: "Open",
    displayState: null,
    actionRequired: null,
    approvalPendingCount: 0,
    latestRunStatus: null,
    dueAt: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    scheduleStatus: null,
    scheduleSource: null,
    scheduleProposalCount: 0,
    lastActivityAt: null,
    executionRuntime: "hermes",
    executionConfig: {},
    isRunnable: true,
    runnabilityState: "Ready",
    runnabilitySummary: "Ready",
    parentTaskId: null,
    ...overrides,
  };
}

const failedItem = makeItem({
  taskId: "t-failed",
  title: "Failed Task",
  latestRunStatus: "Failed",
  priority: "High",
  isRunnable: true,
  runnabilitySummary: "Ready",
});

const unscheduledItem = makeItem({
  taskId: "t-unsched",
  title: "Unscheduled Task",
  scheduleStatus: "Unscheduled",
  isRunnable: false,
  runnabilitySummary: "Missing config",
  runnabilityState: "NotReady",
});

const runningItem = makeItem({
  taskId: "t-running",
  title: "Running Task",
  persistedStatus: "Running",
  latestRunStatus: "Running",
  scheduleStatus: "Overdue",
  isRunnable: true,
  runnabilitySummary: "Ready",
});

const mockItems: ScheduleTaskListItem[] = [failedItem, unscheduledItem, runningItem];

const defaultProps = {
  items: mockItems,
  executionRuntimes: [],
  defaultExecutionRuntime: "hermes",
  isPending: false,
  onSaveTaskConfigAction: vi.fn().mockResolvedValue(undefined),
};

describe("ScheduleTaskList", () => {
  afterEach(() => {
    cleanup();
  });

  function clickFilter(label: string) {
    // Filter buttons contain a span with the label; the label also appears in the "showing" text.
    // Target the button element directly.
    const buttons = screen.getAllByRole("button");
    const btn = buttons.find((b) => b.textContent?.includes(label));
    if (!btn) throw new Error(`Filter button with label "${label}" not found`);
    return userEvent.setup().click(btn);
  }

  it("renders all filter buttons with counts", () => {
    render(<ScheduleTaskList {...defaultProps} />);
    const filterKeys = [
      "all", "running", "waitingForApproval", "blocked", "failed", "unscheduled", "overdue", "notRunnable",
    ];
    const buttons = screen.getAllByRole("button");
    for (const key of filterKeys) {
      const label = `components.scheduleTaskList.${key}`;
      expect(buttons.some((b) => b.textContent?.includes(label))).toBe(true);
    }
    // Verify count badges exist (all=3, failed=1, etc.)
    const badges = screen.getAllByTestId("status-badge");
    expect(badges.length).toBeGreaterThan(8); // 8 filter count badges + item badges
  });

  it("default 'all' filter shows all items", () => {
    render(<ScheduleTaskList {...defaultProps} />);
    expect(screen.getByText("Failed Task")).toBeInTheDocument();
    expect(screen.getByText("Unscheduled Task")).toBeInTheDocument();
    expect(screen.getByText("Running Task")).toBeInTheDocument();
  });

  it("clicking 'failed' filter shows only failed items", async () => {
    render(<ScheduleTaskList {...defaultProps} />);
    await clickFilter("components.scheduleTaskList.failed");
    expect(screen.getByText("Failed Task")).toBeInTheDocument();
    expect(screen.queryByText("Unscheduled Task")).not.toBeInTheDocument();
    expect(screen.queryByText("Running Task")).not.toBeInTheDocument();
  });

  it("clicking 'unscheduled' filter shows only unscheduled items", async () => {
    render(<ScheduleTaskList {...defaultProps} />);
    await clickFilter("components.scheduleTaskList.unscheduled");
    expect(screen.getByText("Unscheduled Task")).toBeInTheDocument();
    expect(screen.queryByText("Failed Task")).not.toBeInTheDocument();
    expect(screen.queryByText("Running Task")).not.toBeInTheDocument();
  });

  it("shows empty message when no items match filter", async () => {
    render(<ScheduleTaskList {...defaultProps} />);
    await clickFilter("components.scheduleTaskList.blocked");
    expect(screen.getByText("components.scheduleTaskList.emptyBlocked")).toBeInTheDocument();
  });

  it("renders task title as link", () => {
    render(<ScheduleTaskList {...defaultProps} />);
    const link = screen.getByText("Failed Task").closest("a");
    expect(link).toHaveAttribute("href", "/tasks/t-failed");
  });

  it("shows task priority and runnability badges", () => {
    render(<ScheduleTaskList {...defaultProps} />);
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Missing config")).toBeInTheDocument();
  });

  it("shows scheduled display state instead of stale Draft persistence state", () => {
    render(
      <ScheduleTaskList
        {...defaultProps}
        items={[
          makeItem({
            taskId: "t-draft-scheduled",
            title: "Scheduled task",
            persistedStatus: "Draft",
            scheduleStatus: "Scheduled",
            isRunnable: true,
            runnabilitySummary: "Ready to run",
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("Scheduled").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("clicking quick edit button expands task config form", async () => {
    const user = userEvent.setup();
    render(<ScheduleTaskList {...defaultProps} />);
    expect(screen.queryByTestId("task-config-form")).not.toBeInTheDocument();
    const editButtons = screen.getAllByText("components.scheduleTaskList.quickEdit");
    await user.click(editButtons[0]);
    expect(screen.getByTestId("task-config-form")).toBeInTheDocument();
  });

  it("clicking quick edit again collapses it", async () => {
    const user = userEvent.setup();
    render(<ScheduleTaskList {...defaultProps} />);
    const editButtons = screen.getAllByText("components.scheduleTaskList.quickEdit");
    await user.click(editButtons[0]);
    expect(screen.getByTestId("task-config-form")).toBeInTheDocument();
    await user.click(screen.getByText("components.scheduleTaskList.closeQuickEdit"));
    expect(screen.queryByTestId("task-config-form")).not.toBeInTheDocument();
  });

  it("items matching 'running' filter shows running items", async () => {
    render(<ScheduleTaskList {...defaultProps} />);
    await clickFilter("components.scheduleTaskList.running");
    expect(screen.getByText("Running Task")).toBeInTheDocument();
    expect(screen.queryByText("Failed Task")).not.toBeInTheDocument();
    expect(screen.queryByText("Unscheduled Task")).not.toBeInTheDocument();
  });

  it("items matching 'notRunnable' filter shows not-runnable items", async () => {
    render(<ScheduleTaskList {...defaultProps} />);
    await clickFilter("components.scheduleTaskList.notRunnable");
    expect(screen.getByText("Unscheduled Task")).toBeInTheDocument();
    expect(screen.queryByText("Failed Task")).not.toBeInTheDocument();
    expect(screen.queryByText("Running Task")).not.toBeInTheDocument();
  });

  it("items matching 'overdue' filter shows overdue items", async () => {
    render(<ScheduleTaskList {...defaultProps} />);
    await clickFilter("components.scheduleTaskList.overdue");
    expect(screen.getByText("Running Task")).toBeInTheDocument();
    expect(screen.queryByText("Failed Task")).not.toBeInTheDocument();
    expect(screen.queryByText("Unscheduled Task")).not.toBeInTheDocument();
  });
});
