import { describe, expect, it } from "vitest";
import {
  getWorkspaceActivityIdentity,
  mergeWorkspaceActivity,
  orderWorkspaceActivity,
  runtimeEventToWorkspaceActivity,
} from "./task-workspace-activity";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { WorkspaceActivityItem } from "./task-workspace-types";

function activity(overrides: Partial<WorkspaceActivityItem> & Pick<WorkspaceActivityItem, "id" | "kind">): WorkspaceActivityItem {
  return {
    title: overrides.title ?? overrides.id,
    summary: overrides.summary ?? overrides.id,
    description: overrides.description ?? overrides.summary ?? overrides.id,
    tone: overrides.tone ?? "neutral",
    ...overrides,
  };
}

function runtimeEvent(overrides: Partial<WorkspaceRuntimeEvent>): WorkspaceRuntimeEvent {
  return {
    type: "runtime_event",
    action: "start_manual",
    runtimeName: "hermes",
    provider: "anthropic",
    runId: "run-1",
    sequence: 1,
    timestamp: "2026-05-21T00:00:00.000Z",
    event: { type: "raw_event", rawEventType: "provider.tick" },
    ...overrides,
  };
}

describe("workspace activity helpers", () => {
  it("builds stable identity from provider, run, node, event type, and sequence", () => {
    expect(getWorkspaceActivityIdentity(activity({
      id: "event-1",
      kind: "tool_started",
      provider: "anthropic",
      runtimeName: "hermes",
      runId: "run-1",
      nativeRunId: "native-1",
      sourceNodeId: "node-1",
      rawEventType: "tool_started",
      sequence: 12,
    }))).toBe("tool_started:anthropic:hermes:run-1:native-1:node-1:tool_started:12");
  });

  it("orders newest activity first and uses sequence as a tie breaker", () => {
    expect(orderWorkspaceActivity([
      activity({ id: "older", kind: "task", timestamp: "2026-05-21T00:00:00.000Z", sequence: 3 }),
      activity({ id: "newer-low-sequence", kind: "task", timestamp: "2026-05-21T00:01:00.000Z", sequence: 1 }),
      activity({ id: "newer-high-sequence", kind: "task", timestamp: "2026-05-21T00:01:00.000Z", sequence: 2 }),
    ]).map((item) => item.id)).toEqual(["newer-high-sequence", "newer-low-sequence", "older"]);
  });

  it("merges adjacent assistant deltas only within the same node boundary", () => {
    const merged = mergeWorkspaceActivity([
      activity({ id: "a1", kind: "assistant_message", summary: "Hello ", assistant: { text: "Hello ", isReasoning: false }, sourceNodeId: "node-1", sequence: 1 }),
      activity({ id: "a2", kind: "assistant_message", summary: "world", assistant: { text: "world", isReasoning: false }, sourceNodeId: "node-1", sequence: 2 }),
      activity({ id: "a3", kind: "assistant_message", summary: "Other", assistant: { text: "Other", isReasoning: false }, sourceNodeId: "node-2", sequence: 3 }),
    ], 10);

    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.sourceNodeId === "node-1")?.summary).toBe("Hello world");
    expect(merged.find((item) => item.sourceNodeId === "node-2")?.summary).toBe("Other");
  });

  it("converts live tool events into structured activity with useful details", () => {
    expect(runtimeEventToWorkspaceActivity(runtimeEvent({
      nodeId: "node-1",
      nodeTitle: "Read plan",
      rawEventType: "tool_started",
      event: {
        type: "tool_started",
        toolName: "chrona_plan_read",
        label: "Read plan",
        preview: "Loaded two nodes",
        input: "taskId=task-1",
      },
    }))).toMatchObject({
      kind: "tool_started",
      title: "Tool started",
      sourceNodeId: "node-1",
      sourceNodeTitle: "Read plan",
      tool: {
        name: "chrona_plan_read",
        label: "Read plan",
        preview: "Loaded two nodes",
        inputSummary: "taskId=task-1",
        state: "started",
      },
    });
  });
});
