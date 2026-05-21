import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

afterEach(() => {
  cleanup();
});

describe("TaskWorkspacePlanSection", () => {
  it("adds generate plan as the command center operation when no plan exists", () => {
    const onGeneratePlan = vi.fn();

    render(
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

  it("adds start plan as the command center operation before execution starts", () => {
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({});
    const graphPlan = createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "ready", status: "ready", nextAction: "Start execution" }),
    ], "ready");

    render(
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

    render(
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

    expect(within(commandCenter).getByText("Accept or regenerate plan")).toBeInTheDocument();
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

    render(
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

    render(
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

    expect(within(commandCenter).getByText("Current node action")).toBeInTheDocument();
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

    render(
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

    expect(within(commandCenter).getByText("Task completed")).toBeInTheDocument();
    expect(within(commandCenter).queryByText("请提供创建天气脚本所需的关键信息。")).not.toBeInTheDocument();
    expect(within(commandCenter).queryByText("Ready to run")).not.toBeInTheDocument();
    expect(within(commandCenter).queryByRole("button", { name: "Send input" })).not.toBeInTheDocument();
  });

  it("collapses the node drawer when clicking outside the drawer", async () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "review",
      title: "Review task output",
      status: "waiting",
      nextAction: "Review output",
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "review");

    render(
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

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("complementary", { name: "Task command center" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Hide" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open selected node drawer" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Top navigation action" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Hide" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("task-plan-node-review"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Left navigation action" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Hide" })).not.toBeInTheDocument();
    });
  });
});
