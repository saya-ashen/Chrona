import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class ELKMock {
    layout(graph: unknown) {
      return Promise.resolve(graph);
    }
  },
}));

vi.mock("@/components/tasks/panels/task-plan-graph-panel", () => ({
  TaskPlanGraphPanel: ({ plan, mode, onSelectedNodeChange }: {
    plan: { nodes: Array<{ id: string; title: string; objective?: string; status?: string }> };
    mode?: "full" | "compact";
    onSelectedNodeChange?: (node: { id: string; title: string; objective?: string; status?: string }, nodes: Array<{ id: string; title: string; objective?: string; status?: string }>) => void;
  }) => (
    <div data-testid="task-plan-graph-panel" data-graph-mode={mode ?? "full"}>
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

import type { TaskPlanReadModel } from "@chrona/contracts/ai";
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

let TaskWorkspacePlanSection: typeof import("./task-workspace-plan-section").TaskWorkspacePlanSection;
let derivePreferredGraphMode: typeof import("./task-workspace-plan-section").derivePreferredGraphMode;
let recoveryActionButtonVariant: typeof import("./task-workspace-plan-section").recoveryActionButtonVariant;

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

vi.mock("@chrona/i18n/react", async () => {
  const { fallbackMessages } = await import("@chrona/i18n/messages");
  return {
    useI18n: () => ({ messages: fallbackMessages, t: (key: string) => key }),
    useLocale: () => "en",
  };
});

beforeAll(async () => {
  ({ TaskWorkspacePlanSection, derivePreferredGraphMode, recoveryActionButtonVariant } = await import("./task-workspace-plan-section"));

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
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ generationSession: null }), {
    status: 404,
    headers: { "content-type": "application/json" },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("derivePreferredGraphMode", () => {
  it.each([
    { name: "generating keeps full graph", currentMode: "compact" as const, isGeneratingPlan: true, hasGraphExecutionStarted: true, hasTaskCompleted: false, expected: "full" },
    { name: "running switches to compact", currentMode: "full" as const, isGeneratingPlan: false, hasGraphExecutionStarted: true, hasTaskCompleted: false, expected: "compact" },
    { name: "completed switches to compact", currentMode: "full" as const, isGeneratingPlan: false, hasGraphExecutionStarted: false, hasTaskCompleted: true, expected: "compact" },
    { name: "idle keeps current mode", currentMode: "full" as const, isGeneratingPlan: false, hasGraphExecutionStarted: false, hasTaskCompleted: false, expected: "full" },
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
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({ message: "Started" });
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
      availableActions: [{ id: "submit_input", label: "Submit input", kind: "input", emphasis: "primary", checkpointId: checkpoint.id, checkpointAction: "submit_input" }],
      interactiveFields: [{ key: "decision", label: "Decision", value: "", control: "text", required: true }],
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
    const getOperationPanel = () => screen.getAllByRole("region", { name: "Current operation" }).at(-1)!;
    const getCurrentGraphPanel = () => screen.getAllByTestId("task-plan-graph-panel").at(-1)!;
    expect(screen.getByRole("region", { name: "Execution flow" })).toBeInTheDocument();
    expect(within(getOperationPanel()).getByRole("button", { name: "Generate plan" })).toBeInTheDocument();
    fireEvent.click(within(getOperationPanel()).getByRole("button", { name: "Generate plan" }));
    expect(onGeneratePlan).toHaveBeenCalledTimes(1);

    initial.rerender(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([generatedNode], "generate")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({ task: { savedPlan: draftPlan, aiPlanGenerationStatus: "waiting_acceptance" } })}
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
    expect(screen.getByTestId("task-plan-node-generate")).toHaveTextContent("Generated plan node");
    expect(within(getOperationPanel()).getByRole("button", { name: "Accept" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("task-plan-node-generate"));
    expect(screen.queryByRole("dialog", { name: "Selected node details" })).not.toBeInTheDocument();
    fireEvent.click(within(getOperationPanel()).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onApplyPlan).toHaveBeenCalledWith(draftPlan));

    const accepted = mount(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([generatedNode], "generate")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({ task: { savedPlan: acceptedPlan, aiPlanGenerationStatus: "accepted" } })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={onApplyPlan}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );
    expect(within(getOperationPanel()).getByRole("button", { name: "Start plan" })).toBeInTheDocument();
    fireEvent.click(within(getOperationPanel()).getByRole("button", { name: "Start plan" }));
    expect(onDispatchExecutionAction).toHaveBeenCalledWith({ action: "start_manual" });
    expect(getCurrentGraphPanel()).toHaveAttribute("data-graph-mode", "full");

    accepted.rerender(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([runningNode, waitingNode], "checkpoint")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({ task: { savedPlan: acceptedPlan, aiPlanGenerationStatus: "accepted", status: "WaitingForInput" } })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[{
          type: "runtime_event",
          action: "start_manual",
          runtimeName: "local",
          provider: "provider",
          event: { type: "tool_started", toolName: "chrona_execution_dispatch", label: "Starting plan" },
        }]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={onApplyPlan}
        onDispatchExecutionAction={onDispatchExecutionAction}
        onSubmitCheckpointAction={vi.fn()}
      />,
    );
    expect(within(getOperationPanel()).getByLabelText(/Decision/)).toBeInTheDocument();
    expect(within(getOperationPanel()).getByText("Tool: Starting plan")).toBeInTheDocument();
    await waitFor(() => expect(getCurrentGraphPanel()).toHaveAttribute("data-graph-mode", "compact"));
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

    const operationPanel = screen.getByRole("region", { name: "Current operation" });
    fireEvent.click(within(operationPanel).getByRole("button", { name: "Generate plan" }));

    expect(onGeneratePlan).toHaveBeenCalledTimes(1);
  });

  it("keeps stop generation out of the current operation while plan generation is running", () => {
    const onGeneratePlan = vi.fn();

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([])}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({ task: { aiPlanGenerationStatus: "generating" } })}
        plan={null}
        planGenerationStatus="generating"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const operationPanel = screen.getByRole("region", { name: "Current operation" });
    expect(within(operationPanel).queryByRole("button", { name: "Generate plan" })).not.toBeInTheDocument();
    expect(within(operationPanel).queryByRole("button", { name: "Stop generation" })).not.toBeInTheDocument();
    expect(onGeneratePlan).not.toHaveBeenCalled();
  });

  it("shows a retry action when the task is blocked by a failed run even if graph nodes are stale", () => {
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({ message: "Retry queued" });
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
        graphPlan={createTaskWorkspaceFixtureGraph([staleCurrentNode], "node-failed")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({
          task: {
            savedPlan: acceptedPlan,
            status: "Blocked",
            runnabilitySummary: "Runtime provider failed while executing the current node.",
            blockReason: { blockType: "run_failed", scope: "run", actionRequired: "Retry Run" },
            executionSummary: {
              taskId: "task-1",
              executionState: "failed",
              stateLabel: "Failed",
              stateReason: "Runtime provider failed while executing the current node.",
              graphVersion: 1,
              currentNodeId: "node-failed",
              primaryAction: { type: "retry_sync", enabled: true, label: "Retry Run" },
              progress: { completed: 3, total: 4, percent: 75 },
              readiness: { runnable: true, reason: null },
              degraded: null,
              blocking: { reason: "Runtime provider failed while executing the current node.", nodeId: "node-failed" },
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

    const operationPanel = screen.getByRole("region", { name: "Current operation" });
    fireEvent.click(within(operationPanel).getByRole("button", { name: "Retry Run" }));

    expect(onDispatchExecutionAction).toHaveBeenCalledWith({ action: "retry_node", nodeId: "node-failed" });
  });

  it("shows Start plan when an accepted graph only has a synthetic starting decoration without execution evidence", () => {
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({ message: "Started" });
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
        graphPlan={createTaskWorkspaceFixtureGraph([syntheticStartingNode], "node-ready")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({ task: { savedPlan: acceptedPlan, status: "Ready" } })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const operationPanel = screen.getByRole("region", { name: "Current operation" });
    fireEvent.click(within(operationPanel).getByRole("button", { name: "Start plan" }));

    expect(onDispatchExecutionAction).toHaveBeenCalledWith({ action: "start_manual" });
  });


  it("adds start plan as the current operation before execution starts", () => {
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({});
    const graphPlan = createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "ready", status: "ready", nextAction: "Start execution" }),
    ], "ready");

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={{ id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel}
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const operationPanel = screen.getByRole("region", { name: "Current operation" });
    fireEvent.click(within(operationPanel).getByRole("button", { name: "Start plan" }));

    expect(onDispatchExecutionAction).toHaveBeenCalledWith({ action: "start_manual" });
  });

  it("shows accept and AI revision chat with selected node detail before plan acceptance", () => {
    const onApplyPlan = vi.fn().mockResolvedValue(undefined);
    const onGeneratePlan = vi.fn();
    const draftPlan = {
      id: "plan-1",
      status: "draft",
      revision: 1,
      prompt: "Prefer a smaller plan and keep the first step manual.",
      updatedAt: "2026-05-18T00:00:00.000Z",
    } as TaskPlanReadModel;
    const readyNode = createTaskWorkspaceFixtureNode({ id: "ready", title: "Collect sources", objective: "Gather source links", status: "ready", nextAction: "Start execution" });
    const graphPlan = createTaskWorkspaceFixtureGraph([
      readyNode,
    ], "ready");

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
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

    const operationPanel = screen.getByRole("region", { name: "Current operation" });
    const executionFlow = screen.getByRole("region", { name: "Execution flow" });

    expect(within(operationPanel).getByText("Last revision request")).toBeInTheDocument();
    expect(within(operationPanel).getAllByText("Prefer a smaller plan and keep the first step manual.").length).toBeGreaterThan(0);
    expect(within(operationPanel).getByText("Ask Chrona to revise this draft plan.")).toBeInTheDocument();
    expect(within(executionFlow).queryByText("Last revision request")).not.toBeInTheDocument();
    expect(within(operationPanel).queryByRole("button", { name: "Start plan" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("task-plan-node-ready"));
    expect(within(executionFlow).getByRole("region", { name: "Selected node details" })).toHaveTextContent("Collect sources");
    expect(within(executionFlow).getByText("Gather source links")).toBeInTheDocument();
    expect(within(operationPanel).getByText("Ask Chrona to revise selected step: Collect sources")).toBeInTheDocument();

    const revisionMessage = within(operationPanel).getByRole("textbox", { name: "Plan revision message" });
    fireEvent.change(revisionMessage, {
      target: { value: "Add a verification step before accepting the final output." },
    });
    fireEvent.click(within(operationPanel).getByRole("button", { name: "Accept" }));
    fireEvent.click(within(operationPanel).getByRole("button", { name: "Ask AI to revise plan" }));
    expect(revisionMessage).toHaveValue("");
    expect(within(operationPanel).getByText("Add a verification step before accepting the final output.")).toBeInTheDocument();

    expect(onApplyPlan).toHaveBeenCalledWith(draftPlan);
    expect(onGeneratePlan).toHaveBeenCalledWith({
      userInstruction: "Add a verification step before accepting the final output.",
      selectedNodeId: "ready",
    });
  });

  it("shows running spinner in Current operation instead of Results", () => {
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
        pageData={createTaskWorkspaceFixturePageData({ task: { savedPlan: acceptedPlan, status: "Running" } })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    expect(within(screen.getByRole("region", { name: "Current operation" })).getByLabelText("Current operation running")).toHaveClass("animate-spin");
    expect(screen.queryByText("Running now")).not.toBeInTheDocument();
  });

  it("adds checkpoint controls as the current operation after execution starts", async () => {
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({ message: "Input sent" });
    const onSubmitCheckpointAction = vi.fn().mockResolvedValue({ message: "Input sent" });
    const node = createTaskWorkspaceFixtureNode({
      id: "checkpoint",
      title: "Review checkpoint",
      status: "waiting_for_user",
      nextAction: "Provide checkpoint input",
      requiresHumanInput: true,
      checkpoint,
      availableActions: [{ id: "submit_input", label: "Submit input", kind: "input", emphasis: "primary", checkpointId: checkpoint.id, checkpointAction: "submit_input" }],
      interactiveFields: [{ key: "city", label: "City", value: "", control: "text", required: true }],
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "checkpoint");

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={{ id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel}
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
        onSubmitCheckpointAction={onSubmitCheckpointAction}
      />,
    );

    const operationPanel = screen.getByRole("region", { name: "Current operation" });
    fireEvent.change(within(operationPanel).getByLabelText(/City/), { target: { value: "Shanghai" } });
    fireEvent.click(within(operationPanel).getByRole("button", { name: "Send Submit input" }));

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

  it("does not expose locally-derived actions without a backend checkpoint", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "checkpoint",
      title: "Review checkpoint",
      status: "waiting_for_user",
      nextAction: "Provide checkpoint input",
      requiresHumanInput: true,
      availableActions: [{ id: "submit_input", label: "Submit input", kind: "input", emphasis: "primary" }],
      interactiveFields: [{ key: "city", label: "City", value: "", control: "text", required: true }],
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "checkpoint");

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={{ id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel}
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
        onSubmitCheckpointAction={vi.fn()}
      />,
    );

    const operationPanel = screen.getByRole("region", { name: "Current operation" });

    expect(within(operationPanel).queryByText("Current node action")).not.toBeInTheDocument();
    expect(within(operationPanel).queryByLabelText(/City/)).not.toBeInTheDocument();
    expect(within(operationPanel).queryByRole("button", { name: "Send Submit input" })).not.toBeInTheDocument();
  });

  it("shows blocked current node action with blocker reason before start plan", async () => {
    const blocker = "已创建脚本文件，但当前运行环境访问 wttr.in 连续超时。";
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({ message: "Node resumed" });
    const onSubmitCheckpointAction = vi.fn().mockResolvedValue({ message: "Node resumed" });
    const blockedCheckpoint = { ...checkpoint, id: "run-1:weather-script:manual_recovery", nodeId: "weather-script", kind: "manual_recovery" as const, message: blocker };
    const node = createTaskWorkspaceFixtureNode({
      id: "weather-script",
      title: "创建一个获取天气的脚本",
      status: "blocked",
      interactionType: "retry",
      nextAction: blocker,
      checkpoint: blockedCheckpoint,
      availableActions: [
        { id: "resume_after_unblock", label: "解决阻塞", kind: "resolve", emphasis: "primary", checkpointId: blockedCheckpoint.id, checkpointAction: "resume_after_unblock" },
        { id: "retry_node", label: "重试节点", kind: "retry", emphasis: "warning", checkpointId: blockedCheckpoint.id, checkpointAction: "retry_node" },
      ],
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "weather-script");

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={{ id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel}
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
        onSubmitCheckpointAction={onSubmitCheckpointAction}
      />,
    );

    const operationPanel = screen.getByRole("region", { name: "Current operation" });

    expect(within(operationPanel).getAllByText(blocker).length).toBeGreaterThan(0);
    expect(within(operationPanel).queryByRole("button", { name: "Start plan" })).not.toBeInTheDocument();

    fireEvent.click(within(operationPanel).getByRole("button", { name: "Send 解决阻塞" }));

    await waitFor(() => {
      expect(onSubmitCheckpointAction).toHaveBeenCalledWith({
        checkpointId: blockedCheckpoint.id,
        action: "resume_after_unblock",
        payload: { reason: blocker },
      });
    });
  });

  it("shows task completed for completed nodes without actions", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "weather-script",
      title: "创建一个获取天气的脚本",
      status: "done",
      nextAction: "请提供创建天气脚本所需的关键信息。",
      inputFields: { city: "Shanghai" },
      interactiveFields: [{ key: "city", label: "City", value: "Shanghai", control: "text", required: true }],
      availableActions: [],
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "weather-script");

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({ task: { status: "Completed" } })}
        plan={{ id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel}
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });

    // A completed plan reports full progress and exposes no pending action input.
    expect(within(commandCenter).getByText((_content, element) => element?.textContent === "1/1 steps")).toBeInTheDocument();
    expect(within(commandCenter).queryByText("Ready to run")).not.toBeInTheDocument();
    expect(within(commandCenter).queryByRole("button", { name: "Send input" })).not.toBeInTheDocument();
    expect(within(commandCenter).queryByLabelText(/City/)).not.toBeInTheDocument();
    expect(within(commandCenter).queryByRole("region", { name: "Current operation" })).not.toBeInTheDocument();
    expect(within(commandCenter).queryByText("Result summary will appear here after the current node finishes.")).not.toBeInTheDocument();
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
        plan={{ id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel}
        planGenerationStatus="idle"
        acceptPlanError={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onApplyPlan={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    expect(screen.getByTestId("task-plan-node-review")).toHaveTextContent("Review task output");
    fireEvent.click(screen.getByTestId("task-plan-node-review"));

    expect(screen.queryByRole("dialog", { name: "Selected node details" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Task command center" })).toBeInTheDocument();
  });
});
