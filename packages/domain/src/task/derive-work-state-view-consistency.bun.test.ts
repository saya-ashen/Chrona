import { describe, expect, it } from "bun:test";

import {
  deriveWorkStateView,
  type DeriveWorkStateViewInput,
  type WorkStateCanonical,
  type WorkStatePrimaryActionId,
  type WorkStateTone,
} from "./derive-work-state-view";

type ExpectedPresentation = {
  state: WorkStateCanonical;
  label: string;
  tone: WorkStateTone;
  primaryActionId: WorkStatePrimaryActionId;
  nextActionLabel: string;
};

type ConsistencyCase = {
  name: string;
  input: DeriveWorkStateViewInput;
  expected: ExpectedPresentation;
  attentionRequired: boolean;
};

const cases: ConsistencyCase[] = [
  {
    name: "accepted result overrides stale running and plan generation",
    input: {
      taskStatus: "Done",
      executionStatus: "running",
      operationStatus: "plan_generating",
      planGenerationStatus: "generating",
      currentNodeId: "stale-running-node",
    },
    expected: {
      state: "done",
      label: "Task done",
      tone: "success",
      primaryActionId: "ask_follow_up",
      nextActionLabel: "Ask a follow-up or create a next task",
    },
    attentionRequired: false,
  },
  {
    name: "unaccepted completed result overrides stale running operation and planning",
    input: {
      taskStatus: "Completed",
      executionStatus: "running",
      operationStatus: "execution_running",
      planGenerationStatus: "generating",
    },
    expected: {
      state: "result_ready",
      label: "Result ready",
      tone: "info",
      primaryActionId: "accept_result",
      nextActionLabel: "Accept result or request changes",
    },
    attentionRequired: true,
  },
  {
    name: "completed execution overrides stale plan generation",
    input: {
      taskStatus: "Running",
      executionStatus: "completed",
      operationStatus: "plan_generating",
      planGenerationStatus: "generating",
    },
    expected: {
      state: "result_ready",
      label: "Result ready",
      tone: "info",
      primaryActionId: "accept_result",
      nextActionLabel: "Accept result or request changes",
    },
    attentionRequired: true,
  },
  {
    name: "authoritative input wait overrides stale completed execution",
    input: {
      taskStatus: "WaitingForInput",
      executionStatus: "completed",
      operationStatus: "execution_action",
      currentNodeId: "confirm-channels",
    },
    expected: {
      state: "waiting_for_input",
      label: "Input needed",
      tone: "warning",
      primaryActionId: "provide_input",
      nextActionLabel: "Provide the requested input so execution can continue",
    },
    attentionRequired: true,
  },
  {
    name: "approval wait stays distinct despite generic blocked task metadata",
    input: {
      taskStatus: "Blocked",
      executionStatus: "waiting_for_approval",
      blockReason: {
        blockType: "approval_required",
        actionRequired: "Approve checkpoint",
        scope: "plan_node",
      },
    },
    expected: {
      state: "waiting_for_approval",
      label: "Approval needed",
      tone: "warning",
      primaryActionId: "review_approval",
      nextActionLabel: "Review the request, then approve, reject, or request changes",
    },
    attentionRequired: true,
  },
  {
    name: "input wait stays distinct despite generic blocked task metadata",
    input: {
      taskStatus: "Blocked",
      executionStatus: "waiting_for_user",
      blockReason: {
        blockType: "human_input_required",
        actionRequired: "Provide a value",
        scope: "runtime",
      },
    },
    expected: {
      state: "waiting_for_input",
      label: "Input needed",
      tone: "warning",
      primaryActionId: "provide_input",
      nextActionLabel: "Provide the requested input so execution can continue",
    },
    attentionRequired: true,
  },
  {
    name: "blocked state exposes only blocker recovery",
    input: {
      taskStatus: "Blocked",
      executionStatus: "running",
      blockReason: { blockType: "dependency_blocked", detail: "Dependency unavailable", scope: "task" },
    },
    expected: {
      state: "blocked",
      label: "Blocked",
      tone: "danger",
      primaryActionId: "resolve_blocker",
      nextActionLabel: "Resolve the blocker before execution can continue",
    },
    attentionRequired: true,
  },
  {
    name: "failed state exposes retry rather than stale runtime controls",
    input: {
      taskStatus: "Running",
      executionStatus: "failed",
      operationStatus: "execution_running",
    },
    expected: {
      state: "failed",
      label: "Failed",
      tone: "danger",
      primaryActionId: "retry",
      nextActionLabel: "Review the failure reason, then retry or stop",
    },
    attentionRequired: true,
  },
  {
    name: "cancelled state exposes audit rather than stale runtime controls",
    input: {
      taskStatus: "Running",
      executionStatus: "cancelled",
      operationStatus: "execution_running",
    },
    expected: {
      state: "cancelled",
      label: "Cancelled",
      tone: "neutral",
      primaryActionId: "inspect_audit",
      nextActionLabel: "Inspect the audit trail or reopen the task",
    },
    attentionRequired: false,
  },
  {
    name: "running state alone exposes live runtime capabilities",
    input: {
      taskStatus: "Running",
      executionStatus: "running",
      operationStatus: "execution_running",
    },
    expected: {
      state: "running",
      label: "Running",
      tone: "info",
      primaryActionId: "monitor_execution",
      nextActionLabel: "Monitor the current step and next runtime event",
    },
    attentionRequired: false,
  },
];

const presentationForSurface = (view: ReturnType<typeof deriveWorkStateView>) => ({
  state: view.state,
  label: view.label,
  tone: view.tone,
  primaryActionId: view.primaryActionId,
  nextActionLabel: view.nextActionLabel,
});

const sharedStateViewConsumers = ["dashboard", "task list", "workspace", "action center", "schedule"] as const;

describe("canonical work state cross-page consistency", () => {
  for (const stateCase of cases) {
    it(stateCase.name, () => {
      const stateView = deriveWorkStateView(stateCase.input);

      expect(presentationForSurface(stateView)).toEqual(stateCase.expected);
      expect(stateView.attentionRequired).toBe(stateCase.attentionRequired);
      expect({
        showLiveProgress: stateView.showLiveProgress,
        canPause: stateView.canPause,
        canStop: stateView.canStop,
      }).toEqual({
        showLiveProgress: stateCase.expected.state === "running",
        canPause: stateCase.expected.state === "running",
        canStop: stateCase.expected.state === "running",
      });

      for (const surface of sharedStateViewConsumers) {
        expect(presentationForSurface(stateView), `${surface} must consume the canonical presentation unchanged`).toEqual(stateCase.expected);
      }
    });
  }

  it("preserves distinct approval and input blocker contracts", () => {
    const approval = deriveWorkStateView({
      blockReason: {
        blockType: "approval_required",
        actionRequired: "Approve checkpoint",
        scope: "plan_node",
        nodeId: "approval-node",
      },
    });
    const input = deriveWorkStateView({
      blockReason: {
        blockType: "human_input_required",
        detail: "Enter the account number",
        scope: "runtime",
        nodeId: "input-node",
      },
    });

    expect(approval).toMatchObject({
      state: "waiting_for_approval",
      label: "Approval needed",
      primaryActionId: "review_approval",
      currentNodeId: "approval-node",
      blocker: { kind: "approval_required", reason: "Approve checkpoint", scope: "plan_node" },
    });
    expect(input).toMatchObject({
      state: "waiting_for_input",
      label: "Input needed",
      primaryActionId: "provide_input",
      currentNodeId: "input-node",
      blocker: { kind: "human_input_required", reason: "Enter the account number", scope: "runtime" },
    });
  });
});
