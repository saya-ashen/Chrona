import { describe, expect, it, mock } from "bun:test";
import type { TaskOrchestrator } from "@chrona/engine";

import { createServerRuntimeBootstrap } from "../runtime-bootstrap";

describe("server runtime bootstrap", () => {
  it("starts once and stops the retained task orchestrator", async () => {
    const stop = mock(async () => undefined);
    const startTaskOrchestrator = mock(() => ({ stop } as unknown as TaskOrchestrator));
    const bootstrapServerRuntime = createServerRuntimeBootstrap({ startTaskOrchestrator });

    const first = bootstrapServerRuntime();
    const second = bootstrapServerRuntime();
    await second.stop();

    expect(first).toBe(second);
    expect(startTaskOrchestrator).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
