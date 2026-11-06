import { expect, spyOn, test } from "bun:test";
import { startTestTickPump } from "./test-tick-pump";

function clock() {
  let fire!: () => void;
  const interval = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, ms: number) => {
    expect(ms).toBe(100);
    fire = callback;
    return 1;
  }) as unknown as typeof setInterval);
  const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  return { fire: () => fire(), clear, restore: () => { interval.mockRestore(); clear.mockRestore(); } };
}

test("a tick slower than the polling interval cannot replenish pending repeatedly, and polling resumes", async () => {
  const timers = clock();
  let release!: () => void, calls = 0;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const stop = startTestTickPump(async () => { calls++; await barrier; }, 100);
  try {
    timers.fire();
    await Bun.sleep(0);
    for (let i = 0; i < 200; i++) timers.fire();
    await Bun.sleep(0);
    expect(calls).toBe(1);
    release();
    await Bun.sleep(0);
    timers.fire();
    await Bun.sleep(0);
    expect(calls).toBe(2);
  } finally { release(); await stop(); timers.restore(); }
});

test("shutdown waits for the outstanding tick and does not start another", async () => {
  const timers = clock();
  let release!: () => void, stopped = false, calls = 0;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const stop = startTestTickPump(async () => { calls++; await barrier; }, 100);
  try {
    timers.fire();
    await Bun.sleep(0);
    const stopping = stop().then(() => { stopped = true; });
    await Bun.sleep(0);
    expect(stopped).toBe(false);
    timers.fire();
    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(calls).toBe(1);
  } finally { release(); await stop(); timers.restore(); }
});

test("a rejected tick stops polling and is reported by shutdown", async () => {
  const timers = clock(), error = new Error("synthetic tick failure");
  let calls = 0;
  const stop = startTestTickPump(async () => { calls++; throw error; }, 100);
  try {
    timers.fire();
    await Bun.sleep(0);
    timers.fire();
    await Bun.sleep(0);
    expect(calls).toBe(1);
    expect(timers.clear).toHaveBeenCalled();
    await expect(stop()).rejects.toBe(error);
  } finally { await stop().catch(() => {}); timers.restore(); }
});
