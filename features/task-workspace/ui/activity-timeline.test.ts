import { describe, expect, it } from "vitest";

import type { WorkspaceActivityItem } from "../model/task-workspace-types";
import { buildRenderList } from "./activity-timeline";

function activity(input: Partial<WorkspaceActivityItem> & Pick<WorkspaceActivityItem, "id">): WorkspaceActivityItem {
  return {
    kind: "node",
    title: input.id,
    summary: input.id,
    description: input.id,
    tone: "info",
    ...input,
  };
}

describe("ActivityTimeline execution runs", () => {
  it("adds one ordered divider for each execution session", () => {
    const entries = buildRenderList([
      activity({
        id: "run-2-node",
        timestamp: "2026-07-18T10:00:01.000Z",
        executionSessionId: "session-2",
        executionEpoch: 2,
        executionTrigger: "restart",
      }),
      activity({
        id: "run-2-start",
        timestamp: "2026-07-18T10:00:00.000Z",
        rawEventType: "plan_execution.execution_started",
        executionSessionId: "session-2",
        executionEpoch: 2,
        executionTrigger: "restart",
      }),
      activity({
        id: "run-1-node",
        timestamp: "2026-07-18T09:00:01.000Z",
        executionSessionId: "session-1",
        executionEpoch: 1,
        executionTrigger: "initial",
      }),
    ]);

    expect(entries.filter((entry) => entry.type === "run_divider")).toEqual([
      expect.objectContaining({ type: "run_divider", runNumber: 2, restarted: true }),
      expect.objectContaining({ type: "run_divider", runNumber: 1, restarted: false }),
    ]);
  });

  it("does not add a divider to legacy activity without execution-session metadata", () => {
    expect(buildRenderList([activity({ id: "legacy" })]).some((entry) => entry.type === "run_divider")).toBe(false);
  });
});
