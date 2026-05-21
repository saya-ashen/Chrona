import { describe, expect, it } from "vitest";
import type { PlanNodeDataModel } from "@/components/tasks/plan/task-plan-graph/types";
import {
  buildDefaultWorkspaceActionFields,
  buildWorkspaceStateTreatment,
  buildWorkspaceCheckpointActionInput,
  getMissingWorkspaceActionFields,
  getWorkspaceActionDisabledReason,
  pickDefaultWorkspaceAction,
  } from "./task-workspace-actions";

const checkpoint = {
  id: "run-1:node-1:user_input",
  taskId: "task-1",
  sessionId: "session-1",
  planRunId: "run-1",
  nodeId: "node-1",
  kind: "user_input" as const,
  title: "Action required",
  message: "Continue node",
  severity: "info" as const,
  availableActions: [],
  createdAt: "2026-05-21T00:00:00.000Z",
};

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

  it("prefers resolve actions before retry actions for blocked nodes", () => {
    expect(pickDefaultWorkspaceAction(node({
      status: "blocked",
      interactionType: "retry",
      availableActions: [
        { id: "retry", label: "Retry node", kind: "retry", emphasis: "warning" },
        { id: "resolve", label: "Resolve blocker", kind: "resolve", emphasis: "primary" },
      ],
    }))).toBe("resolve");
  });

  it("reports required fields before dispatch", () => {
    const fields = [{ key: "decision", label: "Decision", value: "", required: true }];

    expect(getMissingWorkspaceActionFields(fields, { decision: "" })).toHaveLength(1);
    expect(getWorkspaceActionDisabledReason({ fields, values: { decision: "" }, isDispatching: false })).toBe("Complete required field: Decision.");
    expect(getWorkspaceActionDisabledReason({ fields, values: { decision: "Approve" }, isDispatching: false })).toBeNull();
    expect(getWorkspaceActionDisabledReason({ fields, values: { decision: "Approve" }, isDispatching: true })).toBe("Action is already being sent.");
  });

  it("maps approval and manual execution nodes to checkpoint actions", () => {
    expect(buildWorkspaceCheckpointActionInput({
      node: node({ interactionType: "approve", checkpoint }),
      selectedAction: { id: "approve_result", label: "Approve", kind: "approve", checkpointId: checkpoint.id, checkpointAction: "approve_result" },
      fields: [{ key: "checkpoint:decision", label: "Decision", value: "", control: "approval" }],
      values: { "checkpoint:decision": "Reject" },
    })).toMatchObject({ checkpointId: checkpoint.id, action: "approve_result" });

    expect(buildWorkspaceCheckpointActionInput({
      node: node({ interactionType: "confirm", checkpoint }),
      selectedAction: { id: "reject_result", label: "Reject", kind: "approve", checkpointId: checkpoint.id, checkpointAction: "reject_result" },
      fields: [{ key: "checkpoint:decision", label: "审批决策", value: "", control: "approval" }],
      values: { "checkpoint:decision": "Needs changes" },
    })).toMatchObject({ checkpointId: checkpoint.id, action: "reject_result", payload: { feedback: "审批决策: Needs changes" } });

    expect(buildWorkspaceCheckpointActionInput({
      node: node({ interactionType: "execute", executionMode: "manual", checkpoint }),
      selectedAction: { id: "mark_node_completed", label: "Mark done", kind: "trigger", checkpointId: checkpoint.id, checkpointAction: "mark_node_completed" },
      fields: [{ key: "summary", label: "Summary", value: "" }],
      values: { summary: "Completed outside Chrona" },
    })).toMatchObject({ checkpointId: checkpoint.id, action: "mark_node_completed", payload: { summary: "Summary: Completed outside Chrona" } });
  });

  it("maps resolve actions to resume_after_unblock without changing retry semantics", () => {
    expect(buildWorkspaceCheckpointActionInput({
      node: node({ status: "blocked", interactionType: "retry", nextAction: "Network access recovered", checkpoint }),
      selectedAction: { id: "resume_after_unblock", label: "Resolve blocker", kind: "resolve", checkpointId: checkpoint.id, checkpointAction: "resume_after_unblock" },
      fields: [],
      values: {},
    })).toEqual({
      checkpointId: checkpoint.id,
      action: "resume_after_unblock",
      payload: { reason: "Network access recovered" },
    });

    expect(buildWorkspaceCheckpointActionInput({
      node: node({ status: "blocked", interactionType: "retry", nextAction: "Network timeout", checkpoint }),
      selectedAction: { id: "retry_node", label: "Retry node", kind: "retry", checkpointId: checkpoint.id, checkpointAction: "retry_node" },
      fields: [],
      values: {},
    })).toEqual({
      checkpointId: checkpoint.id,
      action: "retry_node",
      payload: { prompt: "Network timeout" },
    });
  });

  it("maps resolve actions with form fields to checkpoint input", () => {
    expect(buildWorkspaceCheckpointActionInput({
      node: node({ status: "blocked", interactionType: "retry", nextAction: "Provide credentials", checkpoint }),
      selectedAction: { id: "submit_input", label: "Resolve blocker", kind: "resolve", checkpointId: checkpoint.id, checkpointAction: "submit_input" },
      fields: [
        { key: "apiKey", label: "API key", value: "", required: true },
        { key: "notes", label: "Notes", value: "" },
      ],
      values: { apiKey: "secret", notes: "Use production account" },
    })).toEqual({
      checkpointId: checkpoint.id,
      action: "submit_input",
      payload: {
        inputFields: { apiKey: "secret", notes: "Use production account" },
        message: "API key: secret\nNotes: Use production account",
      },
    });
  });

  it("maps field-only input nodes to checkpoint input", () => {
    expect(buildWorkspaceCheckpointActionInput({
      node: node({ nextAction: "Collect missing information", checkpoint }),
      selectedAction: null,
      fields: [
        { key: "city", label: "默认城市", value: "", required: true },
        { key: "extra", label: "额外需求", value: "" },
      ],
      values: { city: "北京", extra: "无" },
    })).toEqual({
      checkpointId: checkpoint.id,
      action: "submit_input",
      payload: {
        inputFields: { city: "北京", extra: "无" },
        message: "默认城市: 北京\n额外需求: 无",
      },
    });
  });
});
