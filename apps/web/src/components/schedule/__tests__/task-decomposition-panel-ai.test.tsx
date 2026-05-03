import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

const mockUseSmartDecomposition = vi.fn();

vi.mock("@/hooks/use-ai", () => ({
  useSmartDecomposition: (...args: unknown[]) => mockUseSmartDecomposition(...args),
}));

import { TaskDecompositionPanel } from "@/components/schedule/task-planning-panel";
import type { TaskPlanGraphResponse } from "@/modules/ai/types";

const defaultProps = {
  taskId: "task_1",
  title: "Review and update documentation",
  description: "Go through all docs and update them",
  priority: "High",
  dueAt: new Date(2026, 3, 20),
  estimatedMinutes: 120,
  onApply: vi.fn(),
  activeAcceptedPlanId: null,
};

const samplePlanResponse: TaskPlanGraphResponse = {
  source: "saved",
  planGraph: {
    id: "plan-1",
    taskId: "task_1",
    status: "draft",
    revision: 2,
    source: "ai",
    generatedBy: "generate-task-plan",
    prompt: null,
    summary: "3 planned nodes",
    changeSummary: null,
    createdAt: "2026-04-20T09:00:00.000Z",
    updatedAt: "2026-04-20T09:05:00.000Z",
    nodes: [
      {
        id: "node-1",
        type: "task",
        title: "Review existing documentation",
        objective: "Read through all current docs and note outdated sections",
        description: "Read through all current docs and note outdated sections",
        status: "in_progress",
        phase: "execution",
        estimatedMinutes: 40,
        priority: "High",
        executionMode: "automatic",
        linkedTaskId: null,
        requiresHumanInput: false,
        requiresHumanApproval: false,
        autoRunnable: true,
        blockingReason: null,
        completionSummary: null,
        metadata: null,
      },
      {
        id: "node-2",
        type: "task",
        title: "Update API reference",
        objective: "Refresh endpoint descriptions and examples",
        description: "Refresh endpoint descriptions and examples",
        status: "pending",
        phase: "delivery",
        estimatedMinutes: 50,
        priority: "High",
        executionMode: "automatic",
        linkedTaskId: null,
        requiresHumanInput: false,
        requiresHumanApproval: false,
        autoRunnable: true,
        blockingReason: null,
        completionSummary: null,
        metadata: null,
      },
      {
        id: "node-3",
        type: "checkpoint",
        title: "Update deployment guide",
        objective: "Revise deployment steps for v2.1",
        description: "Revise deployment steps for v2.1",
        status: "pending",
        phase: "review",
        estimatedMinutes: 30,
        priority: "Medium",
        executionMode: "manual",
        linkedTaskId: null,
        requiresHumanInput: false,
        requiresHumanApproval: false,
        autoRunnable: false,
        blockingReason: null,
        completionSummary: null,
        metadata: null,
      },
    ],
    edges: [
      { id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2", type: "sequential", metadata: null },
      { id: "edge-2", fromNodeId: "node-2", toNodeId: "node-3", type: "depends_on", metadata: null },
    ],
  },
  savedPlan: {
    id: "plan-1",
    status: "draft",
    prompt: null,
    revision: 2,
    summary: "3 planned nodes",
    updatedAt: "2026-04-20T09:05:00.000Z",
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

describe("TaskDecompositionPanel – opt-in behavior", () => {
  it("renders the planning panel expanded and checks status without requesting a plan when autoRequest is disabled", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
      phase: "idle",
      statusMessage: null,
      partialText: "",
      toolCalls: [],
      toolResults: [],
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    expect(screen.getByText(/AI Task Planning/i)).toBeInTheDocument();
    expect(screen.getByText(/No plan yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate plan/i })).toBeInTheDocument();
    expect(mockUseSmartDecomposition).toHaveBeenCalledWith(null);
  });

  it("renders the saved plan passed from the task instead of replacing it with an empty status panel", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
      phase: "idle",
      statusMessage: null,
      partialText: "",
      toolCalls: [],
      toolResults: [],
    });

    render(
      <TaskDecompositionPanel
        {...defaultProps}
        savedPlan={{
          ...samplePlanResponse.savedPlan!,
          plan: samplePlanResponse.planGraph,
        }}
      />,
    );

    expect(mockUseSmartDecomposition).toHaveBeenCalledWith(null);
    expect(screen.queryByText(/No plan yet/i)).not.toBeInTheDocument();
    expect(screen.getByText("AI Task Planning")).toBeInTheDocument();
    expect(screen.getByLabelText("任务计划图")).toBeInTheDocument();
    expect(screen.getAllByText("Review existing documentation").length).toBeGreaterThan(0);
    expect(screen.getByText("120 min")).toBeInTheDocument();
  });

  it("shows backend generation state when the task already has an active plan job", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
      phase: "idle",
      statusMessage: null,
      partialText: "",
      toolCalls: [],
      toolResults: [],
    });

    render(<TaskDecompositionPanel {...defaultProps} generationStatus="generating" />);

    expect(mockUseSmartDecomposition).toHaveBeenCalledWith(null);
    expect(screen.getByText(/AI Task Planning/i)).toBeInTheDocument();
    expect(screen.getByText(/AI is planning task/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });


  it("notifies the parent only for newly generated hook plans, not empty polling results or the incoming savedPlan prop", async () => {
    const onPlanLoaded = vi.fn();
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
      phase: "idle",
      statusMessage: null,
      partialText: "",
      toolCalls: [],
      toolResults: [],
    });

    const { rerender } = render(
      <TaskDecompositionPanel
        {...defaultProps}
        savedPlan={{
          ...samplePlanResponse.savedPlan!,
          plan: samplePlanResponse.planGraph,
        }}
        onPlanLoaded={onPlanLoaded}
      />,
    );

    await waitFor(() => expect(screen.getByText("AI Task Planning")).toBeInTheDocument());
    expect(onPlanLoaded).not.toHaveBeenCalled();

    const regeneratedResponse: TaskPlanGraphResponse = {
      ...samplePlanResponse,
      planGraph: {
        ...samplePlanResponse.planGraph,
        id: "plan-2",
        summary: "new generated plan",
        revision: 3,
        updatedAt: "2026-04-25T12:00:00.000Z",
      },
      savedPlan: {
        id: "plan-2",
        status: "draft",
        prompt: null,
        revision: 3,
        summary: "new generated plan",
        updatedAt: "2026-04-25T12:00:00.000Z",
      },
    };

    mockUseSmartDecomposition.mockReturnValue({
      result: regeneratedResponse,
      isLoading: false,
      error: null,
      phase: "done",
      statusMessage: null,
      partialText: "",
      toolCalls: [],
      toolResults: [],
    });

    rerender(
      <TaskDecompositionPanel
        {...defaultProps}
        savedPlan={{
          ...samplePlanResponse.savedPlan!,
          plan: samplePlanResponse.planGraph,
        }}
        onPlanLoaded={onPlanLoaded}
      />,
    );

    await waitFor(() => expect(onPlanLoaded).toHaveBeenCalledTimes(1));
    expect(onPlanLoaded).toHaveBeenCalledWith(expect.objectContaining({
      id: "plan-2",
      status: "draft",
      plan: expect.objectContaining({
        id: "plan-2",
        summary: "new generated plan",
      }),
    }));
  });

  it("requests plan generation after clicking the generate action", async () => {
    const user = userEvent.setup();
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
      phase: "idle",
      statusMessage: null,
      partialText: "",
      toolCalls: [],
      toolResults: [],
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: /Generate plan/i }));

    expect(mockUseSmartDecomposition).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task_1",
      title: "Review and update documentation",
      description: "Go through all docs and update them",
      priority: "High",
      dueAt: new Date(2026, 3, 20),
      estimatedMinutes: 120,
      requestKey: 1,
      forceRefresh: true,
    }));
  });
});

