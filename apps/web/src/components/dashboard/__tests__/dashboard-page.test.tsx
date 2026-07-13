import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: { children: ReactNode; href: string } & Omit<ComponentPropsWithoutRef<"a">, "href">) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@shared/ui", () => ({
  Button: ({ children, asChild, ...props }: { children?: ReactNode; asChild?: boolean } & ComponentPropsWithoutRef<"button">) => (asChild && children ? <>{children}</> : <button {...props}>{children}</button>),
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Separator: (props: ComponentPropsWithoutRef<"hr">) => <hr {...props} />,
  Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: { children?: ReactNode; value: string } & ComponentPropsWithoutRef<"button">) => <button data-value={value}>{children}</button>,
  Card: ({ children, ...props }: { children?: ReactNode } & ComponentPropsWithoutRef<"div">) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: { children?: ReactNode } & ComponentPropsWithoutRef<"div">) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }: { children?: ReactNode } & ComponentPropsWithoutRef<"div">) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: { children?: ReactNode } & ComponentPropsWithoutRef<"div">) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: { children?: ReactNode } & ComponentPropsWithoutRef<"div">) => <div {...props}>{children}</div>,
  PageFrame: ({ children, ...props }: { children?: ReactNode } & ComponentPropsWithoutRef<"div">) => <div {...props}>{children}</div>,
  UiSurfaceFrame: ({ kind, label, children, ...props }: { kind: string; label: string; children?: ReactNode } & ComponentPropsWithoutRef<"section">) => <section aria-label={label} data-ui-surface-kind={kind} {...props}>{children}<span>{kind === "ai-authored" ? "AI generated" : ""}</span></section>,
  cn: (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" "),
}));

vi.mock("@features/task-workspace/ui/catalog/spec-renderer", () => ({
  SpecRenderer: ({ spec }: { spec: unknown }) => <div>{spec ? "AI brief spec rendered" : null}</div>,
}));


vi.mock("react-router-dom", () => ({
  useRevalidator: () => ({ revalidate: vi.fn() }),
}));

vi.mock("shared/http/api-client", () => ({
  apiJson: vi.fn(),
}));
import { DashboardPage } from "@/components/dashboard/dashboard-page";
import type { DashboardData } from "@/components/dashboard/dashboard-types";
import { apiJson } from "@shared/http"
import type { Dictionary } from "@/pages";
import type { UiDocument } from "@chrona/ui-protocol";
import { deriveWorkStateView } from "@chrona/domain";

