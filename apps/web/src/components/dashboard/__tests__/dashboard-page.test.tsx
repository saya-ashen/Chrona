import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: any) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: any) => (asChild && children ? <>{children}</> : <button {...props}>{children}</button>),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: (props: any) => <hr {...props} />,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: any) => <button data-value={value}>{children}</button>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

import { DashboardPage } from "@/components/dashboard/dashboard-page";
import type { DashboardData } from "@/components/dashboard/dashboard-types";

const COPY = {
  title: "Chrona workspace",
  subtitle: "At a glance",
  viewAllTasks: "All tasks",
  newTask: "New task",
  openTask: "Open",
  headline: {
    both: "Today Chrona auto-completed {completed} tasks, and {attention} need you.",
    completedOnly: "Today Chrona auto-completed {completed} tasks — nothing needs you right now.",
    attentionOnly: "Nothing auto-completed yet today, and {attention} tasks need you.",
    idle: "Chrona is standing by.",
  },
  summary: { title: "Needs you", pending: "{n} pending", none: "All clear" },
  nextStep: {
    approve_or_edit: "Review & approve",
    resolve_block: "Resolve",
    provide_input: "Reply",
    await_completion: "Watch",
    start_execution: "Start",
    reschedule: "Reschedule",
    review_result: "Review result",
  },
  focus: { eyebrow: "Focus now", empty: "Nothing needs your focus right now." },
  attention: {
    title: "Needs you",
    description: "desc",
    empty: "Nothing needs you right now.",
    kind: {
      approval: "Waiting for approval",
      input: "Waiting for your input",
      blocked: "Blocked",
      failed: "Run failed",
      schedule_risk: "At schedule risk",
    },
  },
  inProgress: { title: "In progress", description: "desc", empty: "Nothing is running right now." },
  completed: { title: "Recently completed", totalLabel: "{n} completed all-time", empty: "No completed tasks yet." },
  digest: {
    title: "Auto-completion overview",
    description: "Daily report.",
    todayHeadline: "{n} tasks auto-completed today",
    weekHeadline: "{n} tasks auto-completed this week",
    allTimeHeadline: "{n} tasks auto-completed all-time",
    rangeToday: "Today",
    rangeWeek: "This week",
    rangeAll: "All time",
    breakdownTitle: "What got done",
    recentTitle: "Recently auto-completed",
    viewAll: "View all completed tasks",
    empty: "Chrona hasn't auto-completed any tasks yet.",
    outputLabel: "Output",
    category: {
      report: "Reports generated",
      research: "Research & summaries",
      code: "Code & checks",
      automation: "Plans & automation",
    },
    categoryUnit: {
      report: "{n} reports",
      research: "{n} summaries",
      code: "{n} checks",
      automation: "{n} updates",
    },
  },
  feed: {
    title: "Latest activity",
    description: "desc",
    empty: "No activity yet.",
    category: {
      created: "Created",
      plan: "Planned",
      started: "Started",
      completed: "Completed",
      failed: "Failed",
      blocked: "Blocked",
      approval: "Needs approval",
      input: "Needs input",
      schedule: "Rescheduled",
    },
  },
  taskStream: {
    title: "Task stream",
    description: "desc",
    empty: "No tasks match this filter.",
    filters: { all: "All", attention: "Needs you", inProgress: "In progress", autoCompleted: "Auto-completed", archived: "Archived" },
    lane: { attention: "Needs you", inProgress: "In progress", autoCompleted: "Auto-completed" },
  },
  time: { justNow: "just now", minutes: "{n}m ago", hours: "{n}h ago", days: "{n}d ago" },
} as any;

function makeData(overrides?: Partial<DashboardData>): DashboardData {
  return {
    generatedAt: new Date().toISOString(),
    focusTask: null,
    needsAttention: [],
    inProgress: [],
    autoCompleted: [],
    totalAutoCompleted: 0,
    recentEvents: [],
    ...overrides,
  } as DashboardData;
}

function completed(overrides: Partial<DashboardData["autoCompleted"][number]> = {}): DashboardData["autoCompleted"][number] {
  return {
    taskId: "c1",
    title: "Summarize repo",
    completedAt: new Date().toISOString(),
    summary: "summary.md",
    category: "report",
    output: { id: "a1", taskId: "c1", title: "summary.md", type: "report" },
    ...overrides,
  } as DashboardData["autoCompleted"][number];
}

afterEach(() => cleanup());

