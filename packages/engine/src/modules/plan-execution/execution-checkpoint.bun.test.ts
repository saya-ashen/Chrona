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
});
