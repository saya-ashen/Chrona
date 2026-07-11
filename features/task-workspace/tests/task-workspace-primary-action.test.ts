import { describe, expect, it } from "vitest";
import type { TaskAction } from "@chrona/contracts";
import {
  dispatchInputForPrimaryAction,
  primaryActionTone,
  resolveCommandCenterPrimaryAction,
  type CommandCenterPrimaryActionInput,
} from "./task-workspace-model";

function input(overrides: Partial<CommandCenterPrimaryActionInput> = {}): CommandCenterPrimaryActionInput {
  return {
    hasPlan: true,
    planStatus: "accepted",
    isPlanAwaitingAcceptance: false,
    planGenerationStatus: "accepted",
    isGeneratingPlan: false,
    hasTaskCompleted: false,
    hasGraphExecutionStarted: true,
    shouldUseTaskPrimaryAction: false,
    taskPrimaryAction: null,
    shouldShowCurrentOperation: false,
    currentOperationStatusLabel: null,
    currentOperationDescription: null,
    currentOperationTone: "info",
    primaryStateLabel: null,
    taskStatus: "Ready",
    runnabilitySummary: null,
    blockActionRequired: null,
    blockType: null,
    ...overrides,
  };
}

function action(type: TaskAction["type"], overrides: Partial<TaskAction> = {}): TaskAction {
  return { type, enabled: true, label: type, ...overrides };
}

describe("task workspace primary action", () => {
  it("covers the primary action decision matrix from plan generation through completed execution", () => {
    expect(resolveCommandCenterPrimaryAction(input({ hasPlan: false, planGenerationStatus: "idle" }))).toMatchObject({
      kind: "generate",
      label: "Generate plan",
      disabled: false,
      tone: "info",
    });

    expect(resolveCommandCenterPrimaryAction(input({
      hasPlan: false,
      planGenerationStatus: "generating",
      isGeneratingPlan: true,
    }))).toMatchObject({
      kind: "generate",
      label: "Generating...",
      disabled: true,
      isLoading: true,
      statusLabel: "generating",
    });

    expect(resolveCommandCenterPrimaryAction(input({
      planStatus: "draft",
      planGenerationStatus: "waiting_acceptance",
      isPlanAwaitingAcceptance: true,
      hasGraphExecutionStarted: false,
    }))).toMatchObject({
      kind: "accept-or-regenerate",
      label: "Accept or regenerate plan",
      statusLabel: "waiting_acceptance",
    });

    expect(resolveCommandCenterPrimaryAction(input({ hasGraphExecutionStarted: false }))).toMatchObject({
      kind: "start-plan",
      label: "Start plan",
      tone: "success",
      statusLabel: "accepted",
    });

    expect(resolveCommandCenterPrimaryAction(input({
      hasGraphExecutionStarted: true,
      taskPrimaryAction: action("start", { label: "Start" }),
    }))).toMatchObject({
      kind: "start-plan",
      label: "Continue plan",
      tone: "success",
      statusLabel: "accepted",
    });

    expect(resolveCommandCenterPrimaryAction(input({
      hasTaskCompleted: true,
      primaryStateLabel: "Completed",
      taskStatus: "Completed",
    }))).toMatchObject({
      kind: "task-completed",
      label: "Task completed",
      statusLabel: "Completed",
      tone: "success",
      suppressAttentionCard: true,
    });
  });

  it("prefers enabled task primary actions before generic current operation prompts", () => {
    expect(resolveCommandCenterPrimaryAction(input({
      shouldUseTaskPrimaryAction: true,
      taskPrimaryAction: action("resume", { label: "Resume after unblock" }),
      shouldShowCurrentOperation: true,
      currentOperationDescription: "Approve checkpoint",
      primaryStateLabel: "Blocked",
      taskStatus: "Blocked",
      runnabilitySummary: "Execution is blocked",
      blockActionRequired: "Resolve blocker",
      blockType: "tool_failure",
    }))).toMatchObject({
      kind: "task-primary-action",
      label: "Resume after unblock",
      description: "Execution is blocked",
      statusLabel: "tool_failure",
      tone: "warning",
    });
  });

  it("uses current operation details after execution starts when no task action is dispatchable", () => {
    expect(resolveCommandCenterPrimaryAction(input({
      shouldShowCurrentOperation: true,
      currentOperationStatusLabel: "waiting_for_user",
      currentOperationDescription: "Confirm the deployment window",
      currentOperationTone: "warning",
      primaryStateLabel: "Running",
      taskStatus: "Running",
    }))).toMatchObject({
      kind: "current-operation",
      label: "Current node action",
      description: "Confirm the deployment window",
      statusLabel: "waiting_for_user",
      tone: "warning",
    });
  });

  it("falls back to no-operation for started plans without an actionable checkpoint", () => {
    expect(resolveCommandCenterPrimaryAction(input({
      primaryStateLabel: "Running",
      taskStatus: "Running",
    }))).toMatchObject({
      kind: "no-operation",
      label: "No current operation",
      statusLabel: "Running",
      tone: "neutral",
      suppressAttentionCard: true,
    });
  });

  it("maps dispatchable task actions without manufacturing inputs for review-only actions", () => {
    expect(dispatchInputForPrimaryAction(action("start"), null)).toEqual({ action: "start_manual" });
    expect(dispatchInputForPrimaryAction(action("retry_sync"), "node-1")).toEqual({ action: "retry_node", nodeId: "node-1" });
    expect(dispatchInputForPrimaryAction(action("retry_sync"), null)).toBeNull();
    expect(dispatchInputForPrimaryAction(action("resume"), "node-1")).toEqual({ action: "resume_after_unblock", nodeId: "node-1" });
    expect(dispatchInputForPrimaryAction(action("resume"), null)).toEqual({ action: "resume_after_unblock" });
    expect(dispatchInputForPrimaryAction(action("cancel"), "node-1")).toEqual({ action: "cancel_session" });
    expect(dispatchInputForPrimaryAction(action("pause"), "node-1")).toEqual({ action: "pause_session" });
    expect(dispatchInputForPrimaryAction(action("provide_input"), "node-1")).toBeNull();
    expect(dispatchInputForPrimaryAction(action("approve"), "node-1")).toBeNull();
    expect(dispatchInputForPrimaryAction(action("repair_inconsistency"), "node-1")).toBeNull();
  });

  it("keeps action tone severity stable for blocked and permission-limited states", () => {
    expect(primaryActionTone(action("retry_sync"))).toBe("critical");
    expect(primaryActionTone(action("cancel_execution"))).toBe("critical");
    expect(primaryActionTone(action("resume"))).toBe("warning");
    expect(primaryActionTone(action("approve"))).toBe("warning");
    expect(primaryActionTone(action("start"))).toBe("success");
    expect(primaryActionTone(action("none", { enabled: false }))).toBe("neutral");
    expect(primaryActionTone(action("repair_inconsistency"))).toBe("neutral");
  });
});
