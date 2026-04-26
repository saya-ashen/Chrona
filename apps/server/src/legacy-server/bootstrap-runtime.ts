import { startAutoStartScheduler } from "../modules/scheduler/auto-start-runner";

let schedulerStarted = false;

export function bootstrapServerRuntime() {
  if (schedulerStarted) {
    return;
  }

  startAutoStartScheduler();
  schedulerStarted = true;
}