describe("TaskDecompositionPanel – autoRequest mode", () => {
  it("immediately requests plan generation with autoRequest=true", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: true,
      error: null,
      phase: "thinking",
      statusMessage: null,
      partialText: "",
      toolCalls: [],
      toolResults: [],
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText(/AI Task Planning/i)).toBeInTheDocument();
    expect(mockUseSmartDecomposition).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task_1",
      title: "Review and update documentation",
      description: "Go through all docs and update them",
      priority: "High",
      dueAt: new Date(2026, 3, 20),
      estimatedMinutes: 120,
      requestKey: 0,
    }));
  });

  it("shows loading skeleton when isLoading is true", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: true,
      error: null,
      phase: "thinking",
      statusMessage: null,
      partialText: "",
      toolCalls: [],
      toolResults: [],
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText(/AI is planning task/i)).toBeInTheDocument();
  });

  it("shows a stop action while plan generation is running", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: true,
      error: null,
      phase: "thinking",
      statusMessage: "Generating with current task context",
      partialText: "",
      toolCalls: [],
      toolResults: [],
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("calls the stop endpoint from the running generation state", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ taskId: "task_1", stopped: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchSpy);
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: true,
      error: null,
      phase: "thinking",
      statusMessage: "Generating with current task context",
      partialText: "",
      toolCalls: [],
      toolResults: [],
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    await user.click(screen.getByRole("button", { name: /stop/i }));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/generate-task-plan/stop",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ taskId: "task_1" }),
      }),
    );
  });

  it("shows streaming process details instead of only a blank waiting skeleton", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: true,
      error: null,
      phase: "streaming",
      statusMessage: "Planning graph",
      partialText: "Thinking through task decomposition...",
      toolCalls: [{ tool: "generate_task_plan_graph", input: { title: "Plan task" } }],
      toolResults: [{ tool: "generate_task_plan_graph", result: "validated" }],
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getAllByText("Planning graph").length).toBeGreaterThan(0);
    expect(screen.getByText(/Thinking through task decomposition/i)).toBeInTheDocument();
    expect(screen.getAllByText(/generate_task_plan_graph/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/validated/i)).toBeInTheDocument();
  });

  it("shows error state when error is set", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: "Network timeout",
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText("Failed to plan task: Network timeout")).toBeInTheDocument();
  });

  it("renders graph-only planning UI when result is available", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: samplePlanResponse,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText("AI Task Planning")).toBeInTheDocument();
    expect(screen.getByLabelText("任务计划图")).toBeInTheDocument();
    expect(screen.getAllByText("Review existing documentation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Update API reference").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Update deployment guide").length).toBeGreaterThan(0);
    expect(screen.getByText("120 min")).toBeInTheDocument();
    expect(screen.getByText("3 nodes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply plan/i })).toBeInTheDocument();
  });

  it("Apply button calls onApply with the graph response", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    mockUseSmartDecomposition.mockReturnValue({
      result: samplePlanResponse,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest onApply={onApply} />);

    await user.click(screen.getByRole("button", { name: /apply plan/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(samplePlanResponse);
  });

  it("keeps regenerate visible but hides the drafted graph and apply action once that plan is already accepted", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: samplePlanResponse,
      isLoading: false,
      error: null,
    });

    render(
      <TaskDecompositionPanel
        {...defaultProps}
        autoRequest
        activeAcceptedPlanId={samplePlanResponse.savedPlan?.id ?? null}
      />,
    );

    expect(screen.getByRole("button", { name: /regenerate plan/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("任务计划图")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply plan/i })).not.toBeInTheDocument();
    expect(screen.getByText(/active in main panel/i)).toBeInTheDocument();
  });

  it("does not automatically re-request just because the parent props change after a save", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: samplePlanResponse,
      isLoading: false,
      error: null,
    });

    const { rerender } = render(<TaskDecompositionPanel {...defaultProps} autoRequest />);
    rerender(
      <TaskDecompositionPanel
        {...defaultProps}
        title="Updated saved task title"
        description="Updated saved task description"
        autoRequest
      />,
    );

    expect(mockUseSmartDecomposition.mock.calls.at(-1)?.[0]).toMatchObject({
      title: "Review and update documentation",
      description: "Go through all docs and update them",
      requestKey: 0,
    });
  });

  it("opens a save confirmation instead of regenerating immediately when unsaved config exists", async () => {
    const user = userEvent.setup();

    mockUseSmartDecomposition.mockReturnValue({
      result: samplePlanResponse,
      isLoading: false,
      error: null,
    });

    render(
      <TaskDecompositionPanel
        {...defaultProps}
        autoRequest
        hasUnsavedConfigChanges
        unsavedConfigDraft={{
          title: "Updated draft task title",
          description: "Updated draft task description",
          priority: "Urgent",
          dueAt: new Date(2026, 3, 21, 13, 0),
        }}
      />,
    );

    const beforeCalls = mockUseSmartDecomposition.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /regenerate plan/i }));

    const callsAfterClick = mockUseSmartDecomposition.mock.calls.slice(beforeCalls);
    expect(callsAfterClick.map((call) => call[0])).not.toContainEqual(expect.objectContaining({
      requestKey: 1,
      forceRefresh: true,
    }));
    expect(screen.getByRole("dialog", { name: /save changes before regenerating/i })).toBeInTheDocument();
    expect(screen.getByText(/you have unsaved task configuration changes/i)).toBeInTheDocument();
  });

  it("saves unsaved config and regenerates from the saved draft when the confirmation is accepted", async () => {
    const user = userEvent.setup();
    const onSaveConfigBeforeRegenerate = vi.fn().mockResolvedValue(undefined);

    mockUseSmartDecomposition.mockReturnValue({
      result: samplePlanResponse,
      isLoading: false,
      error: null,
    });

    render(
      <TaskDecompositionPanel
        {...defaultProps}
        autoRequest
        hasUnsavedConfigChanges
        unsavedConfigDraft={{
          title: "Updated draft task title",
          description: "Updated draft task description",
          priority: "Urgent",
          dueAt: new Date(2026, 3, 21, 13, 0),
        }}
        onSaveConfigBeforeRegenerate={onSaveConfigBeforeRegenerate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /regenerate plan/i }));
    await user.click(screen.getByRole("button", { name: /save and regenerate/i }));

    expect(onSaveConfigBeforeRegenerate).toHaveBeenCalledOnce();
    expect(mockUseSmartDecomposition.mock.calls.at(-1)?.[0]).toMatchObject({
      taskId: "task_1",
      title: "Updated draft task title",
      description: "Updated draft task description",
      priority: "Urgent",
      requestKey: 1,
      forceRefresh: true,
    });
  });

  it("renders warnings when present", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: {
        ...samplePlanResponse,
        planGraph: {
          ...samplePlanResponse.planGraph,
          nodes: [
            {
              ...samplePlanResponse.planGraph.nodes[0]!,
              metadata: {
                autoRunnable: true,
                warnings: ["Due date is soon", "Requires stakeholder review"],
              },
            },
            ...samplePlanResponse.planGraph.nodes.slice(1),
          ],
        },
      },
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText("Due date is soon")).toBeInTheDocument();
    expect(screen.getByText("Requires stakeholder review")).toBeInTheDocument();
  });

  it("reports saved-plan metadata through onPlanLoaded", async () => {
    const onPlanLoaded = vi.fn();

    mockUseSmartDecomposition.mockReturnValue({
      result: samplePlanResponse,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest onPlanLoaded={onPlanLoaded} />);

    await waitFor(() => {
      expect(onPlanLoaded).toHaveBeenCalledWith({
        ...samplePlanResponse.savedPlan,
        plan: samplePlanResponse.planGraph,
      });
    });
  });
});
