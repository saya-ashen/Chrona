import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "btn",
}));

vi.mock("@/components/ui/surface-card", () => ({
  SurfaceCard: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardDescription: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" "),
}));

const taskDecompositionPanelProps = vi.fn();
vi.mock("@/components/schedule/task-decomposition-panel", () => ({
  TaskDecompositionPanel: (props: any) => {
    taskDecompositionPanelProps(props);
    return <div data-testid="task-decomposition-panel">task plan graph</div>;
  },
}));

import { TaskAiSidebar } from "@/components/tasks/task-ai-sidebar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  taskDecompositionPanelProps.mockClear();
});

const task = {
  id: "task-1",
  workspaceId: "ws-1",
  title: "Confirm candidacy timeline",
  description: "Draft a concise memo for eligibility and election dates.",
  priority: "High",
  status: "Ready",
  dueAt: "2026-04-20T09:00:00.000Z",
  scheduledStartAt: null,
  scheduledEndAt: null,
  scheduleStatus: "Unscheduled",
  scheduleSource: null,
  isRunnable: false,
  runnabilitySummary: "Needs setup",
  runnabilityState: "missing_prompt",
  ownerType: "human",
} as const;

describe("TaskAiSidebar", () => {
  it("auto-requests a plan only when no saved AI plan exists", () => {
    render(<TaskAiSidebar task={{ ...task, savedAiPlan: null }} />);

    expect(taskDecompositionPanelProps).toHaveBeenCalledWith(
      expect.objectContaining({
        autoRequest: true,
        forceRefresh: true,
      }),
    );
  });

  it("shows saved draft plans without auto-requesting again", () => {
    render(
      <TaskAiSidebar
        task={{
          ...task,
          savedAiPlan: {
            id: "plan-1",
            status: "draft",
            prompt: "prioritize constitutional checks",
            revision: 2,
            summary: "2 planned items",
            updatedAt: "2026-04-19T18:00:00.000Z",
          },
        }}
      />,
    );

    expect(screen.getByText(/当前规划尚未接受/)).toBeInTheDocument();
    expect(screen.getByText(/版本：r2/)).toBeInTheDocument();
    expect(screen.getByText(/2 planned items/)).toBeInTheDocument();
    expect(screen.getByText(/提示词：prioritize constitutional checks/)).toBeInTheDocument();
    expect(taskDecompositionPanelProps).toHaveBeenCalledWith(
      expect.objectContaining({
        autoRequest: false,
        forceRefresh: false,
      }),
    );
  });

  it("renders accepted status copy and replan button for accepted plans", () => {
    render(
      <TaskAiSidebar
        task={{
          ...task,
          savedAiPlan: {
            id: "plan-2",
            status: "accepted",
            prompt: null,
            revision: 4,
            summary: "Accepted graph plan",
            updatedAt: "2026-04-19T18:00:00.000Z",
          },
        }}
      />,
    );

    expect(screen.getByText(/当前规划已接受/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新规划/i })).toBeInTheDocument();
    expect(screen.getByText(/已接受，除非重新规划否则不会自动重跑/)).toBeInTheDocument();
  });

  it("passes edited planning prompt into the planning panel and refreshes on replan", async () => {
    const user = userEvent.setup();
    render(
      <TaskAiSidebar
        task={{
          ...task,
          savedAiPlan: {
            id: "plan-3",
            status: "accepted",
            prompt: "old prompt",
            updatedAt: "2026-04-19T18:00:00.000Z",
          },
        }}
      />,
    );

    const textarea = screen.getByPlaceholderText(/例如：优先考虑法规核查/);
    await user.clear(textarea);
    await user.type(textarea, "new planning guidance");
    await user.click(screen.getByRole("button", { name: /重新规划/i }));

    await waitFor(() => {
      expect(taskDecompositionPanelProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          planningPrompt: "new planning guidance",
          autoRequest: true,
          forceRefresh: true,
        }),
      );
    });
  });

  it("accepts the saved plan after applying the graph plan", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          savedPlan: {
            id: "plan-4",
            status: "accepted",
            prompt: "keep it brief",
            revision: 5,
            summary: "Accepted graph plan",
            updatedAt: "2026-04-19T19:00:00.000Z",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as any);

    render(
      <TaskAiSidebar
        task={{
          ...task,
          savedAiPlan: {
            id: "plan-4",
            status: "draft",
            prompt: "keep it brief",
            updatedAt: "2026-04-19T18:00:00.000Z",
          },
        }}
      />,
    );

    const lastProps = taskDecompositionPanelProps.mock.calls.at(-1)?.[0];
    await lastProps.onApply({
      source: "saved",
      planGraph: {
        id: "plan-4",
        taskId: "task-1",
        status: "draft",
        revision: 4,
        source: "ai",
        generatedBy: "decompose-task",
        prompt: "keep it brief",
        summary: "Accepted graph plan",
        changeSummary: null,
        createdAt: "2026-04-19T18:00:00.000Z",
        updatedAt: "2026-04-19T18:00:00.000Z",
        nodes: [],
        edges: [],
      },
      savedPlan: {
        id: "plan-4",
        status: "draft",
        prompt: "keep it brief",
        revision: 4,
        summary: "Accepted graph plan",
        updatedAt: "2026-04-19T18:00:00.000Z",
      },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "/api/ai/batch-decompose",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/ai/task-plan/accept",
        expect.objectContaining({ method: "POST" }),
      );
    });

    expect(await screen.findByText(/任务规划已接受并应用/)).toBeInTheDocument();
  });

  it("updates saved plan status when planning panel reports a loaded saved plan", async () => {
    render(<TaskAiSidebar task={{ ...task, savedAiPlan: null }} />);

    const lastProps = taskDecompositionPanelProps.mock.calls.at(-1)?.[0];
    fireEvent.click(screen.getByText("task plan graph"));
    lastProps.onPlanLoaded({
      id: "plan-5",
      status: "draft",
      prompt: "saved guidance",
      revision: 3,
      summary: "Graph draft",
      updatedAt: "2026-04-19T18:05:00.000Z",
    });

    expect(await screen.findByText(/当前规划尚未接受/)).toBeInTheDocument();
  });
});
