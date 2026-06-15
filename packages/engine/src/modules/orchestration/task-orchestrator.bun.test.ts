import { describe, expect, it, mock } from "bun:test";
import { createDefaultTaskOrchestratorWorkers, createTaskOrchestrator, type TaskOrchestratorOptions } from "@/modules/orchestration/task-orchestrator";
import { type TaskOrchestratorConfig } from "@/modules/orchestration/orchestrator-config";

const config: TaskOrchestratorConfig = {
  enabled: true,
  intervalMs: 2_500,
  tickOnStart: false,
  leaseName: "task-orchestrator",
  leaseOwnerId: "worker-a",
  leaseTtlMs: 30_000,
};

function lease(overrides: Partial<{ ownerId: string; expiresAt: Date }> = {}) {
  const now = new Date("2026-05-17T10:00:00.000Z");
  return {
    name: config.leaseName,
    ownerId: overrides.ownerId ?? config.leaseOwnerId,
    expiresAt: overrides.expiresAt ?? new Date("2026-05-17T10:00:30.000Z"),
    heartbeatAt: now,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createHarness(overrides: Partial<TaskOrchestratorOptions> = {}) {
  const intervalCalls: Array<{ fn: () => void; ms: number }> = [];
  const handles: Timer[] = [];
  const clearedHandles: Timer[] = [];
  const worker = mock(async () => undefined);
  const leaseRepository: NonNullable<TaskOrchestratorOptions["leaseRepository"]> = {
    acquire: mock(async () => ({ acquired: true as const, lease: lease() })),
    renew: mock(async () => ({ renewed: true as const, lease: lease() })),
    release: mock(async () => true),
  };
  const setIntervalFn = ((fn: TimerHandler, ms?: number) => {
    if (typeof fn === "function") {
      intervalCalls.push({ fn: () => { (fn as () => void)(); }, ms: Number(ms ?? 0) });
    }
    const handle = setInterval(() => undefined, 60_000);
    handles.push(handle);
    return handle;
  }) as unknown as typeof setInterval;
  const clearIntervalFn = ((handle?: Parameters<typeof clearInterval>[0]) => {
    if (handle) {
      clearedHandles.push(handle as Timer);
      clearInterval(handle);
    }
  }) as typeof clearInterval;

  const orchestrator = createTaskOrchestrator({
    config,
    workers: [{ name: "test-worker", run: worker }],
    leaseRepository,
    now: () => new Date("2026-05-17T10:00:00.000Z"),
    setIntervalFn,
    clearIntervalFn,
    ...overrides,
  });

  return { clearedHandles, handles, intervalCalls, leaseRepository, orchestrator, worker };
}

describe("default task orchestrator workers", () => {
  it("includes due scheduled work in the production worker set", () => {
    expect(createDefaultTaskOrchestratorWorkers().map((worker) => worker.name)).toEqual([
      "restart-recovery",
      "due-scheduled-work",
      "due-auto-plan-generation",
      "recurring-work-block-expansion",
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
  });

  it("skips workers when another owner holds the lease", async () => {
    const { leaseRepository, orchestrator, worker } = createHarness({
      leaseRepository: {
        acquire: mock(async () => ({ acquired: false as const, lease: lease({ ownerId: "worker-b" }) })),
        renew: mock(async () => ({ renewed: true as const, lease: lease() })),
        release: mock(async () => true),
      },
    });

    await orchestrator.tick();

    expect(worker).not.toHaveBeenCalled();
    expect(leaseRepository.renew).not.toHaveBeenCalled();
  });

  it("does not re-enter while a tick is in flight", async () => {
    let resolveWorker!: () => void;
    const pending = new Promise<void>((resolve) => { resolveWorker = resolve; });
    const { orchestrator, worker } = createHarness({
      workers: [{ name: "slow-worker", run: mock(async () => { await pending; }) }],
    });

    const firstTick = orchestrator.tick();
    await Promise.resolve();
    await orchestrator.tick();

    expect(worker).not.toHaveBeenCalled();

    resolveWorker();
    await firstTick;
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
    expect(leaseRepository.release).toHaveBeenCalledWith(config.leaseName, config.leaseOwnerId);
  });
});
