import { afterEach, describe, expect, it } from "bun:test";

const { createAutoStartScheduler, startAutoStartScheduler } = await import(
  "@/modules/scheduling/auto-start-runner"
);

describe("auto-start scheduler runner", () => {
  const originalEnv = { ...process.env };
  const globalKey = Symbol.for("chrona.taskOrchestrator");

  function resetGlobalOrchestrator() {
    delete (globalThis as typeof globalThis & { [globalKey]?: unknown })[globalKey];
  }

  afterEach(() => {
    process.env = { ...originalEnv };
    resetGlobalOrchestrator();
  });

  it("delegates legacy scheduler creation to the task orchestrator", async () => {
    resetGlobalOrchestrator();
    process.env.CHRONA_TASK_ORCHESTRATOR_ENABLED = "0";

    const result = createAutoStartScheduler();

    expect(typeof result.start).toBe("function");
    expect(typeof result.stop).toBe("function");
    expect(typeof result.tick).toBe("function");
    expect(typeof result.isRunning).toBe("function");
    expect(typeof result.registerWorker).toBe("function");
    await result.stop();
  });

  it("delegates legacy scheduler startup to the task orchestrator", async () => {
    resetGlobalOrchestrator();
    process.env.CHRONA_TASK_ORCHESTRATOR_ENABLED = "0";

    const result = startAutoStartScheduler();

    expect(result).toBe(createAutoStartScheduler());
    await result.stop();
  });
});