const COPY = {
  title: "Chrona Dashboard",
  subtitle: "At a glance",
  viewAllTasks: "All tasks",
  newTask: "New task",
  openTask: "Open",
  headline: {
    both: "Today Chrona auto-completed {completed} {completedTaskLabel}, and {attentionSubject}.",
    completedOnly: "Today Chrona auto-completed {completed} {completedTaskLabel}. No task needs you right now.",
    attentionOnly: "Nothing auto-completed yet today. {attentionSubject}.",
    completedTask: "task",
    completedTasks: "tasks",
    completedToday: "Completed today",
    attentionTask: "1 task needs you",
    attentionTasks: "{attention} tasks need you",
    idle: "Chrona is ready. Add a task, start work, or review recent activity here.",
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
  focus: { eyebrow: "Focus queue", empty: "No task needs priority focus." },
  attention: {
    title: "Focus queue",
    description: "desc",
    empty: "All clear — no approvals, input requests, blockers, failed runs, or schedule risks need you.",
    kind: {
      approval: "Waiting for approval",
      input: "Waiting for your input",
      blocked: "Blocked",
      failed: "Run failed",
      schedule_risk: "At schedule risk",
    },
  },
  upcomingToday: { title: "Upcoming today", description: "desc", empty: "No more today", open: "Open" },
  inProgress: { title: "Running now", description: "desc", empty: "Nothing is running. Start a task from the schedule or create a new one when you want Chrona to move." },
  completed: { title: "Recent completions", totalLabel: "{n} recent completions shown", empty: "Completed task outputs will collect here once Chrona finishes work." },
  digest: {
    title: "AI summary",
    description: "AI-generated readout.",
    todayHeadline: "{n} tasks auto-completed today",
    weekHeadline: "{n} tasks auto-completed this week",
    allTimeHeadline: "{n} tasks auto-completed all-time",
    rangeToday: "Today",
    rangeWeek: "This week",
    rangeAll: "All time",
    breakdownTitle: "What got done",
    recentTitle: "Recently auto-completed",
    viewAll: "View all completed tasks",
    empty: "AI summary will appear here after Chrona generates it from dashboard facts.",
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
    aiBrief: {
      generating: "AI brief updating",
      dirty: "AI brief ready to update",
      failed: "AI brief update failed",
      unconfigured: "Dashboard AI provider not configured",
      regenerate: "Regenerate",
    },
  },
  feed: {
    title: "Recent activity",
    description: "Latest task events after the AI summary.",
    empty: "No recent task activity yet.",
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
} satisfies Dictionary["pages"]["dashboard"];

function makeData(overrides?: Partial<DashboardData>): DashboardData {
  return {
    generatedAt: new Date().toISOString(),
    focusTask: null,
    needsAttention: [],
    inProgress: [],
    upcomingToday: [],
    autoCompleted: [],
    totalAutoCompleted: 0,
    recentEvents: [],
    aiBrief: null,
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
function stateView(taskStatus: string, executionStatus?: string) {
  return deriveWorkStateView({ taskStatus, executionStatus });
}



function renderDashboard(data: DashboardData = makeData()) {
  return render(<DashboardPage data={data} copy={COPY} workspaceId="workspace-1" />);
}

function generatingAiBrief(): NonNullable<DashboardData["aiBrief"]> {
  return {
    status: "generating",
    spec: null,
    generatedAt: null,
    providerClientId: "client-1",
    canGenerate: false,
    errorMessage: null,
    inputFingerprint: "fingerprint-1",
  };
}

function dirtyAiBrief(): NonNullable<DashboardData["aiBrief"]> {
  return {
    status: "dirty",
    spec: null,
    generatedAt: null,
    providerClientId: "client-1",
    canGenerate: true,
    errorMessage: null,
    inputFingerprint: "fingerprint-1",
  };
}

function failedAiBrief(): NonNullable<DashboardData["aiBrief"]> {
  return {
    status: "failed",
    spec: null,
    generatedAt: null,
    providerClientId: "client-1",
    canGenerate: false,
    errorMessage: "Provider unavailable",
    inputFingerprint: "fingerprint-1",
  };
}

function readyAiBrief(): NonNullable<DashboardData["aiBrief"]> {
  return {
    status: "ready",
    spec: {
      root: "root",
      elements: { root: { type: "Stack", props: { gap: "md" }, children: [] } },
    },
    generatedAt: new Date().toISOString(),
    providerClientId: "client-1",
    canGenerate: true,
    errorMessage: null,
    inputFingerprint: "fingerprint-1",
  };
}

function disabledAiBrief(): NonNullable<DashboardData["aiBrief"]> {
  return {
    status: "disabled",
    spec: null,
    generatedAt: null,
    providerClientId: null,
    canGenerate: false,
    errorMessage: null,
    inputFingerprint: "disabled",
  };
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
              priority: "High",
              kind: "blocked",
              reason: "Waiting",
              stateView: stateView("Blocked"),
              latestOutput: null,
              updatedAt: null,
            },
          ],
        })}
        copy={COPY}
      />,
    );
    expect(screen.getByText("Today Chrona auto-completed 2 tasks, and 1 task needs you.")).toBeTruthy();
  });

  it("uses singular task grammar and leaves task creation to the global action", () => {
    render(
      <DashboardPage
        data={makeData({
          autoCompleted: [
            {
              taskId: "done-1",
              title: "Done",
              completedAt: new Date().toISOString(),
              summary: null,
              category: "report",
              output: null,
            },
          ],
          needsAttention: [],
        })}
        copy={COPY}
      />,
    );

    expect(
      screen.getByText(
        "Today Chrona auto-completed 1 task. No task needs you right now.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New task" })).toBeNull();
  });


  it("summarizes attention by kind in the needs-you card", () => {
    render(
      <DashboardPage
        data={makeData({
          needsAttention: [
            {
              taskId: "t2",
              title: "Stuck task",
              priority: "High",
              kind: "approval",
              reason: "Allow deleting the old branch?",
              stateView: stateView("WaitingForApproval"),
              latestOutput: null,
              updatedAt: null,
            },
          ],
        })}
        copy={COPY}
      />,
    );
    expect(screen.getByText("1 pending")).toBeTruthy();
    expect(screen.getByText("Approval needed")).toBeTruthy();
  });

  it("shows the AI summary placeholder until a generated spec exists", () => {
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

    expect(screen.getByText("AI summary")).toBeTruthy();
    expect(screen.getByText("AI summary will appear here after Chrona generates it from dashboard facts.")).toBeTruthy();
    expect(screen.queryByText("2 tasks auto-completed today")).not.toBeInTheDocument();
    expect(screen.queryByText("Reports generated")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI summary" })).not.toBeInTheDocument();
    expect(screen.queryByText("AI generated")).not.toBeInTheDocument();
  });

  it("labels rendered AI summary specs as AI generated", () => {
    const aiBriefSpec = {
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: "md" }, children: [] },
      },
    } satisfies UiDocument;

    render(
      <DashboardPage
        data={makeData({
          aiBrief: {
            status: "ready",
            spec: aiBriefSpec,
            generatedAt: new Date().toISOString(),
            providerClientId: "client-1",
            canGenerate: true,
            errorMessage: null,
            inputFingerprint: "fingerprint-1",
          },
        })}
        copy={COPY}
      />,
    );

    expect(screen.getByRole("region", { name: "AI summary" })).toHaveAttribute("data-ui-surface-kind", "ai-authored");
    expect(screen.getByText("AI generated")).toBeTruthy();
    expect(screen.getByText("AI brief spec rendered")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Regenerate/ })).toBeTruthy();
  });

  it("shows recent activity below the AI summary area", () => {
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
    expect(screen.getByText("Recent activity")).toBeTruthy();
    expect(screen.getByText("Daily digest")).toBeTruthy();
    expect(screen.getByText(/Produced the daily digest/)).toBeTruthy();
  });

  it("renders attention items directly in needs-you", () => {
    render(
      <DashboardPage
        data={makeData({
          needsAttention: [
            {
              taskId: "s1",
              title: "Blocked task",
              priority: "High",
              kind: "blocked",
              reason: "Waiting on confirmation",
              stateView: stateView("Blocked"),
              latestOutput: null,
              updatedAt: null,
            },
          ],
          autoCompleted: [completed({ taskId: "s2", title: "Done task" })],
        })}
        copy={COPY}
      />,
    );
    expect(screen.getByText("Blocked task")).toBeTruthy();
    expect(screen.getByText("Waiting on confirmation")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Resolve/ })).toHaveAttribute("href", "/en/tasks/s1");
    expect(screen.queryByText("Task stream")).not.toBeInTheDocument();
    expect(screen.getAllByText("Recent completions").length).toBeGreaterThan(0);
  });

  it("shows a spinner while AI summary is generating", () => {
    renderDashboard(makeData({ aiBrief: generatingAiBrief() }));

    expect(screen.getAllByText("AI brief updating").length).toBe(2);
    expect(screen.queryByText("AI summary will appear here after Chrona generates it from dashboard facts.")).not.toBeInTheDocument();
  });

  it("shows provider error when AI summary generation fails", () => {
    renderDashboard(makeData({ aiBrief: failedAiBrief() }));

    expect(screen.getByText("AI brief update failed")).toBeTruthy();
    expect(screen.getByText(/Provider unavailable/)).toBeTruthy();
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("does not auto-request generation when dirty surface cannot generate", async () => {
    renderDashboard(makeData({ aiBrief: { ...dirtyAiBrief(), canGenerate: false } }));

    await waitFor(() => {
      expect(apiJson).not.toHaveBeenCalled();
    });
  });

  it("does not auto-request generation for ready surfaces", async () => {
    renderDashboard(makeData({ aiBrief: readyAiBrief() }));

    await waitFor(() => {
      expect(apiJson).not.toHaveBeenCalled();
    });
  });

  it("hides AI summary when experimental dashboard summary is disabled", async () => {
    renderDashboard(makeData({ aiBrief: disabledAiBrief() }));

    expect(screen.queryByText("AI summary")).not.toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeTruthy();
    await waitFor(() => {
      expect(apiJson).not.toHaveBeenCalled();
    });
  });


  it("lazily requests AI brief generation for dirty surfaces", async () => {
    renderDashboard(makeData({ aiBrief: dirtyAiBrief() }));

    await waitFor(() => {
      expect(apiJson).toHaveBeenCalledWith(
        "/api/pages/dashboard/ai-brief/generate?workspaceId=workspace-1",
        { method: "POST", body: JSON.stringify({ force: false }) },
      );
    });
  });
});
