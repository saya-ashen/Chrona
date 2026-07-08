import { describe, expect, it } from "vitest";
import type { UiDocument } from "@chrona/ui-protocol";
import { resolveTaskWorkspaceOperationState, type ResolveTaskWorkspaceOperationStateInput } from "../model/task-workspace-operation-machine";
import { createTaskWorkspaceFixtureGraph, createTaskWorkspaceFixtureNode, createTaskWorkspaceFixturePageData } from "../../../apps/web/src/components/tasks/workspace/test-support/task-workspace-test-fixtures";

const actionSpec: UiDocument = {
  root: "root",
  elements: {
    root: { type: "Text", props: { text: "Checkpoint action" } },
  },
};

function baseInput(overrides: Partial<ResolveTaskWorkspaceOperationStateInput> = {}): ResolveTaskWorkspaceOperationStateInput {
  return {
    plan: null,
    planGenerationStatus: "idle",
    canAcceptPlan: false,
    acceptPlanError: null,
    generationUserInstruction: null,
    graphPlan: createTaskWorkspaceFixtureGraph([]),
    pageData: createTaskWorkspaceFixturePageData(),
    currentNode: null,
    selectedNode: null,
    hasTaskCompleted: false,
    hasGraphExecutionStarted: false,
    hasCurrentOperationControls: false,
    shouldShowCurrentOperation: false,
    currentOperationSpec: null,
    currentOperationHandlers: {},
    shouldUseTaskPrimaryAction: false,
    taskPrimaryAction: null,
    runtimeEvents: [],
    ...overrides,
  };
}

describe("resolveTaskWorkspaceOperationState", () => {
  it.each([
    {
      name: "new task without plan",
      input: baseInput(),
      status: "plan-empty",
      action: "generate-plan",
      title: "No accepted plan",
    },
    {
      name: "plan generation running",
      input: baseInput({ planGenerationStatus: "generating", generationUserInstruction: "Draft a smaller plan" }),
      status: "plan-generating",
      action: "none",
      title: "Generating plan…",
    },
    {
      name: "draft plan awaiting review",
      input: baseInput({
        plan: { status: "draft", prompt: "Prefer a small plan", summary: "Draft summary" },
        planGenerationStatus: "waiting_acceptance",
        canAcceptPlan: true,
      }),
      status: "plan-review",
      action: "review-plan",
      title: "Plan ready for review",
    },
    {
      name: "accepted plan not started",
      input: baseInput({
        plan: { status: "accepted", prompt: null, summary: "Accepted summary" },
        planGenerationStatus: "accepted",
        graphPlan: createTaskWorkspaceFixtureGraph([createTaskWorkspaceFixtureNode({ id: "ready", status: "ready" })], "ready"),
      }),
      status: "plan-ready-to-run",
      action: "start-plan",
      title: "Plan accepted",
    },
    {
      name: "accepted plan ready to continue",
      input: baseInput({
        plan: { status: "accepted", prompt: null, summary: "Accepted summary" },
        planGenerationStatus: "accepted",
        taskPrimaryAction: { type: "start", enabled: true, label: "Start" },
        graphPlan: createTaskWorkspaceFixtureGraph([createTaskWorkspaceFixtureNode({ id: "started", status: "cancelled" })], "started"),
        hasGraphExecutionStarted: true,
      }),
      status: "plan-ready-to-run",
      action: "start-plan",
      title: "Plan accepted",
    },
    {
      name: "current checkpoint needs action",
      input: (() => {
        const node = createTaskWorkspaceFixtureNode({
          id: "checkpoint",
          title: "Review checkpoint",
          status: "waiting_for_user",
          statusLabel: "Waiting for input",
          nextAction: "Provide checkpoint input",
        });
        return baseInput({
          plan: { status: "accepted", prompt: null, summary: "Accepted summary" },
          planGenerationStatus: "accepted",
          currentNode: node,
          graphPlan: createTaskWorkspaceFixtureGraph([node], "checkpoint"),
          hasGraphExecutionStarted: true,
          hasCurrentOperationControls: true,
          shouldShowCurrentOperation: true,
          currentOperationSpec: actionSpec,
        });
      })(),
      status: "execution-action",
      action: "current-operation",
      title: "Review checkpoint",
    },
    {
      name: "blocked execution",
      input: (() => {
        const node = createTaskWorkspaceFixtureNode({ id: "blocked", title: "Fix provider", status: "blocked", nextAction: "Retry provider" });
        return baseInput({
          plan: { status: "accepted", prompt: null, summary: "Accepted summary" },
          planGenerationStatus: "accepted",
          pageData: createTaskWorkspaceFixturePageData({ task: { status: "Blocked", blockReason: { blockType: "run_failed", scope: "run", actionRequired: "Retry provider" } } }),
          currentNode: node,
          graphPlan: createTaskWorkspaceFixtureGraph([node], "blocked"),
          hasGraphExecutionStarted: true,
          shouldShowCurrentOperation: true,
          currentOperationSpec: actionSpec,
        });
      })(),
      status: "execution-blocked",
      action: "current-operation",
      title: "Action required",
    },
    {
      name: "completed execution",
      input: baseInput({
        plan: { status: "accepted", prompt: null, summary: "Accepted summary" },
        planGenerationStatus: "accepted",
        pageData: createTaskWorkspaceFixturePageData({ task: { status: "Completed" } }),
        hasTaskCompleted: true,
        hasGraphExecutionStarted: true,
      }),
      status: "execution-completed",
      action: "none",
      title: "Execution completed",
    },
  ])("maps $name to $status", ({ input, status, action, title }) => {
    const state = resolveTaskWorkspaceOperationState(input);

    expect(state.status).toBe(status);
    expect(state.action).toBe(action);
    expect(state.title).toBe(title);
  });
});
