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
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

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

const sampleCompiledPlan = {
  id: "compiled-plan-1",
  editablePlanId: "plan-1",
  sourceVersion: 2,
  title: "Test Plan",
  goal: "Test goal",
  assumptions: [],
  nodes: [
    {
      id: "node-1",
      localId: "node-1",
      type: "task" as const,
      title: "Review existing documentation",
      description: "Read through all current docs and note outdated sections",
      priority: "High" as const,
      config: { expectedOutput: "Review existing documentation" },
      dependencies: [] as string[],
      dependents: ["node-2"] as string[],
      executor: "ai" as const,
      mode: "auto" as const,
      estimatedMinutes: 40,
    },
    {
      id: "node-2",
      localId: "node-2",
      type: "task" as const,
      title: "Update API reference",
      description: "Refresh endpoint descriptions and examples",
      priority: "High" as const,
      config: { expectedOutput: "Update API reference" },
      dependencies: ["node-1"] as string[],
      dependents: ["node-3"] as string[],
      executor: "ai" as const,
      mode: "auto" as const,
      estimatedMinutes: 50,
    },
    {
      id: "node-3",
      localId: "node-3",
      type: "checkpoint" as const,
      title: "Update deployment guide",
      description: "Revise deployment steps for v2.1",
      priority: "Medium" as const,
      config: { checkpointType: "confirm", prompt: "Review deployment steps", required: true },
      dependencies: ["node-2"] as string[],
      dependents: [] as string[],
      executor: "user" as const,
      mode: "manual" as const,
      estimatedMinutes: 30,
    },
  ],
  edges: [
    { id: "edge-1", from: "node-1", to: "node-2", label: "sequential" },
    { id: "edge-2", from: "node-2", to: "node-3", label: "depends_on" },
  ],
  entryNodeIds: ["node-1"] as string[],
  terminalNodeIds: ["node-3"] as string[],
  topologicalOrder: ["node-1", "node-2", "node-3"] as string[],
  completionPolicy: { type: "all_tasks_completed" as const },
  validationWarnings: [] as Array<{ path: string; message: string }>,
};

const sampleReadModel: TaskPlanReadModel = {
  id: "plan-1",
  status: "draft",
  revision: 2,
  prompt: null,
  summary: "3 planned nodes",
  updatedAt: "2026-04-20T09:05:00.000Z",
  generatedBy: "generate-task-plan",
  blueprint: {
    title: "Test Plan",
    goal: "Test goal",
    assumptions: [],
    nodes: [],
    edges: [],
  },
  compiledPlan: sampleCompiledPlan,
  effectivePlan: {
    planId: "plan-1",
    basePlanId: "compiled-plan-1",
    resolvedVersion: 1,
    nodes: [],
    edges: [],
    entryNodeIds: ["node-1"],
    terminalNodeIds: ["node-3"],
    readyNodeIds: [],
    blockedNodeIds: [],
    completedNodeIds: [],
    runningNodeIds: [],
    failedNodeIds: [],
    pendingNodeIds: ["node-1", "node-2", "node-3"],
  },
};

function createSseResponse(events: Array<{ event: string; data: unknown }>) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(
              `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
            ),
          );
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
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
          ...sampleReadModel,
          status: "draft",
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
          { event: "result", data: { type: "result", result: sampleReadModel } },
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
