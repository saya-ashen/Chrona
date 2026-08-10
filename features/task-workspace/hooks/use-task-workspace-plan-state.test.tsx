import { describe, expect, it } from "vitest";

import { appendRuntimeEvent, type WorkspaceRuntimeEvent } from "./use-task-workspace-plan-state";

function runtimeEvent(sequence: number, nodeId?: string): WorkspaceRuntimeEvent {
  return {
    type: "runtime_event",
    action: "start_manual",
    executionScope: "scope-1",
    runtime: { category: "runtime", label: "Execution runtime" },
    provider: { category: "ai_provider", label: "AI provider" },
    nodeId,
    sequence,
    timestamp: "2026-05-23T00:00:00.000Z",
    event: { type: "tool_started", tool: { category: "tool", label: "Runtime tool" }, label: "Read" },
  };
}

describe("appendRuntimeEvent", () => {
  it("keeps safe lifecycle events in sequence", () => {
    const first = runtimeEvent(1, "node-a");
    const second = runtimeEvent(2, "node-a");

    const events = appendRuntimeEvent(appendRuntimeEvent([], first), second);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("keeps equal provider sequences from different execution scopes", () => {
    const previousRun = { ...runtimeEvent(1, "node-a"), executionScope: "scope-previous" };
    const currentRun = { ...runtimeEvent(1, "node-a"), executionScope: "scope-current" };

    const events = appendRuntimeEvent(appendRuntimeEvent([], previousRun), currentRun);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.executionScope)).toEqual(["scope-previous", "scope-current"]);
  });
});
