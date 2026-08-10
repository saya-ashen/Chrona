import { describe, expect, it, mock } from "bun:test";
import { createDefaultTaskOrchestratorWorkers, createTaskOrchestrator, type TaskOrchestratorOptions } from "@/modules/orchestration/task-orchestrator";
import { type TaskOrchestratorConfig } from "@/modules/orchestration/orchestrator-config";

import { assertSchedulerWorkOwnership } from "./scheduler-lease-repository";
const config: TaskOrchestratorConfig = {
  enabled: true,
  intervalMs: 2_500,
  tickOnStart: false,
  leaseName: "task-orchestrator",
  leaseOwnerId: "worker-a",
  leaseTtlMs: 30_000,
};

function lease(overrides: Partial<{ ownerId: string; epoch: number; expiresAt: Date }> = {}) {
  const now = new Date("2026-05-17T10:00:00.000Z");
  return {
    name: config.leaseName,
    ownerId: overrides.ownerId ?? config.leaseOwnerId,
    epoch: overrides.epoch ?? 1,
    expiresAt: overrides.expiresAt ?? new Date("2026-05-17T10:00:30.000Z"),
    heartbeatAt: now,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createHarness(overrides: Partial<TaskOrchestratorOptions> = {}) {
  const intervalCalls: Array<{ fn: () => void; ms: number }> = [];
  const heartbeatCalls: Array<{ fn: () => void; ms: number }> = [];
  const handles: Timer[] = [];
  const clearedHandles: Timer[] = [];
  let nextHandle = 0;
  const worker = mock(async () => undefined);
  const leaseRepository: NonNullable<TaskOrchestratorOptions["leaseRepository"]> = {
    acquire: mock(async () => ({ acquired: true as const, lease: lease() })),
    renew: mock(async () => ({ renewed: true as const, lease: lease() })),
    complete: mock(async () => true),
    release: mock(async () => true),
  };
  const setIntervalFn = ((fn: TimerHandler, ms?: number) => {
    if (typeof fn === "function") {
      intervalCalls.push({ fn: () => { (fn as () => void)(); }, ms: Number(ms ?? 0) });
    }
    const handle = ++nextHandle as unknown as Timer;
    handles.push(handle);
    return handle;
  }) as unknown as typeof setInterval;
  const clearIntervalFn = ((handle?: Parameters<typeof clearInterval>[0]) => {
    if (handle) {
      clearedHandles.push(handle as Timer);
    }
  }) as typeof clearInterval;
  const setHeartbeatIntervalFn = ((fn: TimerHandler, ms?: number) => {
    if (typeof fn === "function") {
      heartbeatCalls.push({ fn: () => { (fn as () => void)(); }, ms: Number(ms ?? 0) });
    }
    return ++nextHandle as unknown as Timer;
  }) as unknown as typeof setInterval;
  const clearHeartbeatIntervalFn = (() => undefined) as typeof clearInterval;

  const orchestrator = createTaskOrchestrator({
    config,
    workers: [{ name: "test-worker", run: worker }],
    leaseRepository,
    now: () => new Date("2026-05-17T10:00:00.000Z"),
    setIntervalFn,
    clearIntervalFn,
    setHeartbeatIntervalFn,
    clearHeartbeatIntervalFn,
    ...overrides,
  });

  return {
    clearedHandles,
    handles,
    heartbeatCalls,
    intervalCalls,
    leaseRepository,
    orchestrator,
    worker,
  };
}

describe("default task orchestrator workers", () => {
  it("includes due scheduled work in the production worker set", () => {
    expect(createDefaultTaskOrchestratorWorkers().map((worker) => worker.name)).toEqual([
      "event-retention",
      "restart-recovery",
      "due-scheduled-work",
      "due-auto-plan-generation",
      "recurring-work-block-expansion",
      "goal-review-due",
      "graph-advancement",
    ]);
  });

});

describe("task orchestrator lifecycle", () => {
  it("starts one polling loop and keeps startup idempotent", () => {
    const { intervalCalls, orchestrator } = createHarness();

    orchestrator.start();
    orchestrator.start();

    expect(orchestrator.isRunning()).toBe(true);
    expect(intervalCalls).toHaveLength(1);
    expect(intervalCalls[0]?.ms).toBe(config.intervalMs);
  });

  it("does not start when disabled", () => {
    const { intervalCalls, orchestrator } = createHarness({ config: { ...config, enabled: false } });

    orchestrator.start();

    expect(orchestrator.isRunning()).toBe(false);
    expect(intervalCalls).toHaveLength(0);
  });

  it("acquires the scheduler lease and runs registered workers on tick", async () => {
    const { leaseRepository, orchestrator, worker } = createHarness();

    await orchestrator.tick();

    expect(leaseRepository.acquire).toHaveBeenCalledWith({
      name: config.leaseName,
      ownerId: config.leaseOwnerId,
      ttlMs: config.leaseTtlMs,
      now: new Date("2026-05-17T10:00:00.000Z"),
    });
    expect(leaseRepository.renew).toHaveBeenCalledTimes(1);
    expect(worker).toHaveBeenCalledTimes(1);
    expect(leaseRepository.complete).toHaveBeenCalledWith(expect.objectContaining({
      worker: "test-worker",
      ownerId: config.leaseOwnerId,
      epoch: 1,
      status: "completed",
    }));
  });

  it("prevents a stale worker from reaching its domain write boundary after takeover", async () => {
    const controller = new AbortController();
    const domainWrite = mock(async () => undefined);
    const worker = {
      name: "guarded-domain-write",
      async run(context: Parameters<NonNullable<TaskOrchestratorOptions["workers"]>[number]["run"]>[0]) {
        controller.abort(new Error("takeover"));
        await expect(assertSchedulerWorkOwnership({
          ...context,
          signal: controller.signal,
          isLeaseCurrent: () => false,
        })).rejects.toThrow("takeover");
        if (!controller.signal.aborted) {
          await domainWrite();
        }
      },
    };
    const { orchestrator } = createHarness({ workers: [worker] });

    await orchestrator.tick();

    expect(domainWrite).not.toHaveBeenCalled();
  });

  it("heartbeats a worker that runs beyond the lease TTL", async () => {
    let releaseWorker!: () => void;
    let workerStarted!: () => void;
    const workerFinished = new Promise<void>((resolve) => { releaseWorker = resolve; });
    const workerStartedPromise = new Promise<void>((resolve) => { workerStarted = resolve; });
    const worker = mock(async () => {
      workerStarted();
      await workerFinished;
    });
    let elapsedMs = 0;
    const { heartbeatCalls, leaseRepository, orchestrator } = createHarness({
      config: { ...config, leaseTtlMs: 10 },
      workers: [{ name: "long-worker", run: worker }],
      now: () => new Date(new Date("2026-05-17T10:00:00.000Z").getTime() + elapsedMs),
    });

    const tick = orchestrator.tick();
    await workerStartedPromise;
    expect(heartbeatCalls).toHaveLength(1);
    expect(heartbeatCalls[0]?.ms).toBe(5);

    elapsedMs = 11;
    heartbeatCalls[0]?.fn();
    await Promise.resolve();
    expect(leaseRepository.renew).toHaveBeenCalledTimes(2);

    releaseWorker();
    await tick;
    expect(leaseRepository.complete).toHaveBeenCalledWith(expect.objectContaining({
      worker: "long-worker",
      epoch: 1,
      status: "completed",
    }));
  });

  it("aborts and fences a worker that loses its lease before it can complete", async () => {
    let workerStarted!: () => void;
    let aborted!: () => void;
    const workerStartedPromise = new Promise<void>((resolve) => { workerStarted = resolve; });
    const workerAbortedPromise = new Promise<void>((resolve) => { aborted = resolve; });
    const worker = mock(async ({ signal }: Parameters<NonNullable<TaskOrchestratorOptions["workers"]>[number]["run"]>[0]) => {
      workerStarted();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => {
        aborted();
        resolve();
      }, { once: true }));
    });
    let renewCalls = 0;
    const { heartbeatCalls, leaseRepository, orchestrator } = createHarness({
      workers: [{ name: "fenced-worker", run: worker }],
      leaseRepository: {
        acquire: mock(async () => ({ acquired: true as const, lease: lease() })),
        renew: mock(async () => {
          renewCalls += 1;
          return renewCalls === 1
            ? { renewed: true as const, lease: lease() }
            : { renewed: false as const, lease: lease({ ownerId: "worker-b", epoch: 2 }) };
        }),
        complete: mock(async () => true),
        release: mock(async () => false),
      },
    });

    const tick = orchestrator.tick();
    await workerStartedPromise;
    heartbeatCalls[0]?.fn();
    await Promise.resolve();
    await workerAbortedPromise;
    await tick;

    expect(leaseRepository.complete).not.toHaveBeenCalled();
    expect(leaseRepository.release).not.toHaveBeenCalled();
  });

  it("skips workers when another owner holds the lease", async () => {
    const { leaseRepository, orchestrator, worker } = createHarness({
      leaseRepository: {
        acquire: mock(async () => ({ acquired: false as const, lease: lease({ ownerId: "worker-b" }) })),
        renew: mock(async () => ({ renewed: true as const, lease: lease() })),
        complete: mock(async () => true),
        release: mock(async () => true),
      },
    });

    await orchestrator.tick();

    expect(worker).not.toHaveBeenCalled();
    expect(leaseRepository.renew).not.toHaveBeenCalled();
  });

  it("does not re-enter while a tick is in flight", async () => {
    let resolveWorker!: () => void;
    let signalWorkerStarted!: () => void;
    const pending = new Promise<void>((resolve) => { resolveWorker = resolve; });
    const workerStarted = new Promise<void>((resolve) => { signalWorkerStarted = resolve; });
    const worker = mock(async () => {
      signalWorkerStarted();
      await pending;
    });
    const { orchestrator } = createHarness({
      workers: [{ name: "slow-worker", run: worker }],
    });

    const firstTick = orchestrator.tick();
    await workerStarted;
    const reenteredTick = orchestrator.tick();

    expect(reenteredTick).toBe(firstTick);
    expect(worker).toHaveBeenCalledTimes(1);

    resolveWorker();
    await Promise.all([firstTick, reenteredTick]);
  });

  it("runs workers registered after startup", async () => {
    const extraWorker = mock(async () => undefined);
    const { orchestrator } = createHarness();

    orchestrator.registerWorker({ name: "extra-worker", run: extraWorker });
    await orchestrator.tick();
    expect(extraWorker).toHaveBeenCalledTimes(1);
  });

  it("isolates worker failures and continues the tick", async () => {
    const failingWorker = mock(async () => { throw new Error("worker unavailable"); });
    const nextWorker = mock(async () => undefined);
    const { leaseRepository, orchestrator } = createHarness({
      workers: [
        { name: "failing-worker", run: failingWorker },
        { name: "next-worker", run: nextWorker },
      ],
    });

    await orchestrator.tick();

    expect(failingWorker).toHaveBeenCalledTimes(1);
    expect(nextWorker).toHaveBeenCalledTimes(1);
    expect(leaseRepository.renew).toHaveBeenCalledTimes(2);
  });

  it("stops polling and releases a held lease", async () => {
    const { clearedHandles, leaseRepository, orchestrator } = createHarness();

    orchestrator.start();
    await orchestrator.tick();
    await orchestrator.stop();

    expect(orchestrator.isRunning()).toBe(false);
    expect(clearedHandles).toHaveLength(1);
    expect(leaseRepository.release).toHaveBeenCalledWith({
      name: config.leaseName,
      ownerId: config.leaseOwnerId,
      epoch: 1,
    });
  });

  it("waits for an active tick before releasing its lease", async () => {
    let resolveWorker!: () => void;
    const pendingWorker = new Promise<void>((resolve) => { resolveWorker = resolve; });
    const { leaseRepository, orchestrator } = createHarness({
      workers: [{ name: "pending-worker", run: async () => pendingWorker }],
    });

    orchestrator.start();
    const tick = orchestrator.tick();
    await Promise.resolve();
    const stop = orchestrator.stop();

    expect(leaseRepository.release).not.toHaveBeenCalled();
    resolveWorker();
    await Promise.all([tick, stop]);

    expect(leaseRepository.release).toHaveBeenCalledWith({
      name: config.leaseName,
      ownerId: config.leaseOwnerId,
      epoch: 1,
    });
  });
});
