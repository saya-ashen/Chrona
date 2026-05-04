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

const dataWithEnrichedPlan = {
  ...data,
  task: {
    ...data.task,
    savedAiPlan: {
      id: "plan-enriched",
      status: "accepted" as const,
      prompt: "with enriched metadata",
      revision: 3,
      summary: "3 planned steps",
      updatedAt: "2026-04-20T10:00:00.000Z",
      plan: {
        id: "plan-enriched",
        taskId: "task-1",
        status: "accepted" as const,
        revision: 3,
        source: "ai" as const,
        generatedBy: "openclaw",
        prompt: "with enriched metadata",
        summary: "3 planned steps",
        changeSummary: null,
        createdAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        nodes: [
          {
            id: "n1",
            type: "task",
            title: "Research competitors",
            objective: "Gather competitive intelligence",
            description: null,
            status: "done" as const,
            phase: "research",
            estimatedMinutes: 30,
            priority: "High",
            executionMode: "automatic" as const,
            linkedTaskId: null,
            requiresHumanInput: false,
            requiresHumanApproval: false,
            autoRunnable: true,
            blockingReason: null,
            executionClassification: "automatic_standalone",
            readiness: "ready",
            nextAction: "Ready to auto-start",
            dependencies: [],
          },
          {
            id: "n2",
            type: "task",
            title: "Draft report outline",
            objective: "Create report structure",
            description: null,
            status: "pending" as const,
            phase: "drafting",
            estimatedMinutes: 45,
            priority: "Medium",
            executionMode: "automatic" as const,
            linkedTaskId: null,
            requiresHumanInput: false,
            requiresHumanApproval: true,
            autoRunnable: false,
            blockingReason: null,
            executionClassification: "review_gate",
            readiness: "waiting",
            nextAction: "Review and approve this step's output before continuing",
            dependencies: ["n1"],
          },
          {
            id: "n3",
            type: "task",
            title: "Collect user requirements",
            objective: "Get input from stakeholder",
            description: null,
            status: "pending" as const,
            phase: "input",
            estimatedMinutes: 20,
            priority: "Urgent",
            executionMode: "hybrid" as const,
            linkedTaskId: null,
            requiresHumanInput: true,
            requiresHumanApproval: false,
            autoRunnable: false,
            blockingReason: null,
            executionClassification: "human_dependent",
            readiness: "blocked",
            nextAction: "Provide required information to proceed",
            dependencies: [],
            requiredInfo: ["target audience", "preferred format"],
          },
        ],
        edges: [
          { id: "e1", fromNodeId: "n1", toNodeId: "n2", type: "sequential" },
        ],
      },
    },
  },
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

  it("renders enriched plan node details (executionClassification, readiness, nextAction)", () => {
    render(<TaskPage data={dataWithEnrichedPlan as any} />);

    expect(screen.getByText("Research competitors")).toBeInTheDocument();
    expect(screen.getByText("Draft report outline")).toBeInTheDocument();
    expect(screen.getByText("Collect user requirements")).toBeInTheDocument();

    expect(screen.getByText("automatic_standalone")).toBeInTheDocument();
    expect(screen.getByText("review_gate")).toBeInTheDocument();
    expect(screen.getByText("human_dependent")).toBeInTheDocument();

    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText("waiting")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();

    expect(screen.getByText("Ready to auto-start")).toBeInTheDocument();
    expect(screen.getByText("Review and approve this step's output before continuing")).toBeInTheDocument();
    expect(screen.getByText("Provide required information to proceed")).toBeInTheDocument();
  });
});
