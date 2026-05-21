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
        requestGenerationKey={0}
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
        requestGenerationKey={0}
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

  it("adds checkpoint controls as the command center operation after execution starts", async () => {
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({ message: "Input sent" });
    const node = createTaskWorkspaceFixtureNode({
      id: "checkpoint",
      title: "Review checkpoint",
      status: "waiting_for_user",
      nextAction: "Provide checkpoint input",
      requiresHumanInput: true,
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
        requestGenerationKey={0}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });
    fireEvent.change(within(commandCenter).getByLabelText(/City/), { target: { value: "Shanghai" } });
    fireEvent.click(within(commandCenter).getByRole("button", { name: "Send input" }));

    await waitFor(() => {
      expect(onDispatchExecutionAction).toHaveBeenCalledWith({
        action: "resume_with_input",
        nodeId: "checkpoint",
        inputFields: { city: "Shanghai" },
      });
    });
  });

  it("shows blocked current node action with blocker reason before start plan", async () => {
    const blocker = "已创建脚本文件，但当前运行环境访问 wttr.in 连续超时。";
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({ message: "Node resumed" });
    const node = createTaskWorkspaceFixtureNode({
      id: "weather-script",
      title: "创建一个获取天气的脚本",
      status: "blocked",
      interactionType: "retry",
      nextAction: blocker,
      availableActions: [
        { id: "weather-script:resolve", label: "解决阻塞", kind: "resolve", emphasis: "primary" },
        { id: "weather-script:retry", label: "重试节点", kind: "retry", emphasis: "warning" },
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
        requestGenerationKey={0}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });

    expect(within(commandCenter).getByText("Current node action")).toBeInTheDocument();
    expect(within(commandCenter).getAllByText(blocker).length).toBeGreaterThan(0);
    expect(within(commandCenter).queryByRole("button", { name: "Start plan" })).not.toBeInTheDocument();

    fireEvent.click(within(commandCenter).getByRole("button", { name: "Send 解决阻塞" }));

    await waitFor(() => {
      expect(onDispatchExecutionAction).toHaveBeenCalledWith({
        action: "resume_after_unblock",
        nodeId: "weather-script",
        note: blocker,
      });
    });
  });

  it("shows no current operation for completed nodes without actions", () => {
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
        requestGenerationKey={0}
        runtimeEvents={[]}
        onGeneratePlan={vi.fn()}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
        onDispatchExecutionAction={vi.fn()}
      />,
    );

    const commandCenter = screen.getByRole("complementary", { name: "Task command center" });

    expect(within(commandCenter).getByText("No current operation")).toBeInTheDocument();
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
          requestGenerationKey={0}
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
