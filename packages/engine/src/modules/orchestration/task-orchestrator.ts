import { readTaskOrchestratorConfig, type TaskOrchestratorConfig } from "./orchestrator-config";
import { archiveExpiredEventRecords } from "@/modules/events";
import { runDueAutoPlanGenerationWorker } from "./due-auto-plan-generation-worker";
import { runDueScheduledWorkWorker } from "./due-scheduled-work-worker";
import { runGraphAdvancementWorker } from "./graph-advancement-worker";
import { runGoalReviewDueWorker } from "./goal-review-due-worker";
import { runRecurringWorkBlockExpansionWorker } from "./recurring-work-block-expansion-worker";
import { runRestartRecoveryWorker } from "./restart-recovery-worker";
import { TaskPlanGenerationInFlightError } from "@/modules/plans/task-plan-generation-registry";
import { createLogger } from "@chrona/logging";

import {
  acquireSchedulerLease,
  releaseSchedulerLease,
  renewSchedulerLease,
} from "./scheduler-lease-repository";

const logger = createLogger("engine.orchestration.task-orchestrator");

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

function registerWorkers(
  workers: Map<string, TaskOrchestratorWorker>,
  configuredWorkers: TaskOrchestratorWorker[],
) {
  for (const worker of configuredWorkers) {
    workers.set(worker.name, worker);
  }
}

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
  let tickPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let leaseHeld = false;

  registerWorkers(workers, options.workers ?? []);
  function tick() {
    if (tickPromise) {
      return tickPromise;
    }

    tickPromise = (async () => {
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
          const renewal = await leaseRepository.renew({
            name: config.leaseName,
            ownerId: config.leaseOwnerId,
            ttlMs: config.leaseTtlMs,
            now: now(),
          });
          if (!renewal.renewed) {
            leaseHeld = false;
            return;
          }
          try {
            await worker.run();
          } catch (cause) {
            const taskId = cause instanceof TaskPlanGenerationInFlightError ? cause.taskId : null;
            const workBlockId = cause instanceof TaskPlanGenerationInFlightError ? cause.workBlockId : null;
            logger.error("worker.failed", {
              worker: worker.name,
              error: cause,
              taskId,
              workBlockId,
            });
          }
        }
      } finally {
        tickPromise = null;
      }
    })();

    return tickPromise;
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
      if (!stopPromise) {
        stopPromise = (async () => {
          if (timer) {
            clearIntervalFn(timer);
            timer = null;
          }
          await tickPromise;
          if (leaseHeld) {
            await leaseRepository.release(config.leaseName, config.leaseOwnerId);
            leaseHeld = false;
          }
        })();
      }
      await stopPromise;
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
      name: "event-retention",
      async run() {
        await archiveExpiredEventRecords();
      },
    },
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
      name: "due-auto-plan-generation",
      async run() {
        await runDueAutoPlanGenerationWorker();
      },
    },
    {
      name: "recurring-work-block-expansion",
      async run() {
        await runRecurringWorkBlockExpansionWorker();
      },
    },
    {
      name: "goal-review-due",
      async run() {
        await runGoalReviewDueWorker();
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
