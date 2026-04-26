import { autoStartScheduledPlanTasks } from "@/modules/commands/auto-start-scheduled-plan";

type AutoStartScheduler = {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
};

function readEnabledFlag() {
  const raw = process.env.AUTO_START_SCHEDULER_ENABLED?.trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

function readIntervalMs() {
  const raw = Number(process.env.AUTO_START_SCHEDULER_INTERVAL_MS ?? 15000);
  return Number.isFinite(raw) && raw > 0 ? raw : 15000;
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
      await autoStartScheduledPlanTasks();
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

export function getAutoStartScheduler() {
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
