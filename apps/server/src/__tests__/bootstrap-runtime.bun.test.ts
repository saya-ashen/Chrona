import { describe, expect, it, mock } from "bun:test";
import type { TaskOrchestrator } from "@chrona/engine";

import { createServerRuntimeBootstrap } from "../runtime-bootstrap";

describe("server runtime bootstrap", () => {
  it("starts once and stops the retained task and AI Feature recovery workers", async () => {
    const stop = mock(async () => undefined);
    const stopFeatureRecovery = mock(async () => undefined);
    const startTaskOrchestrator = mock(() => ({ stop } as unknown as TaskOrchestrator));
    const startAiFeatureRecoveryWorker = mock(() => ({ stop: stopFeatureRecovery }));
    const bootstrapServerRuntime = createServerRuntimeBootstrap({ startTaskOrchestrator, startAiFeatureRecoveryWorker });

    const first = bootstrapServerRuntime();
    const second = bootstrapServerRuntime();
    await second.stop();

    expect(first).toBe(second);
    expect(startTaskOrchestrator).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(startAiFeatureRecoveryWorker).toHaveBeenCalledTimes(1);
    expect(stopFeatureRecovery).toHaveBeenCalledTimes(1);
  });
});
