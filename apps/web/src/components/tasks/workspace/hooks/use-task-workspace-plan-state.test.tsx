import { describe, expect, it } from "vitest";

import { appendRuntimeEvent, type WorkspaceRuntimeEvent } from "./use-task-workspace-plan-state";

function runtimeTextEvent(overrides: Partial<WorkspaceRuntimeEvent> & { text: string; sequence: number }): WorkspaceRuntimeEvent {
  return {
    type: "runtime_event",
    action: overrides.action ?? "start_manual",
    runtimeName: overrides.runtimeName ?? "hermes",
    provider: overrides.provider ?? "anthropic",
    runId: overrides.runId ?? "run-1",
    nativeRunId: overrides.nativeRunId ?? "native-1",
    nodeId: overrides.nodeId,
    nodeTitle: overrides.nodeTitle,
    sequence: overrides.sequence,
    timestamp: overrides.timestamp ?? "2026-05-23T00:00:00.000Z",
    event: { type: "assistant_text_delta", text: overrides.text },
  };
}

describe("appendRuntimeEvent", () => {
  it("merges adjacent live text deltas inside the same run and node", () => {
    const first = runtimeTextEvent({ text: "Hello ", sequence: 1, nodeId: "node-a" });
    const second = runtimeTextEvent({ text: "world", sequence: 2, nodeId: "node-a" });

    const merged = appendRuntimeEvent(appendRuntimeEvent([], first), second);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ sequence: 1, nodeId: "node-a" });
    expect(merged[0]?.event).toMatchObject({ type: "assistant_text_delta", text: "Hello world" });
  });

  it("keeps live text deltas separated across node boundaries", () => {
    const first = runtimeTextEvent({ text: "Node A", sequence: 1, nodeId: "node-a" });
    const second = runtimeTextEvent({ text: "Node B", sequence: 2, nodeId: "node-b" });

    const events = appendRuntimeEvent(appendRuntimeEvent([], first), second);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.nodeId)).toEqual(["node-a", "node-b"]);
  });
});
