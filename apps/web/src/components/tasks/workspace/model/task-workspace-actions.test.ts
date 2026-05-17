import { describe, expect, it } from "vitest";
import type { PlanNodeDataModel } from "@/components/tasks/plan/task-plan-graph/types";
import {
  buildDefaultWorkspaceActionFields,
  buildWorkspaceStateTreatment,
  buildWorkspaceActionInput,
  getMissingWorkspaceActionFields,
  getWorkspaceActionDisabledReason,
  pickDefaultWorkspaceAction,
} from "./task-workspace-actions";

function node(overrides: Partial<PlanNodeDataModel> = {}): PlanNodeDataModel {
  return {
    id: "node-1",
    title: "Review output",
    objective: "Review generated result",
    phase: "Review",
    status: "waiting_for_user",
    interactionType: "input",
    ...overrides,
  };
}

describe("task workspace actions", () => {
  it("derives shared workspace presentation treatment", () => {
    expect(buildWorkspaceStateTreatment({
      currentNode: node({ status: "active", nextAction: "Monitor run" }),
      hasPlan: true,
      allNodesDone: false,
    })).toEqual({ label: "Running", tone: "info", guidance: "Monitor run" });

    expect(buildWorkspaceStateTreatment({
      currentNode: node({ status: "blocked", nextAction: "Retry node" }),
      hasPlan: true,
      allNodesDone: false,
    })).toEqual({ label: "Blocked", tone: "critical", guidance: "Retry node" });

    expect(buildWorkspaceStateTreatment({
      currentNode: null,
      hasPlan: false,
      allNodesDone: false,
    })).toMatchObject({ label: "No plan yet", tone: "neutral" });
  });

  it("selects the primary action and builds default field values", () => {
    const fields = [{ key: "comment", label: "Comment", value: "Looks good" }];
    const selected = pickDefaultWorkspaceAction(node({
      availableActions: [
        { id: "secondary", label: "Later", kind: "observe" },
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
      ],
    }));

    expect(selected).toBe("approve");
    expect(buildDefaultWorkspaceActionFields(fields)).toEqual({ comment: "Looks good" });
  });

  it("reports required fields before dispatch", () => {
    const fields = [{ key: "decision", label: "Decision", value: "", required: true }];

    expect(getMissingWorkspaceActionFields(fields, { decision: "" })).toHaveLength(1);
    expect(getWorkspaceActionDisabledReason({ fields, values: { decision: "" }, isDispatching: false })).toBe("Complete required field: Decision.");
    expect(getWorkspaceActionDisabledReason({ fields, values: { decision: "Approve" }, isDispatching: false })).toBeNull();
    expect(getWorkspaceActionDisabledReason({ fields, values: { decision: "Approve" }, isDispatching: true })).toBe("Action is already being sent.");
  });

  it("maps approval and manual execution nodes to existing backend actions", () => {
    expect(buildWorkspaceActionInput({
      node: node({ interactionType: "approve" }),
      selectedAction: { id: "approve", label: "Approve", kind: "approve" },
      fields: [{ key: "checkpoint:decision", label: "Decision", value: "", control: "approval" }],
      values: { "checkpoint:decision": "Reject" },
    })).toMatchObject({ action: "resume_with_approval", nodeId: "node-1", decision: "reject" });

    expect(buildWorkspaceActionInput({
      node: node({ interactionType: "confirm" }),
      selectedAction: { id: "confirm", label: "审批", kind: "approve" },
      fields: [{ key: "checkpoint:decision", label: "审批决策", value: "", control: "approval" }],
      values: { "checkpoint:decision": "Approve" },
    })).toMatchObject({ action: "resume_with_approval", nodeId: "node-1", decision: "approve" });

    expect(buildWorkspaceActionInput({
      node: node({ interactionType: "execute", executionMode: "manual" }),
      selectedAction: { id: "done", label: "Mark done", kind: "trigger" },
      fields: [{ key: "summary", label: "Summary", value: "" }],
      values: { summary: "Completed outside Chrona" },
    })).toMatchObject({ action: "complete_manual_node", nodeId: "node-1", summary: "Summary: Completed outside Chrona" });
  });

  it("maps field-only input nodes to resume_with_input", () => {
    expect(buildWorkspaceActionInput({
      node: node({ nextAction: "Collect missing information" }),
      selectedAction: null,
      fields: [
        { key: "city", label: "默认城市", value: "", required: true },
        { key: "extra", label: "额外需求", value: "" },
      ],
      values: { city: "北京", extra: "无" },
    })).toEqual({
      action: "resume_with_input",
      nodeId: "node-1",
      inputFields: { city: "北京", extra: "无" },
    });
  });
});
