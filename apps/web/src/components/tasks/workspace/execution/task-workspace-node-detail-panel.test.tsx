import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskWorkspaceNodeDetailPanel } from "./task-workspace-node-detail-panel";
import { createTaskWorkspaceFixtureNode } from "../test-support/task-workspace-test-fixtures";
import type { NodeDetailPanelState } from "../model/task-workspace-types";

const checkpoint = {
  id: "run-1:approval:user_input",
  taskId: "task-1",
  sessionId: "session-1",
  planRunId: "run-1",
  nodeId: "approval",
  kind: "user_input" as const,
  title: "Action required",
  message: "Continue node",
  severity: "info" as const,
  availableActions: [],
  createdAt: "2026-05-21T00:00:00.000Z",
};

function detail(overrides: Partial<NodeDetailPanelState> = {}): NodeDetailPanelState {
  const currentNode = overrides.currentNode ?? null;

  return {
    selectedNode: currentNode,
    currentNode,
    title: currentNode?.title ?? "No plan node selected",
    description: currentNode?.summary ?? currentNode?.objective ?? "Generate or select a plan node to inspect execution details.",
    status: currentNode ? "waiting" : null,
    stepPosition: currentNode ? "1/1" : "0/0",
    autoRefreshEnabled: false,
    tabs: ["result", "activity", "action", "configuration"],
    isEmpty: !currentNode,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
}

if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => undefined;
}

if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => undefined;
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => undefined;
}

