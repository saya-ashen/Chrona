import { describe, expect, it } from "bun:test";
import {
  acceptedToolResult,
  duplicateOperationToolResult,
  staleStateToolResult,
  validationErrorToolResult,
} from "./agent-tool-result";

const base = {
  operationId: "op-1",
  toolName: "chrona.task.update" as const,
  message: "Mapped result.",
  affected: { taskId: "task-1" },
  state: { taskStatus: "Ready" },
};

describe("agent tool result builders", () => {
  it("builds accepted, validation, stale, and duplicate result envelopes", () => {
    expect(acceptedToolResult(base)).toMatchObject({
      status: "accepted",
      reasonCode: null,
      idempotency: "new",
    });
    expect(validationErrorToolResult(base)).toMatchObject({
      status: "rejected",
      reasonCode: "VALIDATION_ERROR",
    });
    expect(staleStateToolResult(base)).toMatchObject({
      status: "rejected",
      reasonCode: "STALE_STATE",
    });
    expect(duplicateOperationToolResult(base)).toMatchObject({
      status: "noop",
      reasonCode: "DUPLICATE_OPERATION",
      idempotency: "replayed",
    });
  });
});
