import { describe, expect, it } from "bun:test";
import type { ProviderRunEvent } from "@chrona/providers-foundation";

import { startAiRunProgress, subscribeToAiRunProgress } from "./ai-run-progress";

function providerEvent<T extends ProviderRunEvent["type"]>(
  event: Extract<ProviderRunEvent, { type: T }>,
): Extract<ProviderRunEvent, { type: T }> {
  return event;
}

describe("AI run progress registry", () => {
  it("replays safe monotonic progress and does not forward provider payloads", () => {
    const operationId = `progress-${crypto.randomUUID()}`;
    const reporter = startAiRunProgress({ operationId, feature: "goal_review" });

    reporter.observeProviderEvent(providerEvent({
      type: "reasoning_delta",
      provider: "debug",
      runId: "run-1",
      sessionId: "session-1",
      sequence: 1,
      text: "private chain of thought",
      raw: { secret: "must not be exposed" },
    }));
    reporter.observeProviderEvent(providerEvent({
      type: "tool_call",
      provider: "debug",
      runId: "run-1",
      sessionId: "session-1",
      sequence: 2,
      tool: "chrona_goal_read",
      callId: "call-1",
      input: { secret: "must not be exposed" },
      status: "completed",
      preview: { result: "must not be exposed" },
    }));
    reporter.observeProviderEvent(providerEvent({
      type: "tool_result",
      provider: "debug",
      runId: "run-1",
      sessionId: "session-1",
      sequence: 3,
      tool: "chrona_goal_read",
      callId: "call-1",
      result: { secret: "must not be exposed" },
    }));
    reporter.emitPhase("saving");
    reporter.complete();

    const received: unknown[] = [];
    const subscription = subscribeToAiRunProgress({ operationId, onEvent: (event) => received.push(event) });

    expect(subscription).not.toBeNull();
    expect(received).toEqual([
      expect.objectContaining({ sequence: 0, phase: "queued" }),
      expect.objectContaining({ sequence: 1, phase: "thinking" }),
      expect.objectContaining({ sequence: 2, phase: "using_tool", toolName: "chrona_goal_read" }),
      expect.objectContaining({ sequence: 3, phase: "saving" }),
      expect.objectContaining({ sequence: 4, phase: "completed" }),
    ]);
    expect(JSON.stringify(received)).not.toContain("private chain of thought");
    expect(JSON.stringify(received)).not.toContain("must not be exposed");
    subscription?.unsubscribe();
  });

  it("moves from connecting to thinking when the Provider run starts", () => {
    const operationId = `progress-${crypto.randomUUID()}`;
    const reporter = startAiRunProgress({ operationId, feature: "goal.review" });
    reporter.emitPhase("connecting");
    reporter.observeProviderEvent(providerEvent({
      type: "run_started",
      provider: "debug",
      runId: "run-started",
      sessionId: "session-started",
      sequence: 1,
      run: {
        provider: "debug",
        runId: "run-started",
        sessionId: "session-started",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    }));

    const phases: string[] = [];
    const subscription = subscribeToAiRunProgress({ operationId, onEvent: (event) => phases.push(event.phase) });
    expect(phases).toEqual(["queued", "connecting", "thinking"]);
    subscription?.unsubscribe();
  });

  it("normalizes a bounded terminal failure for subscribers", () => {
    const operationId = `progress-${crypto.randomUUID()}`;
    const reporter = startAiRunProgress({ operationId, feature: "goal_review" });
    reporter.fail(new Error(`\u0000${"x".repeat(300)}`));

    const events: Array<{ phase: string; error?: string }> = [];
    subscribeToAiRunProgress({ operationId, onEvent: (event) => events.push(event) });

    expect(events.at(-1)).toMatchObject({ phase: "failed" });
    expect(events.at(-1)?.error).toHaveLength(240);
    expect(events.at(-1)?.error).not.toContain("\u0000");
  });

  it("orders reentrant live events after the frozen replay", () => {
    const operationId = `progress-${crypto.randomUUID()}`;
    const reporter = startAiRunProgress({ operationId, feature: "goal.review" });
    reporter.emitPhase("connecting");
    const phases: string[] = [];

    const subscription = subscribeToAiRunProgress({
      operationId,
      onEvent(event) {
        phases.push(event.phase);
        if (event.phase === "queued") reporter.emitPhase("thinking");
      },
    });

    expect(phases).toEqual(["queued", "connecting", "thinking"]);
    subscription?.unsubscribe();
  });

  it("isolates a throwing live subscriber from later subscribers", () => {
    const operationId = `progress-${crypto.randomUUID()}`;
    const reporter = startAiRunProgress({ operationId, feature: "goal.review" });
    subscribeToAiRunProgress({
      operationId,
      onEvent(event) {
        if (event.phase === "thinking") throw new Error("subscriber failed");
      },
    });
    const phases: string[] = [];
    subscribeToAiRunProgress({ operationId, onEvent: (event) => phases.push(event.phase) });

    expect(() => reporter.emitPhase("thinking")).not.toThrow();
    expect(phases).toEqual(["queued", "thinking"]);
  });

  it("rejects reusing one operation ID across AI features", () => {
    const operationId = `progress-${crypto.randomUUID()}`;
    startAiRunProgress({ operationId, feature: "goal.review" });

    expect(() => startAiRunProgress({ operationId, feature: "task.plan" }))
      .toThrow("operationId is already bound to another AI feature");
  });
});
