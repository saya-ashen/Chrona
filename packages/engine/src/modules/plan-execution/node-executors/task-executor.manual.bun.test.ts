import { describe, expect, it } from "bun:test";
import type { EffectivePlanGraph, EffectivePlanNode, NodeActionForm, NodeAttempt } from "@chrona/contracts/ai";
import { TaskNodeExecutor } from "./task-executor";
import type { NodeExecutorInput } from "./types";
import { ManualCompletionFormReviewError } from "../manual-completion-form-review";

const actionForm: NodeActionForm = {
  revision: "sha256:reviewed-form",
  source: "runtime_ai",
  validated: true,
  instructions: "Record the inspection result.",
  submitLabel: "Complete and continue",
  inputFields: [{ kind: "text", name: "inspection", label: "Inspection", multiline: true, required: true }],
};

function executorInput(): NodeExecutorInput {
  const node: EffectivePlanNode = {
    id: "manual-node",
    nodeId: "manual-node",
    activeLayerId: "layer-1",
    semanticKey: "manual-node",
    definition: {
      title: "Inspect every plant",
      objective: "Inspect soil and leaves",
      semantics: { type: "task", mode: "manual" },
      executor: "user",
    },
    invalidated: false,
    localId: "manual-node",
    type: "task",
    title: "Inspect every plant",
    config: {
      expectedOutput: "Per-plant results",
      completionCriteria: "Every plant checked",
      completionForm: {
        instructions: actionForm.instructions,
        submitLabel: actionForm.submitLabel,
        inputFields: [{ kind: "text", name: "inspection", label: "Inspection", multiline: true, required: true }],
      },
    },
    executor: "user",
    mode: "manual",
    dependencies: [],
    dependents: [],
    status: "pending",
    attempts: 0,
    metadata: {},
    dependenciesSatisfied: true,
    ready: true,
    reachable: true,
  };
  const plan: EffectivePlanGraph = {
    graphId: "graph-1",
    basePlanId: "plan-1",
    resolvedAt: new Date(0).toISOString(),
    resolvedVersion: 1,
    nodes: [node],
    edges: [],
    entryNodeIds: [node.id],
    terminalNodeIds: [node.id],
    readyNodeIds: [node.id],
    blockedNodeIds: [],
    waitingNodeIds: [],
    waitingForUserNodeIds: [],
    waitingForApprovalNodeIds: [],
    degradedNodeIds: [],
    skippedNodeIds: [],
    cancelledNodeIds: [],
    completedNodeIds: [],
    runningNodeIds: [],
    invalidatedNodeIds: [],
    failedNodeIds: [],
    pendingNodeIds: [node.id],
  };
  const attempt: NodeAttempt = {
    id: "attempt-1",
    taskId: "task-1",
    graphId: plan.graphId,
    nodeId: node.id,
    nodeLayerId: node.activeLayerId!,
    executionContextSnapshotId: "context-1",
    attemptNumber: 1,
    idempotencyKey: "attempt-1",
    status: "running",
    startedAt: new Date(0).toISOString(),
  };
  return {
    taskId: "task-1",
    mainSession: { id: "session-1", taskId: "task-1", sessionKey: "session-1" },
    node,
    plan,
    planContext: { title: "Plant care", goal: "Healthy plants", assumptions: [] },
    attempt,
    trigger: "manual",
    runtimeName: "omp",
  };
}

describe("TaskNodeExecutor manual completion", () => {
  it("reviews the form and pauses as normal manual completion", async () => {
    const executor = new TaskNodeExecutor({} as never, async () => actionForm);
    const result = await executor.execute(executorInput());
    expect(result).toMatchObject({
      status: "waiting_for_user",
      waitKind: "manual_completion",
      actionForm,
    });
  });

  it("turns provider review failure into a safe retryable node failure", async () => {
    const executor = new TaskNodeExecutor({} as never, async () => {
      throw new ManualCompletionFormReviewError(
        "MANUAL_FORM_REVIEW_RESULT_INVALID",
        "raw provider details",
        "feature-run-1",
      );
    });
    const result = await executor.execute(executorInput());
    expect(result).toEqual({
      status: "failed",
      error: "Manual completion form preparation failed.",
      details: {
        code: "MANUAL_FORM_REVIEW_RESULT_INVALID",
        traceId: "feature-run-1",
      },
      evidence: { sessionId: "session-1" },
    });
  });
});
