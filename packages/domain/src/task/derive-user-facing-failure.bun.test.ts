import { describe, expect, test } from "bun:test";
import { deriveUserFacingFailure } from "./derive-user-facing-failure";

describe("deriveUserFacingFailure", () => {
  test("keeps input and approval recovery distinct", () => {
    expect(deriveUserFacingFailure({ state: "waiting_for_input" })).toMatchObject({
      category: "input",
      safeActions: [{ id: "provide_input", label: "Provide input" }],
      duplicateSideEffectRisk: null,
    });
    expect(deriveUserFacingFailure({ state: "waiting_for_approval" })).toMatchObject({
      category: "approval",
      safeActions: [{ id: "review_approval", label: "Review approval" }],
      duplicateSideEffectRisk: null,
    });
  });

  test("turns provider details into an actionable summary", () => {
    expect(deriveUserFacingFailure({
      state: "failed",
      reason: "Provider stream closed with ECONNRESET",
      currentNodeId: "node-2",
      currentNodeLabel: "Publish report",
      completedNodeLabels: ["Collect sources"],
      diagnosticRef: "run-1:node-2",
    })).toEqual({
      category: "provider",
      summary: "The selected AI stopped responding before this step completed.",
      technicalDetail: "Provider stream closed with ECONNRESET",
      completedScope: ["Collect sources"],
      retainedProgress: ["Completed steps and their recorded results are retained."],
      retryFrom: "Publish report",
      duplicateSideEffectRisk: "The interrupted step may have started an external action. Check its destination before retrying.",
      safeActions: [
        { id: "retry", label: "Retry current step" },
        { id: "restart", label: "Restart from beginning" },
        { id: "diagnostics", label: "View diagnostics" },
      ],
      diagnosticRef: "run-1:node-2",
    });
  });
});
