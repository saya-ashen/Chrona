import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createTaskWorkspaceFixtureGraph,
  createTaskWorkspaceFixtureNode,
} from "../test-support/task-workspace-test-fixtures";
import { useTaskWorkspacePlanSectionState } from "./use-task-workspace-plan-section-state";

describe("useTaskWorkspacePlanSectionState", () => {
  it("refreshes the selected node when the graph updates after accepted input", () => {
    const waitingNode = createTaskWorkspaceFixtureNode({
      id: "input-node",
      title: "Collect city",
      status: "waiting_for_user",
      interactionType: "input",
      nextAction: "Provide missing task details",
      interactiveFields: [{ key: "city", label: "默认城市", value: "", required: true }],
      requiresHumanInput: true,
    });
    const acceptedNode = createTaskWorkspaceFixtureNode({
      id: "input-node",
      title: "Collect city",
      status: "done",
      interactionType: "input",
      completionSummary: "默认城市: 北京",
      resultOutputs: [{ kind: "text", content: "默认城市: 北京" }],
      interactiveFields: [],
      requiresHumanInput: false,
    });
    const waitingGraph = createTaskWorkspaceFixtureGraph([waitingNode], "input-node");
    const acceptedGraph = createTaskWorkspaceFixtureGraph([acceptedNode], "input-node");

    const { result, rerender } = renderHook(
      ({ graphPlan }) => useTaskWorkspacePlanSectionState(graphPlan),
      { initialProps: { graphPlan: waitingGraph } },
    );

    act(() => {
      result.current.handleSelectedPlanNodeChange(waitingNode, [waitingNode]);
    });
    rerender({ graphPlan: acceptedGraph });

    expect(result.current.selectedPlanNode).toBe(acceptedNode);
    expect(result.current.selectedPlanNode?.status).toBe("done");
    expect(result.current.selectedPlanNode?.interactiveFields).toEqual([]);
    expect(result.current.selectedPlanNode?.completionSummary).toBe("默认城市: 北京");
    expect(result.current.selectedPlanNodes).toEqual([acceptedNode]);
  });
});
