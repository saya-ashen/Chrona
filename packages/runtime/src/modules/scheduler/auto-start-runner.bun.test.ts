import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const autoStartScheduledPlanTasksMock = mock(async () => ({ startedTaskIds: [], now: new Date().toISOString() }));

mock.module("@/modules/commands/auto-start-scheduled-plan", () => ({
  autoStartScheduledPlanTasks: autoStartScheduledPlanTasksMock,
}));

const { createAutoStartScheduler } = await import("@/modules/scheduler/auto-start-runner");

describe("auto-start scheduler runner", () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalEnv = { ...process.env };
  const intervalCalls: Array<{ fn: () => void; ms: number }> = [];
  const clearedHandles: Array<ReturnType<typeof setInterval>> = [];

  beforeEach(() => {
    intervalCalls.length = 0;
    clearedHandles.length = 0;
    autoStartScheduledPlanTasksMock.mockClear();
    process.env = { ...originalEnv };
    const fakeSetInterval = (fn: TimerHandler, ms?: number) => {
      const callback: () => void =
        typeof fn === "function"
          ? () => {
              (fn as () => void)();
            }
          : () => {};
      intervalCalls.push({ fn: callback, ms: Number(ms ?? 0) });
      return originalSetInterval(() => undefined, 60_000);
    };
    globalThis.setInterval = fakeSetInterval as unknown as typeof setInterval;
    const fakeClearInterval = (handle?: Parameters<typeof clearInterval>[0]) => {
      if (handle !== undefined) {
        clearedHandles.push(handle as ReturnType<typeof setInterval>);
      }
      originalClearInterval(handle);
    };
    globalThis.clearInterval = fakeClearInterval as unknown as typeof clearInterval;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  it("starts one polling loop and invokes auto-start on each tick", async () => {
    process.env.AUTO_START_SCHEDULER_INTERVAL_MS = "2500";
    const scheduler = createAutoStartScheduler();

    expect(intervalCalls).toHaveLength(0);

    scheduler.start();
    scheduler.start();

    expect(intervalCalls).toHaveLength(1);
    expect(intervalCalls[0]?.ms).toBe(2500);

    await intervalCalls[0]!.fn();
    expect(autoStartScheduledPlanTasksMock).toHaveBeenCalledTimes(1);

    scheduler.stop();
    expect(clearedHandles).toHaveLength(1);
  });

  it("does not start when disabled by env flag", () => {
    process.env.AUTO_START_SCHEDULER_ENABLED = "0";
    const scheduler = createAutoStartScheduler();

    scheduler.start();

    expect(intervalCalls).toHaveLength(0);
  });
});
