import { describe, expect, it } from "vitest";
import {
  getWorkspaceActivityIdentity,
  mergeWorkspaceActivity,
  orderWorkspaceActivity,
  runtimeEventToWorkspaceActivity,
  workspaceEventToWorkspaceActivity,
} from "./task-workspace-activity";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { TaskWorkspaceSseEvent } from "../hooks/use-task-workspace-page-state";
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

  it("keeps assistant deltas separate across provider run boundaries", () => {
    const merged = mergeWorkspaceActivity([
      activity({ id: "a1", kind: "assistant_message", summary: "Before ", assistant: { text: "Before ", isReasoning: false }, runId: "run-1", sequence: 1 }),
      activity({ id: "a2", kind: "assistant_message", summary: "after", assistant: { text: "after", isReasoning: false }, runId: "run-2", sequence: 2 }),
    ], 10);

    expect(merged.map((item) => item.summary)).toEqual(["after", "Before "]);
  });

  it("dedupes persisted and live activity with the same provider identity", () => {
    const persisted = activity({
      id: "persisted-tool",
      kind: "tool_completed",
      provider: "anthropic",
      runtimeName: "hermes",
      runId: "run-1",
      sourceNodeId: "node-1",
      rawEventType: "tool_completed",
      sequence: 7,
      timestamp: "2026-05-21T00:01:00.000Z",
    });
    const liveDuplicate = activity({
      ...persisted,
      id: "live-tool",
      timestamp: "2026-05-21T00:00:59.000Z",
    });

    expect(mergeWorkspaceActivity([persisted, liveDuplicate], 10)).toHaveLength(1);
  });

  it("converts failed live tool events into danger activity with truncated error details", () => {
    const longError = `${"Runtime permission denied. ".repeat(20)}Refresh credentials before retrying.`;

    expect(runtimeEventToWorkspaceActivity(runtimeEvent({
      nodeId: "node-1",
      nodeTitle: "Fetch calendar",
      rawEventType: "tool_completed",
      event: {
        type: "tool_completed",
        toolName: "chrona_calendar_fetch",
        label: "Fetch calendar",
        durationMs: 42,
        error: { message: longError },
      },
    }))).toMatchObject({
      kind: "tool_completed",
      title: "Tool failed",
      summary: `Fetch calendar failed: ${longError}`,
      tone: "danger",
      tool: {
        name: "chrona_calendar_fetch",
        label: "Fetch calendar",
        durationMs: 42,
        state: "failed",
        error: expect.stringMatching(/^Runtime permission denied\./),
      },
    });
  });

  it("keeps approval and failed run status events actionable in activity", () => {
    expect(runtimeEventToWorkspaceActivity(runtimeEvent({
      rawEventType: "approval_required",
      event: ({
        type: "approval_required",
        approval: {
          provider: "anthropic",
          runId: "run-1",
          kind: "checkpoint",
          title: "Approve output",
          summary: "Execution is waiting for approval.",
          riskLevel: "medium",
          choices: ["approve_once", "deny"],
        },
      } satisfies WorkspaceRuntimeEvent["event"]),
    }))).toMatchObject({
      kind: "approval",
      title: "Approval required",
      tone: "warning",
    });

    expect(runtimeEventToWorkspaceActivity(runtimeEvent({
      rawEventType: "run_status",
      event: { type: "run_status", status: "failed", message: "Provider run failed" },
    }))).toMatchObject({
      kind: "provider_run",
      title: "Run status",
      summary: "Provider run failed",
      tone: "danger",
    });
  });

  it("drops generic live provider events from activity", () => {
    expect(runtimeEventToWorkspaceActivity(runtimeEvent({
      provider: "claude_code",
      runtimeName: "hermes",
      nodeTitle: "system",
      rawEventType: "system",
      event: { type: "raw_event", rawEventType: "system" },
    }))).toBeNull();
  });

  it("keeps plan generation projection refreshes out of live activity", () => {
    const projectionEvent: TaskWorkspaceSseEvent = {
      type: "task_workspace_updated",
      sequence: 3,
      reason: "plan_generation.status",
    };
    const statusEvent: TaskWorkspaceSseEvent = {
      type: "plan.generation.event",
      sequence: 4,
      eventKind: "status",
      phase: "streaming",
      message: "Using browser_console...",
      generationId: "generation-1",
    };

    expect(workspaceEventToWorkspaceActivity(projectionEvent)).toBeNull();
    expect(workspaceEventToWorkspaceActivity(statusEvent)).toMatchObject({
      rawEventType: "plan_generation.status",
      title: "Plan generation update",
      summary: "Using browser_console...",
      activityGroup: { kind: "plan_generation", id: "generation-1" },
    });
  });
});
