import "@testing-library/jest-dom/vitest";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import en from "@chrona/i18n/messages/en.json";
import {
  derivePreferredGraphMode,
  recoveryActionButtonVariant,
  TaskWorkspacePlanSection,
} from "./task-workspace-plan-section";

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class ELKMock {
    layout(graph: unknown) {
      return Promise.resolve(graph);
    }
  },
}));

const continueFromTaskResultMock = vi.fn();

vi.mock("../model/task-actions-client", () => ({
  continueFromTaskResult: (...args: unknown[]) =>
    continueFromTaskResultMock(...args),
}));

vi.mock("../panels/task-plan-graph-panel", () => ({
  TaskPlanGraphPanel: ({
    plan,
    mode,
    fillHeight,
    onSelectedNodeChange,
  }: {
    plan: {
      nodes: Array<{
        id: string;
        title: string;
        objective?: string;
        status?: string;
      }>;
    };
    mode?: "full" | "compact";
    fillHeight?: boolean;
    onSelectedNodeChange?: (
      node: { id: string; title: string; objective?: string; status?: string },
      nodes: Array<{
        id: string;
        title: string;
        objective?: string;
        status?: string;
      }>,
    ) => void;
  }) => (
    <div
      data-testid="task-plan-graph-panel"
      data-graph-mode={mode ?? "full"}
      data-fill-height={fillHeight ? "true" : "false"}
    >
      {plan.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          className="react-flow__node"
          data-testid={`task-plan-node-${node.id}`}
          onClick={() => onSelectedNodeChange?.(node, plan.nodes)}
        >
          {node.title}
        </button>
      ))}
    </div>
  ),
}));

import type { TaskPlanReadModel } from "@chrona/contracts";
import {
  createTaskWorkspaceFixtureGraph,
  createTaskWorkspaceFixtureNode,
  createTaskWorkspaceFixturePageData,
} from "../test-support/task-workspace-test-fixtures";

const checkpoint = {
  id: "run-1:checkpoint:user_input",
  taskId: "task-1",
  sessionId: "session-1",
  planRunId: "run-1",
  nodeId: "checkpoint",
  kind: "user_input" as const,
  title: "Action required",
  message: "Continue node",
  severity: "info" as const,
  availableActions: [],
  createdAt: "2026-05-21T00:00:00.000Z",
};

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/en/tasks/task-1"]}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </MemoryRouter>
    ),
  });
}

vi.mock("@chrona/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@chrona/i18n")>();
  return {
    ...actual,
    useI18n: () => ({ locale: "en", messages: en, t: (key: string) => key }),
    useLocale: () => "en",
  };
});

