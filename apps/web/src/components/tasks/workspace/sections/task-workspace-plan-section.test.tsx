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
  TaskPlanGraphPanel: ({ plan, onSelectedNodeChange }: {
    plan: { nodes: Array<{ id: string; title: string }> };
    onSelectedNodeChange?: (node: { id: string; title: string } | null, nodes: Array<{ id: string; title: string }>) => void;
  }) => (
    <div data-testid="task-plan-graph-panel">
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

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({ messages: {} }),
}));

beforeAll(async () => {
  ({ TaskWorkspacePlanSection } = await import("./task-workspace-plan-section"));

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

describe("TaskWorkspacePlanSection", () => {
  it("keeps graph, command center, and node drawer in sync across create, accept, and run", async () => {
    const onGeneratePlan = vi.fn();
    const onApplyPlan = vi.fn().mockResolvedValue(undefined);
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({ message: "Started" });
    const planningTaskDraft = {
      title: "Launch workspace flow",
      description: "",
      priority: "Medium",
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
    } as const;
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

    const view = renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([])}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={null}
        planGenerationStatus="idle"
        acceptPlanError={null}
        planningTaskDraft={planningTaskDraft}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onPlanLoaded={vi.fn()}
        onApplyPlan={onApplyPlan}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });
    expect(screen.getByRole("region", { name: "Execution flow" })).toBeInTheDocument();
    expect(within(commandCenter).getByRole("button", { name: "Generate plan" })).toBeInTheDocument();
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Generate plan" }));
    expect(onGeneratePlan).toHaveBeenCalledTimes(1);

    view.rerender(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([])}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({ task: { aiPlanGenerationStatus: "generating" } })}
        plan={null}
        planGenerationStatus="generating"
        acceptPlanError={null}
        planningTaskDraft={planningTaskDraft}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onPlanLoaded={vi.fn()}
        onApplyPlan={onApplyPlan}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    expect(within(commandCenter).getByRole("button", { name: "Generating..." })).toBeDisabled();

    view.rerender(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([generatedNode], "generate")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({ task: { savedPlan: draftPlan, aiPlanGenerationStatus: "waiting_acceptance" } })}
        plan={draftPlan}
        planGenerationStatus="waiting_acceptance"
        canAcceptPlan
        acceptPlanError={null}
        planningTaskDraft={planningTaskDraft}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onPlanLoaded={vi.fn()}
        onApplyPlan={onApplyPlan}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    expect(screen.getByTestId("task-plan-node-generate")).toHaveTextContent("Generated plan node");
    expect(within(commandCenter).getByRole("button", { name: "Accept plan" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("task-plan-node-generate"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Generated plan node" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close selected node drawer" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Generated plan node" })).not.toBeInTheDocument());
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Accept plan" }));
    await waitFor(() => expect(onApplyPlan).toHaveBeenCalledWith(draftPlan));

    view.rerender(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([generatedNode], "generate")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({ task: { savedPlan: acceptedPlan, aiPlanGenerationStatus: "accepted" } })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        planningTaskDraft={planningTaskDraft}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onPlanLoaded={vi.fn()}
        onApplyPlan={onApplyPlan}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    expect(within(commandCenter).getByRole("button", { name: "Start plan" })).toBeInTheDocument();
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Start plan" }));
    expect(onDispatchExecutionAction).toHaveBeenCalledWith({ action: "start_manual" });

    view.rerender(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={createTaskWorkspaceFixtureGraph([runningNode, waitingNode], "checkpoint")}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData({ task: { savedPlan: acceptedPlan, aiPlanGenerationStatus: "accepted", status: "WaitingForInput" } })}
        plan={acceptedPlan}
        planGenerationStatus="accepted"
        acceptPlanError={null}
        planningTaskDraft={planningTaskDraft}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[{
          type: "runtime_event",
          action: "start_manual",
          runtimeName: "local",
          provider: "provider",
          event: { type: "tool_started", toolName: "chrona_execution_dispatch", label: "Starting plan" },
        }]}
        onGeneratePlan={onGeneratePlan}
        onPlanLoaded={vi.fn()}
        onApplyPlan={onApplyPlan}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
        onSubmitCheckpointAction={vi.fn()}
      />,
    );

    // The current-operation controls render in the Now tab (default).
    expect(within(commandCenter).getByLabelText(/Decision/)).toBeInTheDocument();
    // Live runtime event content surfaces directly in the Now tab. With a
    // pending checkpoint, the command center keeps the Now tab focused, so the
    // live event is verified there rather than on the Trail tab.
    expect(within(commandCenter).getByText("Tool: Starting plan")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("task-plan-node-checkpoint"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Review generated output" })).toBeInTheDocument());
  });

  it("adds generate plan as the command center operation when no plan exists", () => {
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
        planningTaskDraft={{
          title: "Review task output",
          description: "",
          priority: "Medium",
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
        }}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Generate plan" }));

    expect(onGeneratePlan).toHaveBeenCalledTimes(1);
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
        planningTaskDraft={{
          title: "Review task output",
          description: "",
          priority: "Medium",
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
        }}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Retry Run" }));

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
        planningTaskDraft={{
          title: "Review task output",
          description: "",
          priority: "Medium",
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
        }}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Start plan" }));

    expect(onDispatchExecutionAction).toHaveBeenCalledWith({ action: "start_manual" });
  });

  it("wires selected-node activity into the node drawer", async () => {
    const graphPlan = createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "node-a", title: "Node A", status: "active" }),
      createTaskWorkspaceFixtureNode({ id: "node-b", title: "Node B", status: "ready" }),
    ], "node-a");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "activity-node-a",
        kind: "tool_started",
        title: "Tool started",
        summary: "Read node A",
        description: "Read node A",
        tone: "info",
        timestamp: "2026-05-21T00:00:00.000Z",
        sourceNodeId: "node-a",
        sourceNodeTitle: "Node A",
        tool: { label: "chrona_plan_read", state: "started" },
      }],
      nextCursor: null,
      scope: { type: "node", taskId: "task-1", nodeId: "node-a", limit: 100 },
    }), {
      headers: { "Content-Type": "application/json" },
    }));

    renderWithQueryClient(
      <TaskWorkspacePlanSection
        label="Plan"
        graphPlan={graphPlan}
        isGraphPlanPending={false}
        pageData={createTaskWorkspaceFixturePageData()}
        plan={{ id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel}
        planGenerationStatus="idle"
        acceptPlanError={null}
        planningTaskDraft={{ title: "Review task output", description: "", priority: "Medium", dueAt: null, scheduledStartAt: null, scheduledEndAt: null }}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("task-plan-node-node-a"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Node A" })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("tab", { name: "Activity" }).at(-1)!);

    expect(screen.getByText("Node activity")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Read node A")).toBeInTheDocument());
    expect(screen.queryByText("Read node B")).not.toBeInTheDocument();
  });

  it("adds start plan as the command center operation before execution starts", () => {
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
        planningTaskDraft={{
          title: "Review task output",
          description: "",
          priority: "Medium",
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
        }}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Start plan" }));

    expect(onDispatchExecutionAction).toHaveBeenCalledWith({ action: "start_manual" });
  });

  it("shows accept or regenerate as the command center operation before plan acceptance", () => {
    const onApplyPlan = vi.fn().mockResolvedValue(undefined);
    const onGeneratePlan = vi.fn();
    const draftPlan = {
      id: "plan-1",
      status: "draft",
      revision: 1,
      prompt: "Prefer a smaller plan and keep the first step manual.",
      updatedAt: "2026-05-18T00:00:00.000Z",
    } as TaskPlanReadModel;
    const graphPlan = createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "ready", status: "ready", nextAction: "Start execution" }),
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
        planningTaskDraft={{
          title: "Review task output",
          description: "",
          priority: "Medium",
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
        }}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={onGeneratePlan}
        onPlanLoaded={vi.fn()}
        onApplyPlan={onApplyPlan}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });

    expect(within(commandCenter).getByText("User instruction for this plan revision")).toBeInTheDocument();
    expect(within(commandCenter).getByText("Prefer a smaller plan and keep the first step manual.")).toBeInTheDocument();
    expect(within(commandCenter).queryByText("Current node action")).not.toBeInTheDocument();
    expect(within(commandCenter).queryByRole("button", { name: "Start plan" })).not.toBeInTheDocument();

    fireEvent.change(within(commandCenter).getByLabelText("Plan regeneration instruction"), {
      target: { value: "Add a verification step before accepting the final output." },
    });
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Accept plan" }));
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Regenerate with instruction" }));

    expect(onApplyPlan).toHaveBeenCalledWith(draftPlan);
    expect(onGeneratePlan).toHaveBeenCalledWith({
      userInstruction: "Add a verification step before accepting the final output.",
    });
  });

  it("adds checkpoint controls as the command center operation after execution starts", async () => {
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
        planningTaskDraft={{
          title: "Review task output",
          description: "",
          priority: "Medium",
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
        }}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
        onSubmitCheckpointAction={onSubmitCheckpointAction}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });
    fireEvent.change(within(commandCenter).getByLabelText(/City/), { target: { value: "Shanghai" } });
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Send Submit input" }));

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
        planningTaskDraft={{
          title: "Review task output",
          description: "",
          priority: "Medium",
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
        }}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
        onSubmitCheckpointAction={vi.fn()}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });

    expect(within(commandCenter).queryByText("Current node action")).not.toBeInTheDocument();
    expect(within(commandCenter).queryByLabelText(/City/)).not.toBeInTheDocument();
    expect(within(commandCenter).queryByRole("button", { name: "Send Submit input" })).not.toBeInTheDocument();
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
        planningTaskDraft={{
          title: "创建一个获取天气的脚本",
          description: "",
          priority: "Medium",
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
        }}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
        onSubmitCheckpointAction={onSubmitCheckpointAction}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });

    expect(within(commandCenter).getAllByText(blocker).length).toBeGreaterThan(0);
    expect(within(commandCenter).queryByRole("button", { name: "Start plan" })).not.toBeInTheDocument();

    fireEvent.click(within(commandCenter).getByRole("button", { name: "Send 解决阻塞" }));

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
        planningTaskDraft={{
          title: "创建一个获取天气的脚本",
          description: "",
          priority: "Medium",
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
        }}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });

    // A completed plan reports full progress and exposes no pending action input.
    expect(within(commandCenter).getByText("1/1")).toBeInTheDocument();
    expect(within(commandCenter).queryByText("Ready to run")).not.toBeInTheDocument();
    expect(within(commandCenter).queryByRole("button", { name: "Send input" })).not.toBeInTheDocument();
    expect(within(commandCenter).queryByLabelText(/City/)).not.toBeInTheDocument();
  });

  it("opens and closes the node drawer from selected graph nodes", async () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "review",
      title: "Review task output",
      status: "waiting",
      nextAction: "Review output",
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "review");

    renderWithQueryClient(
      <>
        <button type="button">Top navigation action</button>
        <button type="button">Left navigation action</button>
        <TaskWorkspacePlanSection
          label="Plan"
          graphPlan={graphPlan}
          isGraphPlanPending={false}
          pageData={createTaskWorkspaceFixturePageData()}
          plan={{ id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel}
          planGenerationStatus="idle"
          acceptPlanError={null}
          planningTaskDraft={{
            title: "Review task output",
            description: "",
            priority: "Medium",
            dueAt: null,
            scheduledStartAt: null,
            scheduledEndAt: null,
          }}
          hasUnsavedConfigChanges={false}
          unsavedConfigDraft={null}
          runtimeEvents={[]}
          onGeneratePlan={vi.fn()}
          onPlanLoaded={vi.fn()}
          onApplyPlan={vi.fn()}
          onSaveConfigBeforeRegenerate={vi.fn()}
          onDispatchExecutionAction={vi.fn()}
        />
      </>,
    );

    expect(screen.getByTestId("task-plan-node-review")).toHaveTextContent("Review task output");

    fireEvent.click(screen.getByTestId("task-plan-node-review"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close selected node drawer" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close selected node drawer" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Close selected node drawer" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open selected node drawer" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open selected node drawer" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close selected node drawer" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close selected node drawer" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Close selected node drawer" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open selected node drawer" })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("task-plan-node-review"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close selected node drawer" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close selected node drawer" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Close selected node drawer" })).not.toBeInTheDocument();
    });
  });
});
