import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

import { TaskPlanGenerationPanel } from "@/components/task/ai/task-plan-generation-panel";
import type { CompiledPlan } from "@chrona/contracts/ai";

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

const sampleResult = {
  plan: { title: "Test Plan", goal: "Test goal", nodes: [], edges: [] },
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

function createSseResponse(events: Array<{ event: string; data: unknown }>) {
  const encoder = new TextEncoder();
  const chunks = events.map((event) =>
    encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`),
  );
  let index = 0;

  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) {
              return { done: true, value: undefined };
            }

            const value = chunks[index];
            index += 1;
            return { done: false, value };
          },
        };
      },
    },
    json: async () => ({}),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("TaskPlanGenerationPanel", () => {
  it("shows empty state and does not request a plan when autoRequest is disabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<TaskPlanGenerationPanel {...defaultProps} />);

    expect(screen.getByText(/No plan yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate plan/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders an incoming saved plan without requesting generation", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <TaskPlanGenerationPanel
        {...defaultProps}
        savedPlan={{
          ...sampleResult.savedPlan,
          status: sampleResult.savedPlan.status as "draft",
          plan: sampleResult.planGraph as unknown as CompiledPlan,
        }}
      />,
    );

    expect(screen.queryByText(/No plan yet/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("任务计划图")).toBeInTheDocument();
    expect(screen.getAllByText("Review existing documentation").length).toBeGreaterThan(0);
    expect(screen.getByText("120 min")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows generation state from the task while a backend job is active", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<TaskPlanGenerationPanel {...defaultProps} generationStatus="generating" />);

    expect(screen.getByText(/AI is planning task/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests a new plan on click and forwards the generated saved plan", async () => {
    const onPlanLoaded = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      createSseResponse([
        { event: "status", data: { message: "Thinking" } },
        { event: "partial", data: { text: "Drafting steps" } },
        { event: "result", data: sampleResult },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const user = userEvent.setup();
    render(<TaskPlanGenerationPanel {...defaultProps} onPlanLoaded={onPlanLoaded} />);

    await user.click(screen.getByRole("button", { name: /Generate plan/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks/task_1/plan/generate",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Accept: "text/event-stream" }),
        }),
      );
    });

    await waitFor(() => {
      expect(onPlanLoaded).toHaveBeenCalledWith(
        expect.objectContaining({ id: "plan-1", summary: "3 planned nodes" }),
      );
    });

    expect(screen.getByLabelText("任务计划图")).toBeInTheDocument();
    expect(screen.getByText("Review existing documentation")).toBeInTheDocument();
  });

  it("stops an active generation job", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const user = userEvent.setup();

    render(<TaskPlanGenerationPanel {...defaultProps} generationStatus="generating" />);

    await user.click(screen.getByRole("button", { name: /stop/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks/task_1/plan/generate/stop",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
