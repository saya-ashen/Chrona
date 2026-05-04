import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const autoStartScheduledPlanTasksMock = mock(async () => ({
  started: [],
  skipped: [],
  failed: [],
  now: new Date().toISOString(),
}));

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
      if (typeof fn === "function") {
        intervalCalls.push({ fn: () => { (fn as () => void)(); }, ms: Number(ms ?? 0) });
      }
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
    process.env.CHRONA_AUTO_START_SCHEDULER_INTERVAL_MS = "2500";
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

  it("does not start when disabled by CHRONA_ env flag", () => {
    process.env.CHRONA_AUTO_START_SCHEDULER_ENABLED = "0";
    const scheduler = createAutoStartScheduler();

    scheduler.start();

    expect(intervalCalls).toHaveLength(0);
  });

  it("does not start when disabled by legacy env flag", () => {
    process.env.AUTO_START_SCHEDULER_ENABLED = "false";
    const scheduler = createAutoStartScheduler();

    scheduler.start();

    expect(intervalCalls).toHaveLength(0);
  });

  it("does not start when enabled is set to 0 via legacy flag", () => {
    process.env.AUTO_START_SCHEDULER_ENABLED = "0";
    const scheduler = createAutoStartScheduler();

    scheduler.start();

    expect(intervalCalls).toHaveLength(0);
  });

  it("starts when CHRONA_ flag overrides a disabled legacy flag", () => {
    process.env.AUTO_START_SCHEDULER_ENABLED = "0";
    process.env.CHRONA_AUTO_START_SCHEDULER_ENABLED = "true";
    const scheduler = createAutoStartScheduler();

    scheduler.start();

    expect(intervalCalls).toHaveLength(1);
  });

  it("triggers an immediate tick on start when TICK_ON_START is set", async () => {
    process.env.CHRONA_AUTO_START_SCHEDULER_TICK_ON_START = "true";
    const scheduler = createAutoStartScheduler();

    scheduler.start();

    expect(autoStartScheduledPlanTasksMock).toHaveBeenCalledTimes(1);

    expect(intervalCalls).toHaveLength(1);
  });

  it("uses legacy TICK_ON_START flag", async () => {
    process.env.AUTO_START_SCHEDULER_TICK_ON_START = "1";
    const scheduler = createAutoStartScheduler();

    scheduler.start();

    expect(autoStartScheduledPlanTasksMock).toHaveBeenCalledTimes(1);
  });

  it("does not trigger immediate tick when TICK_ON_START is false", () => {
    process.env.CHRONA_AUTO_START_SCHEDULER_TICK_ON_START = "false";
    const scheduler = createAutoStartScheduler();

    scheduler.start();

    expect(autoStartScheduledPlanTasksMock).not.toHaveBeenCalled();
  });

  it("uses CHRONA_ interval env var", () => {
    process.env.CHRONA_AUTO_START_SCHEDULER_INTERVAL_MS = "5000";
    const scheduler = createAutoStartScheduler();

    scheduler.start();

    expect(intervalCalls[0]?.ms).toBe(5000);
  });

  it("uses legacy interval env var", () => {
    process.env.AUTO_START_SCHEDULER_INTERVAL_MS = "30000";
    const scheduler = createAutoStartScheduler();

    scheduler.start();

    expect(intervalCalls[0]?.ms).toBe(30000);
  });

  it("stops cleanly", () => {
    const scheduler = createAutoStartScheduler();

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    expect(clearedHandles).toHaveLength(1);
  });

  it("start is idempotent — calling start twice creates only one interval", () => {
    const scheduler = createAutoStartScheduler();

    scheduler.start();
    scheduler.start();
    scheduler.start();

    expect(intervalCalls).toHaveLength(1);
  });

  it("does not re-enter tick while previous tick is in flight", async () => {
    let resolve: () => void;
    const pending = new Promise<void>((r) => { resolve = r; });

    autoStartScheduledPlanTasksMock.mockImplementationOnce(async () => {
      await pending;
      return { started: [], skipped: [], failed: [], now: new Date().toISOString() };
    });

    const scheduler = createAutoStartScheduler();
    scheduler.start();

    // First tick: starts executing
    intervalCalls[0]!.fn();

    // Second tick: should be skipped because first is still in flight
    intervalCalls[0]!.fn();
    intervalCalls[0]!.fn();

    expect(autoStartScheduledPlanTasksMock).toHaveBeenCalledTimes(1);

    resolve!();
  });
});
