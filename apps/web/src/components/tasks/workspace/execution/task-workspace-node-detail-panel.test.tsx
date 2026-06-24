import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    tabs: ["result", "activity", "configuration"],
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
    render(<TaskWorkspaceNodeDetailPanel detail={detail()} activity={[]} selectedNodes={[]} />);

    expect(screen.getByRole("region", { name: "Current node details" })).toBeInTheDocument();
    expect(screen.getByText("No active node selected")).toBeInTheDocument();
    expect(screen.getByText("Select a plan node, generate a plan, or wait for execution to expose the current node details here.")).toBeInTheDocument();
  });

  it("renders result, activity, and node details for a selected node without an action tab", () => {
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
      completionSummary: "Generated patch touches task workspace only.",
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
      }]} selectedNodes={[node]} />);

    expect(screen.getByRole("heading", { name: "Current node: Approve generated patch" })).toBeInTheDocument();
    expect(screen.getByText("Step 1/1")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Action" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Result" }));
    expect(screen.getByText("No run result yet for this node.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByText("Node activity")).toBeInTheDocument();
    expect(screen.getAllByText("chrona_plan_read").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Review patch safety")).toBeInTheDocument();
    expect(screen.getByText("Research current task workspace")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("renders no result state for node with no Spec output", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "final",
      title: "Format final answer",
      status: "done",
      completionSummary: "Readable final answer",
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node })} activity={[]} selectedNodes={[node]} />);

    expect(screen.getByText("This node completed. User-visible output now lives at plan level.")).toBeInTheDocument();
    expect(screen.queryByText("Readable final answer")).not.toBeInTheDocument();
    expect(screen.queryByText(/runtimeRunRef/)).not.toBeInTheDocument();
  });

  it("renders no result state for a completed node with no Spec output", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "done-json",
      title: "Completed JSON step",
      objective: "Finish structured work",
      phase: "Done",
      status: "done",
      completionSummary: "Structured result is ready",
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, status: "completed" })} activity={[]} selectedNodes={[node]} />);

    expect(screen.getByText("This node completed. User-visible output now lives at plan level.")).toBeInTheDocument();
    expect(screen.queryByText(/Structured result is ready/)).not.toBeInTheDocument();
  });

  it("renders the selected node as an inline details panel, not a floating drawer", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "panel-node",
      title: "Panel node",
      status: "done",
      completionSummary: "Selectable result text",
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, status: "completed" })} activity={[]} selectedNodes={[node]} />);

    const panel = screen.getByLabelText("Current node details");
    // The merged inspector renders node details inline in the right rail — no floating drawer overlay.
    expect(panel).not.toHaveAttribute("data-node-detail-drawer");
    expect(panel).not.toHaveClass("fixed");
  });

  it("renders json-render Spec result output via SpecRenderer", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "ui-result",
      title: "UI result node",
      status: "done",
    });

    render(<TaskWorkspaceNodeDetailPanel
      detail={detail({ currentNode: node, selectedNode: node, status: "completed" })}
      activity={[]}
      selectedNodes={[node]}
    />);

    expect(screen.getByText("This node completed. User-visible output now lives at plan level.")).toBeInTheDocument();
    expect(screen.queryByText("AI Result")).not.toBeInTheDocument();
  });

  it("renders lowercase json-render report output with a repaired root", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "ui-lowercase-result",
      title: "Lowercase UI result node",
      status: "done",
    });

    render(<TaskWorkspaceNodeDetailPanel
      detail={detail({ currentNode: node, selectedNode: node, status: "completed" })}
      activity={[]}
      selectedNodes={[node]}
    />);

    expect(screen.getByText("This node completed. User-visible output now lives at plan level.")).toBeInTheDocument();
    expect(screen.queryByText("GitHub Trending")).not.toBeInTheDocument();
    expect(screen.queryByText("chrona")).not.toBeInTheDocument();
  });


  it("does not render typed fallback when result output is invalid for SpecRenderer", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "ui-compat",
      title: "Compat fallback node",
      status: "done",
    });

    render(<TaskWorkspaceNodeDetailPanel
      detail={detail({ currentNode: node, selectedNode: node, status: "completed" })}
      activity={[]}
      selectedNodes={[node]}
    />);

    expect(screen.queryByText("Should not render via spec")).not.toBeInTheDocument();
  });

  it("renders the no-result state when a selected node has no outputs", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "observe",
      title: "Observe queue",
      objective: "Wait for scheduler",
      phase: "Execution",
      status: "waiting",
      interactionType: "wait",
      availableActions: [],
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node })} activity={[]} selectedNodes={[node]} />);

    expect(screen.queryByRole("tab", { name: "Action" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Result" }));
    expect(screen.getByText("No run result yet for this node.")).toBeInTheDocument();
  });
});