beforeAll(() => {
  class ResizeObserverMock {
    observe(target?: Element) {
      if (target) {
        Object.defineProperty(target, "clientWidth", {
          configurable: true,
          value: 960,
        });
      }
    }
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

beforeEach(() => {
  continueFromTaskResultMock.mockReset();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ generationSession: null }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("derivePreferredGraphMode", () => {
  it.each([
    {
      name: "generating keeps full graph",
      currentMode: "compact" as const,
      isGeneratingPlan: true,
      hasGraphExecutionStarted: true,
      hasTaskCompleted: false,
      expected: "full",
    },
    {
      name: "running switches to compact",
      currentMode: "full" as const,
      isGeneratingPlan: false,
      hasGraphExecutionStarted: true,
      hasTaskCompleted: false,
      expected: "compact",
    },
    {
      name: "completed switches to compact",
      currentMode: "full" as const,
      isGeneratingPlan: false,
      hasGraphExecutionStarted: false,
      hasTaskCompleted: true,
      expected: "compact",
    },
    {
      name: "idle keeps current mode",
      currentMode: "full" as const,
      isGeneratingPlan: false,
      hasGraphExecutionStarted: false,
      hasTaskCompleted: false,
      expected: "full",
    },
  ])("$name", ({ expected, ...input }) => {
    expect(derivePreferredGraphMode(input)).toBe(expected);
  });
});

describe("recoveryActionButtonVariant", () => {
  it.each([
    ["retry_sync", "default"],
    ["repair_inconsistency", "default"],
    ["replan_from_node", "default"],
    ["cancel_execution", "destructive"],
    ["cancel", "destructive"],
  ] as const)("maps %s recovery action", (actionType, variant) => {
    expect(recoveryActionButtonVariant(actionType)).toBe(variant);
  });
});

describe("TaskWorkspacePlanSection", () => {
  it("keeps graph and command center in sync across create, accept, and run", async () => {
    const onGeneratePlan = vi.fn();
    const onApplyPlan = vi.fn().mockResolvedValue(undefined);
    const onDispatchExecutionAction = vi
      .fn()
      .mockResolvedValue({ message: "Started" });
    const draftPlan = {
      id: "plan-1",
      status: "draft",
      revision: 1,
      prompt: "Generate a focused plan.",
      updatedAt: "2026-05-18T00:00:00.000Z",
    } as TaskPlanReadModel;
    const acceptedPlan = {
      ...draftPlan,
      status: "accepted",
      updatedAt: "2026-05-18T00:00:01.000Z",
    } as TaskPlanReadModel;
    const generatedNode = createTaskWorkspaceFixtureNode({
      id: "generate",
      title: "Generated plan node",
      status: "ready",
      nextAction: "Start execution",
    });
    const runningNode = createTaskWorkspaceFixtureNode({
      id: "generate",
      title: "Generated plan node",
      status: "active",
      nextAction: "Monitor execution",
    });
    const waitingNode = createTaskWorkspaceFixtureNode({
      id: "checkpoint",
      title: "Review generated output",
      status: "waiting_for_user",
      nextAction: "Provide checkpoint input",
      requiresHumanInput: true,
      checkpoint,
      availableActions: [
        {
          id: "submit_input",
          label: "Submit input",
          kind: "input",
          emphasis: "primary",
          checkpointId: checkpoint.id,
          checkpointAction: "submit_input",
        },
      ],
      interactiveFields: [
        {
          key: "decision",
          label: "Decision",
          value: "",
          control: "text",
          required: true,
        },
      ],
    });

    const mount = (ui: ReactElement) => renderWithQueryClient(ui);

    const initial = mount(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([])}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={null}
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={onApplyPlan}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );
    const getOperationPanel = () =>
      screen.getAllByRole("region", { name: "Current operation" }).at(-1)!;
    expect(screen.getByTestId("plan-setup-panel")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Execution flow" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(onGeneratePlan).toHaveBeenCalledTimes(1);

    initial.rerender(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([generatedNode], "generate")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: {
            savedPlan: draftPlan,
            aiPlanGenerationStatus: "waiting_acceptance",
          },
        })}
        plan={draftPlan}
        planGenerationStatus="waiting_acceptance"
        canAcceptPlan
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={onApplyPlan}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Generated plan node/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Generated plan node/ }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Selected node details" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onApplyPlan).toHaveBeenCalledWith(draftPlan));

    const accepted = mount(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([generatedNode], "generate")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: { savedPlan: acceptedPlan, aiPlanGenerationStatus: "accepted" },
        })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={onApplyPlan}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );
    const launchPanel = screen.getByRole("complementary", {
      name: "Run launch controls",
    });
    expect(
      within(launchPanel).getByText(
        "Plan accepted. Execution has not started, and nothing runs until you start it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Accepted plan" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No execution result yet."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Current operation" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(launchPanel).getByRole("button", { name: "Start run" }),
    );
    expect(onDispatchExecutionAction).toHaveBeenCalledWith({
      action: "start_manual",
    });
    expect(
      screen.getAllByRole("button", { name: /Generated plan node/ }).length,
    ).toBeGreaterThan(0);

    const stoppedNode = createTaskWorkspaceFixtureNode({
      id: "generate",
      title: "Generated plan node",
      status: "cancelled",
      nextAction: "Continue execution",
    });
    accepted.rerender(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([stoppedNode], "generate")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: {
            savedPlan: acceptedPlan,
            aiPlanGenerationStatus: "accepted",
            executionSummary: {
              taskId: "task-1",
              executionState: "cancelled",
              stateLabel: "Waiting",
              stateReason: null,
              graphVersion: 1,
              currentNodeId: "generate",
              primaryAction: { type: "start", enabled: true, label: "Start" },
              progress: { completed: 0, total: 1, percent: 0 },
              readiness: { runnable: true, reason: null },
              degraded: null,
              blocking: null,
              waiting: null,
              recoveryActions: [],
            },
          },
        })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={onApplyPlan}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );
    expect(
      within(getOperationPanel()).getByRole("button", {
        name: "Continue plan",
      }),
    ).toBeInTheDocument();
    expect(
      within(getOperationPanel()).getByRole("button", {
        name: "Restart from beginning",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(getOperationPanel()).getByRole("button", {
        name: "Restart from beginning",
      }),
    );
    expect(onDispatchExecutionAction).toHaveBeenCalledWith({
      action: "restart_from_beginning",
    });

    accepted.rerender(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph(
          [runningNode, waitingNode],
          "checkpoint",
        )}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: {
            savedPlan: acceptedPlan,
            aiPlanGenerationStatus: "accepted",
            status: "WaitingForInput",
          },
        })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[
          {
            type: "runtime_event",
            action: "start_manual",
            runtimeName: "local",
            provider: "provider",
            event: {
              type: "tool_started",
              toolName: "chrona_execution_dispatch",
              label: "Starting plan",
            },
          },
        ]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={onApplyPlan}
        onDispatchExecutionAction={onDispatchExecutionAction}
        onSubmitCheckpointAction={vi.fn()}
      />,
    );
    expect(
      within(getOperationPanel()).getByLabelText(/Decision/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("execution-focus-header")).toHaveTextContent(
      "Review generated output",
    );
    expect(screen.getByTestId("current-runtime-activity")).toHaveTextContent(
      "Starting plan",
    );
    expect(
      screen.getByRole("region", { name: "Live output" }),
    ).toHaveTextContent("Awaiting output");
    expect(screen.getByTestId("execution-navigator")).toHaveTextContent(
      "steps complete",
    );
    expect(
      screen.queryByTestId("task-plan-graph-panel"),
    ).not.toBeInTheDocument();
  });

  it("separates the inspected step from the current execution step", () => {
    const acceptedPlan = {
      id: "plan-running",
      status: "accepted",
      revision: 1,
      updatedAt: "2026-05-18T00:00:01.000Z",
    } as TaskPlanReadModel;
    const currentNode = createTaskWorkspaceFixtureNode({
      id: "current",
      title: "Collect repositories",
      status: "active",
      objective: "Read GitHub Trending",
    });
    const upcomingNode = createTaskWorkspaceFixtureNode({
      id: "next",
      title: "Rank repositories",
      status: "idle",
      objective: "Rank collected repositories",
    });

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph(
          [currentNode, upcomingNode],
          "current",
        )}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: {
            savedPlan: acceptedPlan,
            aiPlanGenerationStatus: "accepted",
            status: "Running",
          },
        })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const navigator = screen.getByTestId("execution-navigator");
    fireEvent.click(
      within(navigator).getByRole("button", { name: /Rank repositories/ }),
    );
    expect(
      within(navigator).getAllByText("Rank repositories").length,
    ).toBeGreaterThan(0);
    expect(
      within(navigator).getAllByText("Collect repositories").length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("execution-focus-header")).toHaveTextContent(
      "Collect repositories",
    );
    fireEvent.click(
      within(screen.getByTestId("execution-navigator")).getByRole("button", {
        name: "Return to current step",
      }),
    );
    expect(
      within(screen.getByTestId("execution-navigator")).queryByRole("button", {
        name: "Return to current step",
      }),
    ).not.toBeInTheDocument();
  });

  it("adds generate plan as the current operation when no plan exists", () => {
    const onGeneratePlan = vi.fn();

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([])}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={null}
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const setup = screen.getByTestId("plan-setup-panel");
    fireEvent.click(
      within(setup).getByRole("button", { name: "Generate plan" }),
    );

    expect(onGeneratePlan).toHaveBeenCalledTimes(1);
  });

  it("keeps stop generation out of the current operation while plan generation is running", () => {
    const onGeneratePlan = vi.fn();

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([])}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: { aiPlanGenerationStatus: "generating" },
        })}
        plan={null}
        planGenerationStatus="generating"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    expect(screen.getByTestId("plan-generation-progress")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Current operation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Stop generation" }),
    ).not.toBeInTheDocument();
    expect(onGeneratePlan).not.toHaveBeenCalled();
  });

  it("shows a retry action when the task is blocked by a failed run even if graph nodes are stale", () => {
    const onDispatchExecutionAction = vi
      .fn()
      .mockResolvedValue({ message: "Retry queued" });
    const acceptedPlan = {
      id: "plan-1",
      status: "accepted",
      revision: 1,
      updatedAt: "2026-05-18T00:00:00.000Z",
    } as TaskPlanReadModel;
    const staleCurrentNode = createTaskWorkspaceFixtureNode({
      id: "node-failed",
      title: "Inspect UX readiness",
      status: "pending",
    });

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph(
          [staleCurrentNode],
          "node-failed",
        )}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: {
            savedPlan: acceptedPlan,
            status: "Blocked",
            runnabilitySummary:
              "Runtime provider failed while executing the current node.",
            blockReason: {
              blockType: "run_failed",
              scope: "run",
              actionRequired: "Retry Run",
            },
            executionSummary: {
              taskId: "task-1",
              executionState: "failed",
              stateLabel: "Failed",
              stateReason:
                "Runtime provider failed while executing the current node.",
              graphVersion: 1,
              currentNodeId: "node-failed",
              primaryAction: {
                type: "retry_sync",
                enabled: true,
                label: "Retry Run",
              },
              progress: { completed: 3, total: 4, percent: 75 },
              readiness: { runnable: true, reason: null },
              degraded: null,
              blocking: {
                reason:
                  "Runtime provider failed while executing the current node.",
                nodeId: "node-failed",
              },
              waiting: null,
              recoveryActions: [],
            },
          },
        })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const operationPanel = screen.getByRole("region", {
      name: "Current operation",
    });
    const primaryAction = within(operationPanel).getByTestId(
      "current-operation-primary-action",
    );
    expect(primaryAction).toBeInTheDocument();
    expect(primaryAction).toHaveClass("sm:flex-row");
    expect(primaryAction).toHaveTextContent("Failed");
    expect(screen.queryByText("Needs handling")).not.toBeInTheDocument();
    expect(
      within(operationPanel).getByTestId("current-operation-decision-card"),
    ).toHaveTextContent("Retry Run");
    expect(
      within(primaryAction).getByRole("button", { name: "Retry Run" }),
    ).toHaveClass("shrink-0");
    expect(
      within(primaryAction).getByRole("button", { name: "Retry Run" }),
    ).not.toHaveClass("w-full");
    fireEvent.click(
      within(operationPanel).getByRole("button", { name: "Retry Run" }),
    );

    expect(onDispatchExecutionAction).toHaveBeenCalledWith({
      action: "retry_node",
      nodeId: "node-failed",
    });
  });

  it("shows Start plan when an accepted graph only has a synthetic starting decoration without execution evidence", () => {
    const onDispatchExecutionAction = vi
      .fn()
      .mockResolvedValue({ message: "Started" });
    const acceptedPlan = {
      id: "plan-1",
      status: "accepted",
      revision: 1,
      updatedAt: "2026-05-18T00:00:00.000Z",
    } as TaskPlanReadModel;
    const syntheticStartingNode = createTaskWorkspaceFixtureNode({
      id: "node-ready",
      title: "Ready node",
      status: "active",
      statusLabel: "Starting",
      active: true,
      metadata: { launchState: "starting" },
    });

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph(
          [syntheticStartingNode],
          "node-ready",
        )}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: { savedPlan: acceptedPlan, status: "Ready" },
        })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const launchPanel = screen.getByRole("complementary", {
      name: "Run launch controls",
    });
    fireEvent.click(
      within(launchPanel).getByRole("button", { name: "Start run" }),
    );

    expect(onDispatchExecutionAction).toHaveBeenCalledWith({
      action: "start_manual",
    });
  });

  it("adds start plan as the current operation before execution starts", () => {
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({});
    const graphPlan = createTaskWorkspaceFixtureGraph(
      [
        createTaskWorkspaceFixtureNode({
          id: "ready",
          status: "ready",
          nextAction: "Start execution",
        }),
      ],
      "ready",
    );

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={
          {
            id: "plan-1",
            status: "accepted",
            revision: 1,
            updatedAt: "2026-05-18T00:00:00.000Z",
          } as TaskPlanReadModel
        }
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const launchPanel = screen.getByRole("complementary", {
      name: "Run launch controls",
    });
    fireEvent.click(
      within(launchPanel).getByRole("button", { name: "Start run" }),
    );

    expect(onDispatchExecutionAction).toHaveBeenCalledWith({
      action: "start_manual",
    });
  });

  it("shows a readable review document before accepting a generated plan", () => {
    const plan = {
      id: "plan-1",
      status: "draft",
      revision: 1,
      summary: "Two-step plan ready for review.",
      generatedBy: "Claude",
      updatedAt: "2026-05-18T00:00:00.000Z",
      blueprint: {
        title: "Research digest plan",
        goal: "Collect and summarize AI research updates.",
        assumptions: ["Use public sources only.", "Keep findings concise."],
        nodes: [],
        edges: [],
      },
      compiledPlan: {
        title: "Research digest plan",
        goal: "Collect and summarize AI research updates.",
        assumptions: ["Use public sources only.", "Keep findings concise."],
      },
      effectivePlan: {},
    } as unknown as TaskPlanReadModel;
    const graphPlan = createTaskWorkspaceFixtureGraph(
      [
        createTaskWorkspaceFixtureNode({
          id: "collect",
          title: "Collect updates",
          objective: "Gather trusted source links",
          status: "ready",
          estimatedMinutes: 12,
        }),
        createTaskWorkspaceFixtureNode({
          id: "summarize",
          title: "Summarize findings",
          objective: "Produce a concise digest",
          status: "pending",
          estimatedMinutes: 8,
        }),
      ],
      "collect",
    );
    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: {
            savedPlan: plan,
            aiPlanGenerationStatus: "waiting_acceptance",
          },
        })}
        plan={plan}
        planGenerationStatus="waiting_acceptance"
        canAcceptPlan
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );
    const executionFlow = screen.getByRole("region", {
      name: "Execution flow",
    });
    expect(
      within(executionFlow).getByText("Research digest plan"),
    ).toBeInTheDocument();
    expect(
      within(executionFlow).getByText(
        "Collect and summarize AI research updates.",
      ),
    ).toBeInTheDocument();
    expect(
      within(executionFlow).getByText("Two-step plan ready for review."),
    ).toBeInTheDocument();
    expect(
      within(executionFlow).getByText(/Use public sources only\./),
    ).toBeInTheDocument();
    expect(
      within(executionFlow).getByRole("button", { name: /Collect updates/ }),
    ).toBeInTheDocument();
    expect(
      within(executionFlow).queryByTestId("task-plan-graph-panel"),
    ).not.toBeInTheDocument();
    expect(
      within(executionFlow).getByRole("button", { name: "Use compact brief" }),
    ).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(
      within(executionFlow).getByRole("button", { name: "Flow" }),
    );
    expect(
      within(executionFlow).getByTestId("task-plan-graph-panel"),
    ).toHaveAttribute("data-fill-height", "false");
    expect(
      within(executionFlow).getByText("Two-step plan ready for review."),
    ).toBeInTheDocument();
    fireEvent.click(
      within(executionFlow).getByRole("button", { name: "Use compact brief" }),
    );
    expect(
      within(executionFlow).getByRole("button", { name: "Show full brief" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(executionFlow).queryByText("Two-step plan ready for review."),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(executionFlow).getByRole("button", { name: "Steps" }),
    );
    expect(
      within(executionFlow).getByRole("button", { name: "Show full brief" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(executionFlow).getByRole("button", { name: "Show full brief" }),
    );
    expect(
      within(executionFlow).getByText("Two-step plan ready for review."),
    ).toBeInTheDocument();
  });

  it("keeps plan acceptance prominent and revision scope explicit", () => {
    const onApplyPlan = vi.fn().mockResolvedValue(undefined);
    const onGeneratePlan = vi.fn();
    const draftPlan = {
      id: "plan-1",
      status: "draft",
      revision: 1,
      prompt: "Prefer a smaller plan.",
      updatedAt: "2026-05-18T00:00:00.000Z",
    } as TaskPlanReadModel;
    const readyNode = createTaskWorkspaceFixtureNode({
      id: "ready",
      title: "Collect sources",
      objective: "Gather source links",
      status: "ready",
      nextAction: "Start execution",
    });
    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([readyNode], "ready")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: {
            savedPlan: draftPlan,
            aiPlanGenerationStatus: "waiting_acceptance",
          },
        })}
        plan={draftPlan}
        planGenerationStatus="waiting_acceptance"
        canAcceptPlan
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={onApplyPlan}
        onDispatchExecutionAction={vi.fn()}
      />,
    );
    const decision = screen.getByRole("complementary", {
      name: "Plan review decision",
    });
    expect(
      within(decision).getByText("Plan ready for review"),
    ).toBeInTheDocument();
    expect(
      within(decision).getByText(/Execution does not start/),
    ).toBeInTheDocument();
    expect(
      within(decision).getByRole("button", { name: "Accept" }),
    ).toBeInTheDocument();
    expect(
      within(decision).queryByRole("textbox", {
        name: "Plan revision message",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Collect sources/ }));
    fireEvent.click(
      within(decision).getByRole("button", { name: "Request changes" }),
    );
    expect(
      within(decision).getByRole("radio", { name: "Entire plan" }),
    ).toHaveAttribute("aria-checked", "true");
    const selectedScope = within(decision).getByRole("radio", {
      name: "Selected step: Collect sources",
    });
    expect(selectedScope).toHaveAttribute("aria-checked", "false");
    fireEvent.click(selectedScope);
    const revisionMessage = within(decision).getByRole("textbox", {
      name: "Plan revision message",
    });
    fireEvent.change(revisionMessage, {
      target: { value: "Add a verification step." },
    });
    fireEvent.click(
      within(decision).getByRole("button", { name: "Generate revised plan" }),
    );
    expect(onGeneratePlan).toHaveBeenCalledWith({
      userInstruction: "Add a verification step.",
      selectedNodeId: "ready",
    });
    fireEvent.click(within(decision).getByRole("button", { name: "Accept" }));
    expect(onApplyPlan).toHaveBeenCalledWith(draftPlan);
  });

  it("shows the active step in the execution focus instead of a duplicate Current operation card", () => {
    const acceptedPlan = {
      id: "plan-1",
      status: "accepted",
      revision: 1,
      updatedAt: "2026-05-18T00:00:00.000Z",
    } as TaskPlanReadModel;
    const activeNode = createTaskWorkspaceFixtureNode({
      id: "execute",
      title: "Write report",
      status: "active",
      nextAction: "Writing report",
    });

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([activeNode], "execute")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: { savedPlan: acceptedPlan, status: "Running" },
        })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    expect(screen.getByTestId("execution-focus-header")).toHaveTextContent(
      "Write report",
    );
    expect(screen.getByLabelText("Execution running")).toHaveClass("relative");
    expect(
      screen.getByRole("status", { name: "Current activity running" }),
    ).toHaveTextContent("AI is starting the current step");
    expect(
      within(screen.getByTestId("execution-navigator")).getByLabelText(
        "Step running",
      ),
    ).toHaveClass("animate-spin");
    expect(
      screen.queryByRole("region", { name: "Current operation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Waiting for the next runtime update"),
    ).not.toBeInTheDocument();
  });

  it("shows the launch contract before execution starts", () => {
    const acceptedPlan = {
      id: "plan-1",
      status: "accepted",
      revision: 2,
      updatedAt: "2026-05-18T00:00:00.000Z",
    } as TaskPlanReadModel;
    const readyNode = createTaskWorkspaceFixtureNode({
      id: "execute",
      title: "Write report",
      status: "ready",
    });

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([readyNode], "execute")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: { savedPlan: acceptedPlan, aiPlanGenerationStatus: "accepted" },
        })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const launchPanel = screen.getByRole("complementary", {
      name: "Run launch controls",
    });
    expect(
      screen.getByRole("region", { name: "Accepted plan" }),
    ).toBeInTheDocument();
    expect(
      within(launchPanel).getAllByText("Ready to run").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Revision 2")).toBeInTheDocument();
    expect(within(launchPanel).getByText("Write report")).toBeInTheDocument();
    expect(
      within(launchPanel).getByText(
        "Requires your acceptance before the task is done",
      ),
    ).toBeInTheDocument();
    expect(
      within(launchPanel).getByText(
        "Plan accepted. Execution has not started, and nothing runs until you start it.",
      ),
    ).toBeInTheDocument();
    const acceptedPlanView = screen.getByRole("group", {
      name: "Accepted plan view",
    });
    expect(
      within(acceptedPlanView).getByRole("button", { name: "Steps" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(acceptedPlanView).getByRole("button", { name: "Flow" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Write report/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Run contract preview")).not.toBeInTheDocument();
    fireEvent.click(
      within(acceptedPlanView).getByRole("button", { name: "Flow" }),
    );
    expect(screen.getByTestId("task-plan-graph-panel")).toHaveAttribute(
      "data-graph-mode",
      "full",
    );
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
  });

  it("keeps an explicit height chain for the accepted plan graph", () => {
    const acceptedPlan = {
      id: "plan-height",
      status: "accepted",
      revision: 3,
      updatedAt: "2026-05-18T00:00:00.000Z",
    } as TaskPlanReadModel;
    const graphPlan = createTaskWorkspaceFixtureGraph(
      [
        createTaskWorkspaceFixtureNode({
          id: "collect",
          title: "Collect sources",
          status: "ready",
        }),
        createTaskWorkspaceFixtureNode({
          id: "write",
          title: "Write report",
          status: "pending",
        }),
        createTaskWorkspaceFixtureNode({
          id: "review",
          title: "Review result",
          type: "checkpoint",
          status: "pending",
        }),
        createTaskWorkspaceFixtureNode({
          id: "publish",
          title: "Publish",
          status: "pending",
        }),
      ],
      "collect",
    );

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: { savedPlan: acceptedPlan, aiPlanGenerationStatus: "accepted" },
        })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    expect(screen.getByTestId("accepted-plan-surface")).toHaveClass(
      "xl:h-full",
    );
    expect(
      document.querySelector('[data-plan-graph-height-contract="fill"]'),
    ).toHaveClass("min-h-[32rem]", "flex-1");
    const acceptedPlanView = screen.getByRole("group", {
      name: "Accepted plan view",
    });
    fireEvent.click(
      within(acceptedPlanView).getByRole("button", { name: "Flow" }),
    );
    expect(screen.getByTestId("task-plan-graph-panel")).toHaveAttribute(
      "data-graph-mode",
      "full",
    );
  });

  it("adds checkpoint controls as the current operation after execution starts", async () => {
    const onDispatchExecutionAction = vi
      .fn()
      .mockResolvedValue({ message: "Input sent" });
    const onSubmitCheckpointAction = vi
      .fn()
      .mockResolvedValue({ message: "Input sent" });
    const node = createTaskWorkspaceFixtureNode({
      id: "checkpoint",
      title: "Review checkpoint",
      status: "waiting_for_user",
      nextAction: "Provide checkpoint input",
      requiresHumanInput: true,
      checkpoint,
      availableActions: [
        {
          id: "submit_input",
          label: "Submit input",
          kind: "input",
          emphasis: "primary",
          checkpointId: checkpoint.id,
          checkpointAction: "submit_input",
        },
      ],
      interactiveFields: [
        {
          key: "city",
          label: "City",
          value: "",
          control: "text",
          required: true,
        },
      ],
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "checkpoint");

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={
          {
            id: "plan-1",
            status: "accepted",
            revision: 1,
            updatedAt: "2026-05-18T00:00:00.000Z",
          } as TaskPlanReadModel
        }
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
        onSubmitCheckpointAction={onSubmitCheckpointAction}
      />,
    );

    const operationPanel = screen.getByRole("region", {
      name: "Current operation",
    });
    fireEvent.change(within(operationPanel).getByLabelText(/City/), {
      target: { value: "Shanghai" },
    });
    fireEvent.click(
      within(operationPanel).getByRole("button", { name: "Send Submit input" }),
    );

    await waitFor(() => {
      expect(onSubmitCheckpointAction).toHaveBeenCalledWith({
        checkpointId: checkpoint.id,
        action: "submit_input",
        payload: {
          inputFields: { city: "Shanghai" },
          message: "City: Shanghai",
        },
      });
    });
  });

  it("shows distinct input and approval recovery cards in current operation", () => {
    const acceptedPlan = {
      id: "plan-1",
      status: "accepted",
      revision: 1,
      updatedAt: "2026-05-18T00:00:00.000Z",
    } as TaskPlanReadModel;
    const inputNode = createTaskWorkspaceFixtureNode({
      id: "input-node",
      title: "Collect missing city",
      status: "waiting_for_user",
      nextAction: "Provide checkpoint input",
      checkpoint: {
        ...checkpoint,
        id: "run-1:input-node:input",
        nodeId: "input-node",
        kind: "user_input",
      },
      availableActions: [
        {
          id: "submit_input",
          label: "Submit input",
          kind: "input",
          emphasis: "primary",
          checkpointId: "run-1:input-node:input",
          checkpointAction: "submit_input",
        },
      ],
      interactiveFields: [
        {
          key: "city",
          label: "City",
          value: "",
          control: "text",
          required: true,
        },
      ],
    });
    const approvalNode = createTaskWorkspaceFixtureNode({
      id: "approval-node",
      title: "Approve deploy",
      status: "waiting_for_approval",
      nextAction: "Approve deploy request",
      checkpoint: {
        ...checkpoint,
        id: "run-1:approval-node:approval",
        nodeId: "approval-node",
        kind: "approval",
      },
      availableActions: [
        {
          id: "approve",
          label: "Approve",
          kind: "approve",
          emphasis: "primary",
          checkpointId: "run-1:approval-node:approval",
          checkpointAction: "approve_result",
        },
      ],
    });

    const { rerender } = renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([inputNode], "input-node")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: { savedPlan: acceptedPlan, status: "Running" },
        })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
        onSubmitCheckpointAction={vi.fn()}
      />,
    );

    let operationPanel = screen.getByRole("region", {
      name: "Current operation",
    });
    expect(
      within(operationPanel).getByTestId("current-operation-decision-card"),
    ).toHaveTextContent("Input needed");
    expect(
      within(operationPanel).getByTestId("current-operation-decision-card"),
    ).toHaveTextContent(
      "Next: Provide the requested input so execution can continue",
    );
    expect(
      within(operationPanel).queryByText("Needs handling"),
    ).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TaskWorkspacePlanSection
          label="Plan"
          graphPlan={createTaskWorkspaceFixtureGraph(
            [approvalNode],
            "approval-node",
          )}
          isGraphPlanPending={false}
          pageData={createTaskWorkspaceFixturePageData({
            task: { savedPlan: acceptedPlan, status: "Running" },
          })}
          plan={acceptedPlan}
          planGenerationStatus="accepted"
          acceptPlanError={null}
          runtimeEvents={[]}
          onGeneratePlan={vi.fn()}
          onApplyPlan={vi.fn()}
          onDispatchExecutionAction={vi.fn()}
          onSubmitCheckpointAction={vi.fn()}
        />
      </QueryClientProvider>,
    );

    operationPanel = screen.getByRole("region", { name: "Current operation" });
    expect(
      within(operationPanel).getByTestId("current-operation-decision-card"),
    ).toHaveTextContent("Approval needed");
    expect(
      within(operationPanel).getByTestId("current-operation-decision-card"),
    ).toHaveTextContent(
      "Next: Review the request, then approve, reject, or request changes",
    );
    expect(
      within(operationPanel).queryByText("Needs handling"),
    ).not.toBeInTheDocument();
  });
  it("does not expose locally-derived actions without a backend checkpoint", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "checkpoint",
      title: "Review checkpoint",
      status: "waiting_for_user",
      nextAction: "Provide checkpoint input",
      requiresHumanInput: true,
      availableActions: [
        {
          id: "submit_input",
          label: "Submit input",
          kind: "input",
          emphasis: "primary",
        },
      ],
      interactiveFields: [
        {
          key: "city",
          label: "City",
          value: "",
          control: "text",
          required: true,
        },
      ],
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "checkpoint");

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={
          {
            id: "plan-1",
            status: "accepted",
            revision: 1,
            updatedAt: "2026-05-18T00:00:00.000Z",
          } as TaskPlanReadModel
        }
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
        onSubmitCheckpointAction={vi.fn()}
      />,
    );

    expect(screen.getByTestId("execution-focus-header")).toBeInTheDocument();
    expect(screen.queryByText("Current node action")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/City/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send Submit input" }),
    ).not.toBeInTheDocument();
  });

  it("shows blocked current node action with blocker reason before start plan", async () => {
    const blocker = "已创建脚本文件，但当前运行环境访问 wttr.in 连续超时。";
    const onDispatchExecutionAction = vi
      .fn()
      .mockResolvedValue({ message: "Node resumed" });
    const onSubmitCheckpointAction = vi
      .fn()
      .mockResolvedValue({ message: "Node resumed" });
    const blockedCheckpoint = {
      ...checkpoint,
      id: "run-1:weather-script:manual_recovery",
      nodeId: "weather-script",
      kind: "manual_recovery" as const,
      message: blocker,
    };
    const node = createTaskWorkspaceFixtureNode({
      id: "weather-script",
      title: "创建一个获取天气的脚本",
      status: "blocked",
      interactionType: "retry",
      nextAction: blocker,
      checkpoint: blockedCheckpoint,
      availableActions: [
        {
          id: "resume_after_unblock",
          label: "解决阻塞",
          kind: "resolve",
          emphasis: "primary",
          checkpointId: blockedCheckpoint.id,
          checkpointAction: "resume_after_unblock",
        },
        {
          id: "retry_node",
          label: "重试节点",
          kind: "retry",
          emphasis: "warning",
          checkpointId: blockedCheckpoint.id,
          checkpointAction: "retry_node",
        },
      ],
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "weather-script");

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={
          {
            id: "plan-1",
            status: "accepted",
            revision: 1,
            updatedAt: "2026-05-18T00:00:00.000Z",
          } as TaskPlanReadModel
        }
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
        onSubmitCheckpointAction={onSubmitCheckpointAction}
      />,
    );

    const operationPanel = screen.getByRole("region", {
      name: "Current operation",
    });

    expect(within(operationPanel).getAllByText(blocker).length).toBeGreaterThan(
      0,
    );
    expect(
      within(operationPanel).queryByRole("button", { name: "Start plan" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(operationPanel).getByRole("button", { name: "Send 解决阻塞" }),
    );

    await waitFor(() => {
      expect(onSubmitCheckpointAction).toHaveBeenCalledWith({
        checkpointId: blockedCheckpoint.id,
        action: "resume_after_unblock",
        payload: { reason: blocker },
      });
    });
  });

  it("puts result review before the final result and submits explicit change feedback", async () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "weather-script",
      title: "创建一个获取天气的脚本",
      status: "done",
      nextAction: "Result complete",
      availableActions: [],
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "weather-script");
    const onAcceptResult = vi.fn().mockResolvedValue(undefined);
    const onDispatchExecutionAction = vi
      .fn()
      .mockResolvedValue({ message: "Rerun started" });

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: { status: "Completed" },
        })}
        plan={
          {
            id: "plan-1",
            status: "accepted",
            revision: 1,
            updatedAt: "2026-05-18T00:00:00.000Z",
          } as TaskPlanReadModel
        }
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
        onAcceptResult={onAcceptResult}
      />,
    );

    const workspace = screen.getByRole("region", {
      name: "Task execution workspace",
    });
    const reviewHeader = screen.getByTestId("result-lifecycle-panel");
    const finalResult = screen.getByTestId("final-result-surface");

    expect(workspace).toHaveAttribute("data-workspace-layout", "result_focus");
    expect(reviewHeader).toHaveTextContent("Result ready");
    expect(
      reviewHeader.compareDocumentPosition(finalResult) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(workspace).toHaveClass("bg-muted/45");
    expect(reviewHeader).toHaveClass("bg-card");
    expect(finalResult).toHaveClass("bg-card");
    expect(
      screen.queryByRole("region", { name: "Execution flow" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Continue from result")).not.toBeInTheDocument();
    expect(screen.getByText("Activity").closest("details")).not.toHaveAttribute(
      "open",
    );

    fireEvent.click(
      within(reviewHeader).getByRole("button", { name: "Accept result" }),
    );
    await waitFor(() => expect(onAcceptResult).toHaveBeenCalledTimes(1));

    fireEvent.click(
      within(reviewHeader).getByRole("button", { name: "Request changes" }),
    );
    const changesRegion = screen.getByRole("region", {
      name: "Request changes",
    });
    const changesInput = within(changesRegion).getByRole("textbox", {
      name: "What needs to change?",
    });
    expect(changesInput).toHaveFocus();
    expect(
      within(changesRegion).getByRole("button", { name: "Rerun final step" }),
    ).toBeDisabled();

    fireEvent.change(changesInput, {
      target: { value: "Include source links for every entry." },
    });
    const submitChanges = within(changesRegion).getByRole("button", {
      name: "Rerun final step",
    });
    await waitFor(() => expect(submitChanges).toBeEnabled());
    fireEvent.click(submitChanges);
    await waitFor(() =>
      expect(onDispatchExecutionAction).toHaveBeenCalledWith({
        action: "retry_node",
        nodeId: "weather-script",
        prompt: "Include source links for every entry.",
      }),
    );
  });

  it("renders Done as one accepted-result panel and creates a linked next task", async () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "weather-script",
      title: "Result",
      status: "done",
      availableActions: [],
    });
    continueFromTaskResultMock.mockResolvedValueOnce({
      intent: "create_task",
      taskId: "follow-up-1",
      workspaceId: "workspace-1",
      parentTaskId: "task-1",
      title: "Compare the top projects",
    });

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([node], "weather-script")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: { status: "Done" },
        })}
        plan={
          {
            id: "plan-1",
            status: "accepted",
            revision: 1,
            updatedAt: "2026-05-18T00:00:00.000Z",
          } as TaskPlanReadModel
        }
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const lifecyclePanel = screen.getByTestId("result-lifecycle-panel");
    expect(lifecyclePanel).toHaveTextContent("Result accepted");
    expect(
      screen.queryByRole("button", { name: "Accept result" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Continue from result is not available yet."),
    ).not.toBeInTheDocument();
    const createTaskMode = within(lifecyclePanel).getByRole("radio", {
      name: /Create next task/,
    });
    expect(createTaskMode).toHaveAttribute("aria-checked", "true");
    expect(createTaskMode).toHaveAttribute("data-state", "checked");
    expect(createTaskMode).toHaveClass("h-8");
    expect(
      within(lifecyclePanel).getByText(
        "Carry this accepted result into a linked task draft.",
      ),
    ).toBeInTheDocument();

    const input = within(lifecyclePanel).getByRole("textbox", {
      name: "Follow-up request",
    });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Compare the top projects" } });
    fireEvent.click(
      within(lifecyclePanel).getByRole("button", { name: "Create task" }),
    );

    await waitFor(() =>
      expect(continueFromTaskResultMock).toHaveBeenCalledWith({
        taskId: "task-1",
        intent: "create_task",
        instruction: "Compare the top projects",
        history: undefined,
      }),
    );
    expect(
      await within(lifecyclePanel).findByText(/Follow-up task created/),
    ).toBeInTheDocument();
    expect(
      within(lifecyclePanel).getByRole("link", { name: /Open task/ }),
    ).toHaveAttribute("href", "/en/tasks/follow-up-1");
  });

  it("asks a follow-up using the accepted result and keeps the answer in the lifecycle panel", async () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "weather-script",
      title: "Result",
      status: "done",
      availableActions: [],
    });
    continueFromTaskResultMock.mockResolvedValueOnce({
      intent: "ask",
      answer: "The result contains three relevant projects.",
      source: "test",
    });

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([node], "weather-script")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: { status: "Done" },
        })}
        plan={
          {
            id: "plan-1",
            status: "accepted",
            revision: 1,
            updatedAt: "2026-05-18T00:00:00.000Z",
          } as TaskPlanReadModel
        }
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const lifecyclePanel = screen.getByTestId("result-lifecycle-panel");
    fireEvent.click(
      within(lifecyclePanel).getByRole("radio", { name: /Ask a follow-up/ }),
    );
    const createTaskMode = within(lifecyclePanel).getByRole("radio", {
      name: /Create next task/,
    });
    const askMode = within(lifecyclePanel).getByRole("radio", {
      name: /Ask a follow-up/,
    });
    expect(createTaskMode).toHaveAttribute("aria-checked", "false");
    expect(createTaskMode).toHaveAttribute("data-state", "unchecked");
    expect(askMode).toHaveAttribute("aria-checked", "true");
    expect(askMode).toHaveAttribute("data-state", "checked");
    expect(
      within(lifecyclePanel).getByText(
        "Get an answer grounded in the accepted result.",
      ),
    ).toBeInTheDocument();
    const input = within(lifecyclePanel).getByRole("textbox", {
      name: "Follow-up request",
    });
    fireEvent.change(input, {
      target: { value: "Which projects are relevant?" },
    });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

    await waitFor(() =>
      expect(continueFromTaskResultMock).toHaveBeenCalledWith({
        taskId: "task-1",
        intent: "ask",
        instruction: "Which projects are relevant?",
        history: [],
      }),
    );
    expect(
      await within(lifecyclePanel).findByText(
        "The result contains three relevant projects.",
      ),
    ).toBeInTheDocument();
  });

  it("does not open node detail overlay when selecting a graph node", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "review",
      title: "Review task output",
      status: "waiting",
      nextAction: "Review output",
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "review");

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={
          {
            id: "plan-1",
            status: "accepted",
            revision: 1,
            updatedAt: "2026-05-18T00:00:00.000Z",
          } as TaskPlanReadModel
        }
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    expect(screen.getByTestId("execution-navigator")).toHaveTextContent(
      "Review task output",
    );
    fireEvent.click(
      within(screen.getByTestId("execution-navigator")).getByRole("button", {
        name: /Review task output/,
      }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Selected node details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Task command center" }),
    ).toBeInTheDocument();
  });
});
