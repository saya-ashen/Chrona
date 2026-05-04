import { autoStartScheduledPlanTasks } from "@/modules/commands/auto-start-scheduled-plan";

type AutoStartScheduler = {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
};

function readEnabledFlag() {
  const value =
    process.env.CHRONA_AUTO_START_SCHEDULER_ENABLED?.trim().toLowerCase() ??
    process.env.AUTO_START_SCHEDULER_ENABLED?.trim().toLowerCase();
  return value !== "0" && value !== "false";
}

function readIntervalMs() {
  const raw = Number(
    process.env.CHRONA_AUTO_START_SCHEDULER_INTERVAL_MS ??
    process.env.AUTO_START_SCHEDULER_INTERVAL_MS ??
    15000,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 15000;
}

function readTickOnStart() {
  const value =
    process.env.CHRONA_AUTO_START_SCHEDULER_TICK_ON_START?.trim().toLowerCase() ??
    process.env.AUTO_START_SCHEDULER_TICK_ON_START?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function createAutoStartScheduler(): AutoStartScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  const tick = async () => {
    if (inFlight) {
      return;
    }
    inFlight = true;
    try {
      const result = await autoStartScheduledPlanTasks();
      if (result.started.length > 0 || result.skipped.length > 0 || result.failed.length > 0) {
        console.log(
          "[auto-start-scheduler] tick completed",
          `started=${result.started.length}`,
          `skipped=${result.skipped.length}`,
          `failed=${result.failed.length}`,
        );
      }
    } catch (error) {
      console.error("[auto-start-scheduler] tick failed", error);
    } finally {
      inFlight = false;
    }
  };

  return {
    start() {
      if (timer || !readEnabledFlag()) {
        return;
      }
      if (readTickOnStart()) {
        void tick();
      }
      timer = setInterval(() => {
        void tick();
      }, readIntervalMs());
    },
    stop() {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = null;
    },
    isRunning() {
      return timer !== null;
    },
  };
}

const globalKey = Symbol.for("chrona.autoStartScheduler");

type GlobalWithScheduler = typeof globalThis & {
  [globalKey]?: AutoStartScheduler;
};

function getAutoStartScheduler() {
  const scopedGlobal = globalThis as GlobalWithScheduler;
  if (!scopedGlobal[globalKey]) {
    scopedGlobal[globalKey] = createAutoStartScheduler();
  }
  return scopedGlobal[globalKey]!;
}

export function startAutoStartScheduler() {
  const scheduler = getAutoStartScheduler();
  scheduler.start();
  return scheduler;
}
