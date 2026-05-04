import { startAutoStartScheduler } from "@chrona/engine";

let schedulerStarted = false;

export function bootstrapServerRuntime() {
  if (schedulerStarted) {
    return;
  }

  startAutoStartScheduler();
  schedulerStarted = true;
}
