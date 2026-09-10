import { describe, expect, it } from "bun:test";
import type { runProviderRequest, ProviderFeatureRequest } from "../../ai";
import { boundedFinalizationRequest } from "./bounded-finalization-request";

const client = {} as Parameters<typeof runProviderRequest>[0];
const request: ProviderFeatureRequest = { clientOperationId: "fixture", sessionId: "fixture", instructions: "fixture", input: "fixture", toolPolicy: "terminal_only" };

describe("finalization deadline", () => {
  it("rejects a pre-aborted caller without starting a provider", async () => {
    const controller = new AbortController(); controller.abort();
    let called = false;
    await expect(boundedFinalizationRequest(client, { ...request, signal: controller.signal }, 100, async () => {
      called = true;
      throw new Error("must not start");
    })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("bounds a provider that ignores cancellation and observes its late rejection", async () => {
    let signal: AbortSignal | undefined;
    let rejectLate!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
    await expect(boundedFinalizationRequest(client, request, 10, async (_client, input) => {
      signal = input.signal;
      expect(input.timeoutMs).toBe(10);
      return pending;
    })).rejects.toThrow("timed out");
    expect(signal?.aborted).toBe(true);
    rejectLate(new Error("late provider cleanup failure"));
    await Promise.resolve();
  });

  it("interrupts promptly when the scheduler aborts, without waiting for timeout", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const work = boundedFinalizationRequest(client, { ...request, signal: controller.signal }, 10_000, async (_client, input) => {
      signal = input.signal;
      return new Promise(() => {});
    });
    controller.abort();
    await expect(work).rejects.toThrow("interrupted");
    expect(signal?.aborted).toBe(true);
  });
});