describe("TaskWorkspaceNodeDetailPanel", () => {
  it("renders the empty node detail state", () => {
    render(<TaskWorkspaceNodeDetailPanel detail={detail()} activity={[]} selectedNodes={[]} onSubmitCheckpointAction={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Current node details" })).toBeInTheDocument();
    expect(screen.getByText("No active node selected")).toBeInTheDocument();
    expect(screen.getByText("Select a plan node, generate a plan, or wait for execution to expose the current node details here.")).toBeInTheDocument();
  });

  it("renders result, activity, action, and node details for a selected node", async () => {
    const dispatchAction = vi.fn().mockResolvedValue({ message: "Action sent" });
    const node = createTaskWorkspaceFixtureNode({
      id: "approval",
      title: "Approve generated patch",
      objective: "Review patch safety",
      phase: "Review",
      status: "waiting",
      statusLabel: "Approval needed",
      summary: "Patch is ready for human review.",
      nextAction: "Approve or request changes",
      interactionType: "approve",
      dependencies: ["research"],
      checkpoint,
      availableActions: [{ id: "approve_result", label: "Accept", kind: "approve", emphasis: "primary", checkpointId: checkpoint.id, checkpointAction: "approve_result" }],
      interactiveFields: [{ key: "checkpoint:decision", label: "Decision", value: "", control: "approval", required: true }],
      completionSummary: "Generated patch touches task workspace only.",
      resultOutputs: [{ kind: "text", content: "Patch summary" }],
      resultEvidence: { runtimeName: "hermes", runId: "run-1", artifactIds: ["artifact-1"] },
      metadata: { dependencies: [{ id: "research", title: "Research current task workspace" }] },
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({
      currentNode: node,
      selectedNode: node,
      status: "approval-needed",
      autoRefreshEnabled: true,
    })} activity={[{
        id: "activity-1",
        kind: "tool_started",
        title: "Tool started",
        summary: "chrona_plan_read",
        description: "chrona_plan_read",
        tone: "info",
        timestamp: "2026-05-21T00:01:00.000Z",
        sourceNodeId: "approval",
        sourceNodeTitle: "Approve generated patch",
        tool: { label: "chrona_plan_read", state: "started" },
      }]} selectedNodes={[node]} onSubmitCheckpointAction={dispatchAction} />);

    expect(screen.getByRole("heading", { name: "Current node: Approve generated patch" })).toBeInTheDocument();
    expect(screen.getByText("Step 1/1")).toBeInTheDocument();
    expect(screen.getByText("Auto-refresh")).toBeInTheDocument();
    expect(screen.getByText("Result summary")).toBeInTheDocument();
    expect(screen.getAllByText("Generated patch touches task workspace only.").length).toBeGreaterThan(0);
    expect(screen.getByText("Patch summary")).toBeInTheDocument();
    expect(screen.queryByText("Key evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Execution panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Current node")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    expect(screen.getByText("Node activity")).toBeInTheDocument();
    expect(screen.getByText("chrona_plan_read")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Evidence" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Action" }));

    expect(screen.getByText("Action required")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Decision").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Send Accept" })).toBeDisabled();
    fireEvent.pointerDown(screen.getByRole("combobox"), { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("option", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Accept" }));
    await waitFor(() => expect(dispatchAction).toHaveBeenCalledWith(expect.objectContaining({
      checkpointId: checkpoint.id,
      action: "approve_result",
    })));

    expect(screen.queryByRole("tab", { name: "Configuration" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    expect(screen.getByText("Review patch safety")).toBeInTheDocument();
    expect(screen.getByText("Research current task workspace")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("submits free-form input nodes without requiring a predefined action", async () => {
    const dispatchAction = vi.fn().mockResolvedValue({ message: "Input sent" });
    const node = createTaskWorkspaceFixtureNode({
      id: "input-node",
      title: "Collect city",
      status: "waiting_for_user",
      interactionType: "input",
      checkpoint: { ...checkpoint, id: "run-1:input-node:user_input", nodeId: "input-node" },
      availableActions: [],
      interactiveFields: [
        { key: "city", label: "默认城市", value: "", required: true },
        { key: "extra", label: "额外需求", value: "" },
      ],
      nextAction: "Provide missing task details",
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, status: "approval-needed" })} activity={[]} selectedNodes={[node]} onSubmitCheckpointAction={dispatchAction} />);

    fireEvent.click(screen.getByRole("tab", { name: "Action" }));

    expect(screen.getByRole("button", { name: "Send input" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/默认城市/), { target: { value: "北京" } });
    fireEvent.change(screen.getByLabelText(/额外需求/), { target: { value: "无" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send input" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send input" }));

    await waitFor(() => expect(dispatchAction).toHaveBeenCalledWith({
      checkpointId: "run-1:input-node:user_input",
      action: "submit_input",
      payload: {
        inputFields: { city: "北京", extra: "无" },
        message: "默认城市: 北京\n额外需求: 无",
      },
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Input sent");
  });

  it("shows submitted input in a read-only form for completed input nodes", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "input-node",
      title: "Collect city",
      status: "done",
      interactionType: "observe",
      availableActions: [],
      interactiveFields: [
        { key: "city", label: "默认城市", value: "", required: true },
        { key: "extra", label: "额外需求", value: "" },
      ],
      inputFields: { city: "北京", extra: "无" },
      nextAction: "Provide missing task details",
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, status: "completed" })} activity={[]} selectedNodes={[node]} onSubmitCheckpointAction={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "Action" }));

    expect(screen.getByText("Submitted input")).toBeInTheDocument();
    expect(screen.getByLabelText(/默认城市/)).toHaveValue("北京");
    expect(screen.getByLabelText(/额外需求/)).toHaveValue("无");
    expect(screen.getByLabelText(/默认城市/)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/额外需求/)).toHaveAttribute("readonly");
    expect(screen.getAllByText("submitted")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Send/ })).not.toBeInTheDocument();
    expect(screen.queryByText("This node does not require free-form input.")).not.toBeInTheDocument();
  });

  it("shows structured submitted input values from checkpoint results", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "input-node",
      title: "Confirm script requirements",
      status: "done",
      interactionType: "observe",
      availableActions: [],
      interactiveFields: [
        { key: "location", label: "默认查询地点或地点输入方式", value: "", required: true },
        { key: "format", label: "输出格式要求", value: "", control: "select", options: ["无", "Markdown", "JSON"] },
        { key: "runtime", label: "运行环境或语言偏好", value: "" },
        { key: "missing", label: "未提交字段", value: "" },
      ],
      completionSummary: "Checkpoint completed: 确认脚本需求",
      inputFields: {
        location: "北京",
        format: "无",
        runtime: "无",
      },
      resultOutputs: [{
        kind: "json",
        value: {
          inputFields: {
            location: "北京",
            format: "无",
            runtime: "无",
          },
        },
      }],
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, status: "completed" })} activity={[]} selectedNodes={[node]} onSubmitCheckpointAction={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "Action" }));

    expect(screen.getByLabelText(/默认查询地点或地点输入方式/)).toHaveValue("北京");
    expect(screen.getByLabelText(/输出格式要求/)).toHaveTextContent("无");
    expect(screen.getByLabelText(/运行环境或语言偏好/)).toHaveValue("无");
    expect(screen.getByLabelText(/未提交字段/)).toHaveValue("");
    expect(screen.queryByDisplayValue(/Checkpoint completed/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/输出格式要求/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Send/ })).not.toBeInTheDocument();
  });

  it("copies result text through the clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const node = createTaskWorkspaceFixtureNode({
      id: "done",
      title: "Completed step",
      objective: "Finish work",
      phase: "Done",
      status: "done",
      completionSummary: "Finished research",
      resultOutputs: [{ kind: "text", content: "Patch summary" }],
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, status: "completed" })} activity={[]} selectedNodes={[node]} onSubmitCheckpointAction={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy result" }));

    await screen.findByText("Copied result.");
    expect(writeText).toHaveBeenCalledWith("Finished research\n\nPatch summary");
  });

  it("renders no-result and no-action states when selected node has no outputs or actions", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "observe",
      title: "Observe queue",
      objective: "Wait for scheduler",
      phase: "Execution",
      status: "waiting",
      interactionType: "wait",
      availableActions: [],
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, disabledActionReason: "No actions are available for this node." })} activity={[]} selectedNodes={[node]} onSubmitCheckpointAction={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "Action" }));

    expect(screen.getByText("This node is waiting on an external event, so there is no manual form to fill here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supplement info" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Result" }));

    expect(screen.getByText("No run result yet for this node.")).toBeInTheDocument();
  });
});
