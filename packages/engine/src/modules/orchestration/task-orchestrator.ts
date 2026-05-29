import { readTaskOrchestratorConfig, type TaskOrchestratorConfig } from "./orchestrator-config";
import { runDueScheduledWorkWorker } from "./due-scheduled-work-worker";
import { runGraphAdvancementWorker } from "./graph-advancement-worker";
import { runRestartRecoveryWorker } from "./restart-recovery-worker";
import {
  acquireSchedulerLease,
  releaseSchedulerLease,
  renewSchedulerLease,
} from "./scheduler-lease-repository";

export type TaskOrchestratorWorker = {
  name: string;
  run: () => Promise<void> | void;
};

type LeaseRepository = {
  acquire: typeof acquireSchedulerLease;
  renew: typeof renewSchedulerLease;
  release: typeof releaseSchedulerLease;
};

export type TaskOrchestrator = {
  start: () => void;
  stop: () => Promise<void>;
  tick: () => Promise<void>;
  isRunning: () => boolean;
  registerWorker: (worker: TaskOrchestratorWorker) => void;
};

export type TaskOrchestratorOptions = {
  config?: TaskOrchestratorConfig;
  workers?: TaskOrchestratorWorker[];
  leaseRepository?: LeaseRepository;
  now?: () => Date;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export function createTaskOrchestrator(options: TaskOrchestratorOptions = {}): TaskOrchestrator {
  const config = options.config ?? readTaskOrchestratorConfig();
  const workers = new Map<string, TaskOrchestratorWorker>();
  const leaseRepository = options.leaseRepository ?? {
    acquire: acquireSchedulerLease,
    renew: renewSchedulerLease,
    release: releaseSchedulerLease,
  };
  const now = options.now ?? (() => new Date());
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let leaseHeld = false;

  for (const worker of options.workers ?? []) {
    workers.set(worker.name, worker);
  }

  async function tick() {
    if (inFlight) {
      return;
    }
    inFlight = true;
    try {
      const lease = await leaseRepository.acquire({
        name: config.leaseName,
        ownerId: config.leaseOwnerId,
        ttlMs: config.leaseTtlMs,
        now: now(),
      });
      if (!lease.acquired) {
        return;
      }
      leaseHeld = true;

      for (const worker of workers.values()) {
        await leaseRepository.renew({
          name: config.leaseName,
          ownerId: config.leaseOwnerId,
          ttlMs: config.leaseTtlMs,
          now: now(),
        });
        try {
          await worker.run();
        } catch (cause) {
          console.error("[task-orchestrator] worker failed", {
            worker: worker.name,
            error: cause instanceof Error ? cause.message : String(cause),
            stack: cause instanceof Error ? cause.stack : undefined,
          });
        }
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      if (timer || !config.enabled) {
        return;
      }
      if (config.tickOnStart) {
        void tick();
      }
      timer = setIntervalFn(() => {
        void tick();
      }, config.intervalMs);
    },
    async stop() {
      if (timer) {
        clearIntervalFn(timer);
        timer = null;
      }
      if (leaseHeld) {
        await leaseRepository.release(config.leaseName, config.leaseOwnerId);
        leaseHeld = false;
      }
    },
    tick,
    isRunning() {
      return timer !== null;
    },
    registerWorker(worker) {
      workers.set(worker.name, worker);
    },
  };
}

export function createDefaultTaskOrchestratorWorkers(): TaskOrchestratorWorker[] {
  return [
    {
      name: "restart-recovery",
      async run() {
        await runRestartRecoveryWorker();
      },
    },
    {
      name: "due-scheduled-work",
      async run() {
        await runDueScheduledWorkWorker();
      },
    },
    {
      name: "graph-advancement",
      async run() {
        await runGraphAdvancementWorker();
      },
    },
  ];
}

export function createDefaultTaskOrchestrator() {
  return createTaskOrchestrator({
    workers: createDefaultTaskOrchestratorWorkers(),
  });
}

const globalKey = Symbol.for("chrona.taskOrchestrator");

type GlobalWithTaskOrchestrator = typeof globalThis & {
  [globalKey]?: TaskOrchestrator;
};

export function getTaskOrchestrator() {
  const scopedGlobal = globalThis as GlobalWithTaskOrchestrator;
  if (!scopedGlobal[globalKey]) {
    scopedGlobal[globalKey] = createDefaultTaskOrchestrator();
  }
  return scopedGlobal[globalKey]!;
}

export function startTaskOrchestrator() {
  const orchestrator = getTaskOrchestrator();
  orchestrator.start();
  return orchestrator;
}
