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
      resultOutputs: [{
        root: "root",
        elements: {
          root: { type: "Stack", props: {}, children: ["content"] },
          content: { type: "Markdown", props: { content: "Patch summary" } },
        },
      }],
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

    expect(screen.getByText("Patch summary")).toBeInTheDocument();

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
      resultOutputs: [],
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node })} activity={[]} selectedNodes={[node]} />);

    expect(screen.getByText("This node completed without a user-visible deliverable.")).toBeInTheDocument();
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
      resultOutputs: [],
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, status: "completed" })} activity={[]} selectedNodes={[node]} />);

    expect(screen.getByText("This node completed without a user-visible deliverable.")).toBeInTheDocument();
    expect(screen.queryByText(/Structured result is ready/)).not.toBeInTheDocument();
  });

  it("renders expanded drawer content as a selectable fixed panel", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "drawer-node",
      title: "Drawer node",
      status: "done",
      completionSummary: "Selectable result text",
    });

    render(<TaskWorkspaceNodeDetailPanel detail={detail({ currentNode: node, selectedNode: node, status: "completed" })} activity={[]} selectedNodes={[node]} variant="drawer" drawerSize="expanded" />);

    const drawer = screen.getByLabelText("Current node details");
    expect(drawer).toHaveAttribute("data-node-detail-drawer", "true");
    expect(drawer).not.toHaveAttribute("data-vaul-drawer");
    expect(drawer).toHaveClass("select-text");
  });

  it("renders json-render Spec result output via SpecRenderer", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "ui-result",
      title: "UI result node",
      status: "done",
      resultOutputs: [{
        root: "root",
        elements: {
          root: { type: "Stack", props: {}, children: ["content"] },
          content: { type: "Markdown", props: { content: "## AI Result\n\nThis is the AI-produced UI output." } },
        },
      }],
    });

    render(<TaskWorkspaceNodeDetailPanel
      detail={detail({ currentNode: node, selectedNode: node, status: "completed" })}
      activity={[]}
      selectedNodes={[node]}
    />);

    expect(screen.getByText("AI Result")).toBeInTheDocument();
    expect(screen.getByText("This is the AI-produced UI output.")).toBeInTheDocument();
  });

  it("renders lowercase json-render report output with a repaired root", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "ui-lowercase-result",
      title: "Lowercase UI result node",
      status: "done",
      resultOutputs: [{
        root: "github_trending_report",
        elements: {
          heading: { type: "heading", props: { text: "GitHub Trending" } },
          summary_text: { type: "paragraph", props: { text: "Daily report" } },
          table: { type: "table", props: { columns: ["Repo"], rows: [["chrona"]] } },
        },
      }],
    });

    render(<TaskWorkspaceNodeDetailPanel
      detail={detail({ currentNode: node, selectedNode: node, status: "completed" })}
      activity={[]}
      selectedNodes={[node]}
    />);

    expect(screen.getByText("GitHub Trending")).toBeInTheDocument();
    expect(screen.getByText("Daily report")).toBeInTheDocument();
    expect(screen.getByText("chrona")).toBeInTheDocument();
  });


  it("does not render typed fallback when result output is invalid for SpecRenderer", () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "ui-compat",
      title: "Compat fallback node",
      status: "done",
      resultOutputs: [
        {
          root: "root",
          elements: {
            root: { type: "Stack", props: {}, children: ["content"] },
            content: { type: "UnknownComponent", props: { content: "Should not render via spec" } },
          },
        },
      ],
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
