import { describe, expect, it, mock } from "bun:test";

import { createServerRuntimeBootstrap } from "../runtime-bootstrap";

describe("server runtime bootstrap", () => {
  it("starts the task orchestrator once for automatic task execution", async () => {
    const startTaskOrchestrator = mock(() => undefined);
    const bootstrapServerRuntime = createServerRuntimeBootstrap({ startTaskOrchestrator });

    bootstrapServerRuntime();
    bootstrapServerRuntime();

    expect(startTaskOrchestrator).toHaveBeenCalledTimes(1);
  });
});
