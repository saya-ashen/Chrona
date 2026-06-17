import { describe, expect, it } from "bun:test";
import { deriveExecutionCheckpoint } from "./execution-checkpoint";

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
});
