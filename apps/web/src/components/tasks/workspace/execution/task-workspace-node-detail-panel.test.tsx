import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskWorkspaceNodeDetailPanel } from "./task-workspace-node-detail-panel";
import { createTaskWorkspaceFixtureNode } from "../test-support/task-workspace-test-fixtures";
import type { NodeDetailPanelState } from "../model/task-workspace-types";

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
    tabs: ["result", "evidence", "action", "configuration"],
    isEmpty: !currentNode,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("TaskWorkspaceNodeDetailPanel", () => {
  it("renders the empty node detail state", () => {
    render(<TaskWorkspaceNodeDetailPanel detail={detail()} selectedNodes={[]} onDispatchExecutionAction={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Current node details" })).toBeInTheDocument();
    expect(screen.getByText("节点详情")).toBeInTheDocument();
    expect(screen.getByText("选择一个节点后查看目标、依赖和后续可操作项。")).toBeInTheDocument();
  });

  it("renders result, evidence, action, and configuration details for a selected node", async () => {
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
      availableActions: [{ id: "approve", label: "Accept", kind: "approve", emphasis: "primary" }],
      interactiveFields: [{ key: "checkpoint:decision", label: "Decision", value: "", control: "approval", required: true }],
      completionSummary: "Generated patch touches task workspace only.",
      resultOutputs: [{ kind: "text", content: "Patch summary" }],
      resultEvidence: { runtimeName: "openclaw", runId: "run-1", artifactIds: ["artifact-1"] },
      metadata: { dependencies: [{ id: "research", title: "Research current task workspace" }] },
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, status: "approval-needed", autoRefreshEnabled: true })} selectedNodes={[node]} onDispatchExecutionAction={dispatchAction} />);

    expect(screen.getByRole("heading", { name: "Current node: Approve generated patch" })).toBeInTheDocument();
    expect(screen.getByText("Step 1/1")).toBeInTheDocument();
    expect(screen.getByText("Auto-refresh")).toBeInTheDocument();
    expect(screen.getByText("Result summary")).toBeInTheDocument();
    expect(screen.getAllByText("Generated patch touches task workspace only.").length).toBeGreaterThan(0);
    expect(screen.getByText("Patch summary")).toBeInTheDocument();
    expect(screen.queryByText("Execution panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Current node")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));

    expect(screen.getAllByText("Evidence").length).toBeGreaterThan(0);
    expect(screen.getByText(/runtime=openclaw/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Action" }));

    expect(screen.getByText("Action required")).toBeInTheDocument();
    expect(screen.getAllByText("Accept").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Decision").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Send Accept" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Approve" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Accept" }));
    await waitFor(() => expect(dispatchAction).toHaveBeenCalledWith(expect.objectContaining({
      action: "resume_with_approval",
      nodeId: "approval",
      decision: "approve",
    })));

    fireEvent.click(screen.getByRole("tab", { name: "Configuration" }));

    expect(screen.getByText("Review patch safety")).toBeInTheDocument();
    expect(screen.getByText("Research current task workspace")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
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

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, status: "completed" })} selectedNodes={[node]} onDispatchExecutionAction={vi.fn()} />);

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

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, disabledActionReason: "No actions are available for this node." })} selectedNodes={[node]} onDispatchExecutionAction={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "Action" }));

    expect(screen.getByText("This node is waiting on an external event, so there is no manual form to fill here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supplement info" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Result" }));

    expect(screen.getByText("No run result yet for this node.")).toBeInTheDocument();
  });
});
