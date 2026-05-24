import { describe, expect, it } from "bun:test";
import {
  deriveNodeAttemptIdempotencyKey,
  deriveProviderRunIdempotencyKey,
} from "./node-attempt-idempotency";

describe("node attempt idempotency", () => {
  it("derives stable keys for the same node attempt identity", () => {
    const input = {
      taskId: "task-1",
      planId: "plan-1",
      nodeId: "node-1",
      nodeLayerId: "layer-1",
      executionEpoch: 2,
      attemptNumber: 1,
    };

    expect(deriveNodeAttemptIdempotencyKey(input)).toBe(
      deriveNodeAttemptIdempotencyKey(input),
    );
    expect(deriveProviderRunIdempotencyKey(input)).toBe(
      `provider-run:${deriveNodeAttemptIdempotencyKey(input)}`,
    );
  });

  it("changes keys across attempts and epochs", () => {
    const base = {
      taskId: "task-1",
      planId: "plan-1",
      nodeId: "node-1",
      nodeLayerId: "layer-1",
      executionEpoch: 2,
      attemptNumber: 1,
    };

    expect(deriveNodeAttemptIdempotencyKey(base)).not.toBe(
      deriveNodeAttemptIdempotencyKey({ ...base, attemptNumber: 2 }),
    );
    expect(deriveNodeAttemptIdempotencyKey(base)).not.toBe(
      deriveNodeAttemptIdempotencyKey({ ...base, executionEpoch: 3 }),
    );
  });
});
