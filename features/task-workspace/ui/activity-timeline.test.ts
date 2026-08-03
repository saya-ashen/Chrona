import { describe, expect, it } from "vitest";

import type { WorkspaceActivityItem } from "../model/task-workspace-types";
import { buildRenderList, formatActivityTime } from "./activity-timeline";

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

describe("formatActivityTime", () => {
  it("formats ISO timestamps in the requested local time zone", () => {
    const timestamp = "2026-07-18T10:05:06.000Z";
    const expected = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Shanghai",
    }).format(new Date(timestamp));

    expect(formatActivityTime(timestamp, "Asia/Shanghai")).toBe(expected);
    expect(formatActivityTime(timestamp, "Asia/Shanghai")).not.toBe("10:05:06");
  });

  it("omits missing or invalid timestamps", () => {
    expect(formatActivityTime(undefined)).toBeUndefined();
    expect(formatActivityTime("not-a-date")).toBeUndefined();
  });
});

describe("ActivityTimeline execution runs", () => {
  it("adds one ordered divider for each public execution start marker", () => {
    const entries = buildRenderList([
      activity({
        id: "run-2-node",
        timestamp: "2026-07-18T10:00:01.000Z",
      }),
      activity({
        id: "run-2-start",
        timestamp: "2026-07-18T10:00:00.000Z",
        executionTrigger: "restart",
      }),
      activity({
        id: "run-1-node",
        timestamp: "2026-07-18T09:00:01.000Z",
        executionTrigger: "initial",
      }),
    ]);

    expect(entries.filter((entry) => entry.type === "run_divider")).toEqual([
      expect.objectContaining({ type: "run_divider", runNumber: 2, restarted: true }),
      expect.objectContaining({ type: "run_divider", runNumber: 1, restarted: false }),
    ]);
  });

  it("does not add a divider to legacy activity without execution markers", () => {
    expect(buildRenderList([activity({ id: "legacy" })]).some((entry) => entry.type === "run_divider")).toBe(false);
  });

  it("keeps execution-stage keys unique when scoped and legacy activity interleave", () => {
    const entries = buildRenderList([
      activity({ id: "scoped-1", executionTrigger: "initial" }),
      activity({ id: "legacy-1" }),
      activity({ id: "scoped-2" }),
      activity({ id: "legacy-2" }),
    ], true);
    const keys = entries.map((entry) => entry.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
  it("groups a newest-first completed tool at its latest event position", () => {
    const entries = buildRenderList([
      activity({
        id: "completed",
        kind: "tool_completed",
        timestamp: "2026-07-18T10:00:02.000Z",
        tool: { name: "read", label: "Read", state: "completed" },
      }),
      activity({
        id: "progress",
        kind: "tool_progress",
        timestamp: "2026-07-18T10:00:01.000Z",
        tool: { name: "read", label: "Read", state: "progress" },
      }),
      activity({
        id: "started",
        kind: "tool_started",
        timestamp: "2026-07-18T10:00:00.000Z",
        tool: { name: "read", label: "Read", state: "started" },
      }),
      activity({ id: "older", timestamp: "2026-07-18T09:59:59.000Z" }),
    ], true);

    expect(entries).toEqual([
      expect.objectContaining({
        type: "tool_pair",
        started: expect.objectContaining({ id: "started" }),
        completed: expect.objectContaining({ id: "completed" }),
      }),
      expect.objectContaining({ type: "single", item: expect.objectContaining({ id: "older" }) }),
    ]);
  });
});
