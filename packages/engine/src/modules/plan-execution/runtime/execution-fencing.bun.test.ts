import { describe, expect, it } from "bun:test";
import { assertExecutionFence, isExecutionFenceValid } from "./execution-fencing";

describe("execution fencing", () => {
  it("accepts the current owner and epoch", () => {
    expect(
      isExecutionFenceValid(
        { planRunId: "run-1", ownerId: "owner-1", epoch: 3 },
        { id: "run-1", executionOwnerId: "owner-1", executionEpoch: 3 },
      ),
    ).toBe(true);
  });

  it("rejects stale owners and epochs", () => {
    const subject = { id: "run-1", executionOwnerId: "owner-2", executionEpoch: 4 };

    expect(
      isExecutionFenceValid({ planRunId: "run-1", ownerId: "owner-1", epoch: 4 }, subject),
    ).toBe(false);
    expect(() =>
      assertExecutionFence({ planRunId: "run-1", ownerId: "owner-2", epoch: 3 }, subject),
    ).toThrow("Stale execution fence rejected");
  });
});
