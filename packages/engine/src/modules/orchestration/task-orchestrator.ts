/* eslint-disable max-lines-per-function, complexity, @typescript-eslint/no-unnecessary-condition -- Orchestration keeps scheduler ownership and terminal transitions explicit. */
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
  completeSchedulerLeaseWork,
  releaseSchedulerLease,
  renewSchedulerLease,
} from "./scheduler-lease-repository";

const logger = createLogger("engine.orchestration.task-orchestrator");

export type TaskOrchestratorWorkerContext = {
  signal: AbortSignal;
  lease: {
    name: string;
    ownerId: string;
    epoch: number;
  };
  isLeaseCurrent: () => boolean;
};

export type TaskOrchestratorWorker = {
  name: string;
  run: (context: TaskOrchestratorWorkerContext) => Promise<void> | void;
};

type LeaseRepository = {
  acquire: typeof acquireSchedulerLease;
  renew: typeof renewSchedulerLease;
  complete: typeof completeSchedulerLeaseWork;
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
  setHeartbeatIntervalFn?: typeof setInterval;
  clearHeartbeatIntervalFn?: typeof clearInterval;
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
    complete: completeSchedulerLeaseWork,
    release: releaseSchedulerLease,
  };
  const now = options.now ?? (() => new Date());
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const setHeartbeatIntervalFn = options.setHeartbeatIntervalFn ?? setInterval;
  const clearHeartbeatIntervalFn = options.clearHeartbeatIntervalFn ?? clearInterval;
  const heartbeatIntervalMs = Math.max(1, Math.floor(config.leaseTtlMs / 2));
  let timer: ReturnType<typeof setInterval> | null = null;
  let tickPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let leaseHeld = false;
  let leaseEpoch: number | null = null;
  let activeAbortController: AbortController | null = null;
  let stopRequested = false;

  registerWorkers(workers, options.workers ?? []);

  function tick() {
    if (tickPromise) {
      return tickPromise;
    }

    tickPromise = (async () => {
      try {
        const acquired = await leaseRepository.acquire({
          name: config.leaseName,
          ownerId: config.leaseOwnerId,
          ttlMs: config.leaseTtlMs,
          now: now(),
        });
        if (!acquired.acquired) {
          return;
        }
        leaseHeld = true;
        leaseEpoch = acquired.lease.epoch;

        for (const worker of workers.values()) {
          if (stopRequested || leaseEpoch === null) {
            return;
          }

          const controller = new AbortController();
          activeAbortController = controller;
          let leaseCurrent = true;
          let renewalInFlight: Promise<void> | null = null;
          let heartbeat: ReturnType<typeof setInterval> | null = null;
          const currentEpoch = leaseEpoch;

          const loseLease = () => {
            if (!leaseCurrent) return;
            leaseCurrent = false;
            leaseHeld = false;
            controller.abort(new Error("Scheduler lease ownership was lost."));
          };
          const renewLease = () => {
            if (!leaseCurrent || renewalInFlight) return;
            renewalInFlight = (async () => {
              try {
                const renewal = await leaseRepository.renew({
                  name: config.leaseName,
                  ownerId: config.leaseOwnerId,
                  epoch: currentEpoch,
                  ttlMs: config.leaseTtlMs,
                  now: now(),
                });
                if (!renewal.renewed) {
                  loseLease();
                }
              } catch (cause) {
                logger.error("lease.heartbeat_failed", { worker: worker.name, error: cause });
                loseLease();
              } finally {
                renewalInFlight = null;
              }
            })();
          };

          renewLease();
          await renewalInFlight;
          if (!leaseCurrent || stopRequested) {
            controller.abort(new Error("Scheduler worker was stopped before it started."));
            return;
          }
          heartbeat = setHeartbeatIntervalFn(renewLease, heartbeatIntervalMs);

          let failure: unknown = null;
          try {
            await worker.run({
              signal: controller.signal,
              lease: { name: config.leaseName, ownerId: config.leaseOwnerId, epoch: currentEpoch },
              isLeaseCurrent: () => leaseCurrent && !controller.signal.aborted,
            });
          } catch (cause) {
            failure = cause;
          } finally {
            if (heartbeat) {
              clearHeartbeatIntervalFn(heartbeat);
            }
            await renewalInFlight;
            activeAbortController = null;
          }

          if (!leaseCurrent || stopRequested || controller.signal.aborted) {
            continue;
          }

          const completed = await leaseRepository.complete({
            name: config.leaseName,
            ownerId: config.leaseOwnerId,
            epoch: currentEpoch,
            worker: worker.name,
            status: failure ? "failed" : "completed",
            error: failure instanceof Error ? failure.message : failure ? String(failure) : undefined,
            now: now(),
          });
          if (!completed) {
            loseLease();
            return;
          }
          if (failure) {
            const taskId = failure instanceof TaskPlanGenerationInFlightError ? failure.taskId : null;
            const workBlockId = failure instanceof TaskPlanGenerationInFlightError ? failure.workBlockId : null;
            logger.error("worker.failed", {
              worker: worker.name,
              error: failure,
              taskId,
              workBlockId,
            });
          }
        }
      } finally {
        activeAbortController = null;
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
      stopRequested = false;
      stopPromise = null;
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
          stopRequested = true;
          if (timer) {
            clearIntervalFn(timer);
            timer = null;
          }
          activeAbortController?.abort(new Error("Task orchestrator stopped."));
          await tickPromise;
          if (leaseHeld && leaseEpoch !== null) {
            await leaseRepository.release({
              name: config.leaseName,
              ownerId: config.leaseOwnerId,
              epoch: leaseEpoch,
            });
            leaseHeld = false;
            leaseEpoch = null;
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
      async run(workContext) {
        await archiveExpiredEventRecords({ workContext });
      },
    },
    {
      name: "restart-recovery",
      async run(workContext) {
        await runRestartRecoveryWorker({ workContext });
      },
    },
    {
      name: "due-scheduled-work",
      async run(workContext) {
        await runDueScheduledWorkWorker({ workContext });
      },
    },
    {
      name: "due-auto-plan-generation",
      async run(workContext) {
        await runDueAutoPlanGenerationWorker({ workContext });
      },
    },
    {
      name: "recurring-work-block-expansion",
      async run(workContext) {
        await runRecurringWorkBlockExpansionWorker({ workContext });
      },
    },
    {
      name: "goal-review-due",
      async run(workContext) {
        await runGoalReviewDueWorker({ workContext });
      },
    },
    {
      name: "graph-advancement",
      async run(workContext) {
        await runGraphAdvancementWorker({ workContext });
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
