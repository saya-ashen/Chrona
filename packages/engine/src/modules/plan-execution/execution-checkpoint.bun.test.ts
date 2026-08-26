import { describe, expect, it } from "bun:test";
import { deriveExecutionCheckpoint } from "./execution-checkpoint";
import { buildExecutionResponse } from "./projection/execution-response";

describe("deriveExecutionCheckpoint", () => {
  it("exposes only recovery actions for a failed execution checkpoint", () => {
    const checkpoint = deriveExecutionCheckpoint({
      taskId: "task-1",
      sessionId: "session-1",
      planRunId: "plan-1",
      status: "failed",
      currentNodeId: "node-1",
      message: "q is not defined",
      effective: {
        nodes: [
          {
            id: "node-1",
            title: "Fetch GitHub Trending",
            status: "failed",
            result: { error: "q is not defined" },
          },
        ],
        edges: [],
      } as never,
    });

    expect(checkpoint?.kind).toBe("failed");
    expect(checkpoint?.availableActions.map((action) => action.id)).toEqual(["retry_node"]);
    expect(checkpoint?.availableActions.find((action) => action.id === "request_replan")).toBeUndefined();
  });
  it("restores a persisted input form after the execution session row is absent", () => {
    const execution = buildExecutionResponse({
      taskId: "task-1",
      planId: "plan-1",
      mainSessionId: "main-session-1",
      status: "waiting_for_user",
      currentNodeId: "node-1",
      executedNodeIds: [],
      message: "No active execution session.",
      effective: {
        nodes: [{
          id: "node-1",
          title: "Choose channels",
          status: "waiting_for_user",
          result: {
            actionForm: {
              instructions: "Choose channels",
              submitLabel: "Continue",
              inputFields: [{ name: "channels", label: "Channels", type: "textarea", required: true }],
            },
          },
        }],
        waitingNodeIds: ["node-1"],
        blockedNodeIds: [],
      } as never,
    });

    expect(execution.checkpoint).toMatchObject({
      nodeId: "node-1",
      sessionId: "main-session-1",
      form: { submitLabel: "Continue" },
    });
    expect(execution.ui?.currentOperationSpec).not.toBeNull();
  });

  it("separates normal manual completion from recovery", () => {
    const checkpoint = deriveExecutionCheckpoint({
      taskId: "task-1",
      sessionId: "session-1",
      planRunId: "plan-1",
      status: "waiting_for_user",
      currentNodeId: "node-1",
      waitKind: "manual_completion",
      message: "Record the result",
      effective: {
        nodes: [{
          id: "node-1",
          type: "task",
          title: "Inspect plants",
          status: "waiting_for_user",
          mode: "manual",
          executor: "user",
          result: {
            waitKind: "manual_completion",
            actionForm: {
              instructions: "Record the result",
              revision: "sha256:form",
              source: "runtime_ai",
              validated: true,
              inputFields: [{ kind: "text", name: "result", label: "Result", required: true }],
            },
          },
        }],
        edges: [],
      } as never,
    });

    expect(checkpoint).toMatchObject({
      kind: "manual_completion",
      form: { revision: "sha256:form", source: "runtime_ai", validated: true },
    });
    expect(checkpoint?.availableActions.map(({ id }) => id)).toEqual([
      "mark_node_completed",
      "request_replan",
      "cancel_session",
    ]);
  });

  it("offers form regeneration for a failed review without exposing provider details", () => {
    const checkpoint = deriveExecutionCheckpoint({
      taskId: "task-1",
      sessionId: "session-1",
      planRunId: "plan-1",
      status: "failed",
      currentNodeId: "node-1",
      message: "Manual completion form preparation failed.",
      effective: {
        nodes: [{
          id: "node-1",
          type: "task",
          title: "Inspect plants",
          status: "failed",
          result: {
            error: "Manual completion form preparation failed.",
            errorDetails: { code: "MANUAL_FORM_REVIEW_RESULT_INVALID", traceId: "run-1", raw: "secret" },
          },
        }],
        edges: [],
      } as never,
    });

    expect(checkpoint?.title).toBe("Form generation failed: Inspect plants");
    expect(checkpoint?.availableActions.map(({ label }) => label)).toEqual([
      "Regenerate form",
      "Request replan",
      "Cancel execution",
    ]);
  });

  it("strictly upgrades only the legacy manual-only blocker", () => {
    const checkpoint = deriveExecutionCheckpoint({
      taskId: "task-1",
      sessionId: "session-1",
      planRunId: "plan-1",
      status: "blocked",
      currentNodeId: "node-1",
      waitKind: "manual_action",
      message: "Node node-1 execution mode is manual",
      effective: {
        nodes: [{
          id: "node-1",
          type: "task",
          title: "Inspect plants",
          status: "blocked",
          mode: "manual",
          executor: "user",
          result: { waitKind: "manual_action", error: "Node node-1 execution mode is manual" },
        }],
        edges: [],
      } as never,
    });

    expect(checkpoint?.availableActions.map(({ label }) => label)).toEqual([
      "Generate completion form",
      "Request replan",
      "Cancel execution",
    ]);
  });
});
