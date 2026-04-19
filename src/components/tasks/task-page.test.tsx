import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" "),
}));

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "btn",
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/surface-card", () => ({
  SurfaceCard: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardDescription: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock("@/components/tasks/task-ai-sidebar", () => ({
  TaskAiSidebar: ({ task }: any) => <div data-testid="task-ai-sidebar">sidebar for {task.title}</div>,
}));

import { TaskPage } from "@/components/tasks/task-page";

afterEach(cleanup);

const data = {
  task: {
    id: "task-1",
    workspaceId: "ws-1",
    title: "Finish AI task detail redesign",
    description: "Move AI controls into the sidebar.",
    runtimeModel: "gpt-5.4",
    prompt: "Do the thing",
    runtimeConfig: { approvalPolicy: "never" },
    status: "Ready",
    priority: "High",
    dueAt: "2026-04-20T09:00:00.000Z",
    scheduledStartAt: "2026-04-19T13:00:00.000Z",
    scheduledEndAt: "2026-04-19T14:00:00.000Z",
    scheduleStatus: "Scheduled",
    scheduleSource: "ai",
    isRunnable: true,
    runnabilitySummary: "Ready to run",
    runnabilityState: "ready",
    ownerType: "human",
    savedAiPlan: {
      id: "plan-1",
      status: "draft",
      prompt: "focus on shipping",
      revision: 2,
      summary: "2 planned items",
      updatedAt: "2026-04-19T18:00:00.000Z",
    },
    blockReason: null,
    dependencies: [],
  },
  latestRunSummary: null,
  scheduleProposals: [],
  approvals: [],
  artifacts: [],
};

describe("TaskPage", () => {
  it("renders the AI sidebar alongside the task content", () => {
    render(<TaskPage data={data as any} />);

    expect(screen.getByTestId("task-ai-sidebar")).toBeInTheDocument();
    expect(screen.getByText("sidebar for Finish AI task detail redesign")).toBeInTheDocument();
    expect(screen.getByText("Finish AI task detail redesign")).toBeInTheDocument();
  });

  it("keeps runtime configuration in the main content column", () => {
    render(<TaskPage data={data as any} />);

    expect(screen.getByText("Runtime configuration")).toBeInTheDocument();
    expect(screen.getByText("Planning context")).toBeInTheDocument();
  });
});