describe("DashboardPage", () => {
  it("renders the natural-language headline with both completed-today and attention counts", () => {
    render(
      <DashboardPage
        data={makeData({
          autoCompleted: [completed({ taskId: "x1" }), completed({ taskId: "x2" })],
          needsAttention: [
            {
              taskId: "t2",
              title: "Stuck task",
              status: "Blocked",
              priority: "High",
              kind: "blocked",
              reason: "Waiting",
              nextStep: "resolve_block",
              latestOutput: null,
              updatedAt: null,
            },
          ],
        })}
        copy={COPY}
      />,
    );
    expect(screen.getByText("Today Chrona auto-completed 2 tasks, and 1 need you.")).toBeTruthy();
  });

  it("renders the focus headline with its reason and next-step action", () => {
    render(
      <DashboardPage
        data={makeData({
          focusTask: {
            taskId: "t1",
            title: "GitHub trendings",
            status: "Failed",
            priority: "Urgent",
            scheduleStatus: null,
            reason: "GitHub API request failed",
            stage: null,
            nextStep: "resolve_block",
            latestOutput: null,
            dueAt: null,
            updatedAt: null,
          },
        })}
        copy={COPY}
      />,
    );
    expect(screen.getByText("GitHub trendings")).toBeTruthy();
    expect(screen.getByText("GitHub API request failed")).toBeTruthy();
    expect(screen.getByText("Focus now")).toBeTruthy();
    expect(screen.getAllByText("Resolve").length).toBeGreaterThan(0);
  });

  it("falls back to the focus empty state when no task needs attention", () => {
    render(<DashboardPage data={makeData()} copy={COPY} />);
    expect(screen.getByText("Nothing needs your focus right now.")).toBeTruthy();
  });

  it("summarizes attention by kind in the needs-you card", () => {
    render(
      <DashboardPage
        data={makeData({
          needsAttention: [
            {
              taskId: "t2",
              title: "Stuck task",
              status: "WaitingForApproval",
              priority: "High",
              kind: "approval",
              reason: "Allow deleting the old branch?",
              nextStep: "approve_or_edit",
              latestOutput: null,
              updatedAt: null,
            },
          ],
        })}
        copy={COPY}
      />,
    );
    expect(screen.getByText("1 pending")).toBeTruthy();
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
  });

  it("renders the auto-completion digest headline and category breakdown", () => {
    render(
      <DashboardPage
        data={makeData({
          totalAutoCompleted: 12,
          autoCompleted: [
            completed({ taskId: "d1", title: "Report A", category: "report" }),
            completed({ taskId: "d2", title: "Research B", category: "research", output: { id: "a2", taskId: "d2", title: "notes.md", type: "summary" } }),
          ],
        })}
        copy={COPY}
      />,
    );
    expect(screen.getByText("Auto-completion overview")).toBeTruthy();
    expect(screen.getByText("2 tasks auto-completed today")).toBeTruthy();
    expect(screen.getByText("Reports generated")).toBeTruthy();
    expect(screen.getByText("Research & summaries")).toBeTruthy();
    // Title appears in both the digest recent list and the task stream.
    expect(screen.getAllByText("Report A").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Auto-completion overview" })).toHaveAttribute("data-ui-surface-kind", "ai-authored");
    expect(screen.getByText("AI generated")).toBeTruthy();
  });

  it("shows the digest empty state when nothing has auto-completed", () => {
    render(<DashboardPage data={makeData()} copy={COPY} />);
    expect(screen.getByText("Chrona hasn't auto-completed any tasks yet.")).toBeTruthy();
  });

  it("renders the recent activity feed linked to each task", () => {
    render(
      <DashboardPage
        data={makeData({
          recentEvents: [
            {
              id: "e1",
              category: "completed",
              at: new Date().toISOString(),
              taskId: "t4",
              taskTitle: "Daily digest",
              summary: "Produced the daily digest",
            },
          ],
        })}
        copy={COPY}
      />,
    );
    expect(screen.getByText("Daily digest")).toBeTruthy();
    expect(screen.getByText(/Produced the daily digest/)).toBeTruthy();
  });

  it("renders the task stream with lane labels for each item", () => {
    render(
      <DashboardPage
        data={makeData({
          needsAttention: [
            {
              taskId: "s1",
              title: "Blocked task",
              status: "Blocked",
              priority: "High",
              kind: "blocked",
              reason: "Waiting on confirmation",
              nextStep: "resolve_block",
              latestOutput: null,
              updatedAt: null,
            },
          ],
          autoCompleted: [completed({ taskId: "s2", title: "Done task" })],
        })}
        copy={COPY}
      />,
    );
    expect(screen.getByText("Task stream")).toBeTruthy();
    // Blocked task title surfaces only in the stream (focus is null, needs-you shows kind).
    expect(screen.getByText("Blocked task")).toBeTruthy();
    expect(screen.getAllByText("Done task").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs you").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Auto-completed").length).toBeGreaterThan(0);
  });
});
