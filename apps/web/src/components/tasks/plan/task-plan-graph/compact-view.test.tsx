import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CompactFocusStack, buildCompactViewModel } from "./compact-view";
import { DEFAULT_GRAPH_COPY } from "./constants";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "./types";

function node(input: Partial<PlanNodeDataModel> & { id: string; status: PlanNodeDataModel["status"] }): PlanNodeDataModel {
  return {
    id: input.id,
    title: input.title ?? input.id,
    objective: input.objective ?? "Complete step",
    phase: input.phase ?? "Execution",
    status: input.status,
    statusLabel: input.statusLabel,
    summary: input.summary,
    interactionType: input.interactionType,
    linkedTaskId: input.linkedTaskId,
  };
}

function plan(nodes: PlanNodeDataModel[]): TaskPlanGraphPlan {
  return {
    state: "ready",
    nodes,
    steps: nodes,
    currentStepId: nodes[0]?.id ?? null,
    edges: nodes.slice(1).map((candidate, index) => ({
      id: `${nodes[index]?.id ?? "node"}-${candidate.id}`,
      from: nodes[index]?.id,
      to: candidate.id,
      kind: "sequential",
    })),
    analytics: {
      entryNodeIds: nodes[0] ? [nodes[0].id] : [],
      terminalNodeIds: nodes.at(-1) ? [nodes.at(-1)!.id] : [],
      activeNodeIds: nodes.filter((candidate) => candidate.status === "active").map((candidate) => candidate.id),
      reachableFromActiveIds: [],
      criticalPathNodeIds: nodes.map((candidate) => candidate.id),
      attentionNodeIds: nodes.filter((candidate) => candidate.status === "waiting_for_user" || candidate.status === "blocked").map((candidate) => candidate.id),
      blockedNodeIds: nodes.filter((candidate) => candidate.status === "blocked").map((candidate) => candidate.id),
      rankByNodeId: Object.fromEntries(nodes.map((candidate, index) => [candidate.id, index])),
      laneByNodeId: Object.fromEntries(nodes.map((candidate) => [candidate.id, 0])),
      upstreamByNodeId: {},
      downstreamByNodeId: {},
    },
  };
}

describe("compact task plan graph view", () => {
  it("builds localized stage and relationship copy without Chinese fallback text", () => {
    const model = buildCompactViewModel(plan([
      node({ id: "active", status: "active", statusLabel: "Running", summary: "Current execution" }),
      node({ id: "blocked", status: "blocked", statusLabel: "Blocked", summary: "Needs retry" }),
    ]), DEFAULT_GRAPH_COPY);

    expect(model.stages.map((stage) => stage.title)).toEqual(["Entry", "Stage 2"]);
    expect(model.focusItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "active", relationLabel: "1 downstream" }),
      expect.objectContaining({ id: "blocked", relationLabel: "1 upstream" }),
    ]));
  });

  it("wraps long focus content and keeps current/action states visible", () => {
    const onSelect = vi.fn();
    const items = buildCompactViewModel(plan([
      node({
        id: "current",
        status: "active",
        statusLabel: "Running",
        title: "A very long current node title that should wrap rather than forcing horizontal overflow in mobile layouts",
        summary: "A very long summary that should remain constrained to the card width for the 390px viewport contract.",
      }),
      node({ id: "approval", status: "waiting_for_user", statusLabel: "Review", interactionType: "approve", summary: "Needs approval" }),
    ]), DEFAULT_GRAPH_COPY).focusItems;

    render(
      <CompactFocusStack
        items={items}
        selectedNodeId={null}
        onSelect={onSelect}
        graphCopy={DEFAULT_GRAPH_COPY}
        summary={{ nodes: 2, active: 1, attention: 1, done: 0, currentLabel: "Current node", statusLabel: "Running" }}
      />,
    );
    expect(screen.queryByText("Current progress")).not.toBeInTheDocument();
    expect(screen.queryByText("2 nodes")).not.toBeInTheDocument();
    expect(screen.queryByText("1 active")).not.toBeInTheDocument();
    expect(screen.getByText("Current node")).toBeInTheDocument();
    expect(screen.getByText("Needs action")).toBeInTheDocument();
    expect(screen.getByText(/very long current node title/)).toHaveClass("break-words");

    fireEvent.click(screen.getByTestId("task-plan-outline-node-current"));
    expect(onSelect).toHaveBeenCalledWith("current");
  });
});
