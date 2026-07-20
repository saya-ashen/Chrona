import { describe, expect, it } from "bun:test";

import { deriveGoalProjection } from "./derive-goal-projection";

const criterion = {
  id: "offer",
  kind: "user_confirmed" as const,
  description: "A suitable offer is accepted",
  satisfied: false,
  confirmedAt: null,
};

describe("deriveGoalProjection", () => {
  it.each([
    {
      name: "keeps lifecycle Active while work runs",
      input: { status: "Active" as const, nextReviewAt: null, tasks: [{ status: "Running" }], successCriteria: [criterion] },
      expected: { lifecycle: "Active", activity: "work_active", attention: "none", nextAction: "none" },
    },
    {
      name: "prioritizes input attention over review due",
      input: { status: "Active" as const, nextReviewAt: "2026-07-01T00:00:00.000Z", tasks: [{ status: "WaitingForInput" }], successCriteria: [criterion] },
      expected: { lifecycle: "Active", activity: "review_due", attention: "needs_input", nextAction: "resolve_attention" },
    },
    {
      name: "makes review the next action when due",
      input: { status: "Active" as const, nextReviewAt: "2026-07-01T00:00:00.000Z", tasks: [{ status: "Completed" }], successCriteria: [criterion] },
      expected: { lifecycle: "Active", activity: "review_due", attention: "none", nextAction: "review" },
    },
    {
      name: "makes resume the only paused action",
      input: { status: "Paused" as const, nextReviewAt: "2026-07-01T00:00:00.000Z", tasks: [{ status: "Failed" }], successCriteria: [criterion] },
      expected: { lifecycle: "Paused", activity: "idle", attention: "failed", nextAction: "resume" },
    },
    {
      name: "does not infer achieved from a completed task",
      input: { status: "Active" as const, nextReviewAt: null, tasks: [{ status: "Completed" }], successCriteria: [criterion] },
      expected: { lifecycle: "Active", activity: "idle", attention: "none", nextAction: "none" },
    },
    {
      name: "asks for outcome confirmation when criteria are satisfied",
      input: { status: "Active" as const, nextReviewAt: null, tasks: [{ status: "Completed" }], successCriteria: [{ ...criterion, satisfied: true }] },
      expected: { lifecycle: "Active", activity: "idle", attention: "none", nextAction: "confirm_outcome" },
    },
  ])("$name", ({ input, expected }) => {
    expect(deriveGoalProjection({ ...input, now: "2026-07-19T00:00:00.000Z" })).toMatchObject(expected);
  });
});
