import { createChronaEngine } from "@chrona/engine";

let schedulerStarted = false;
const engine = createChronaEngine();

export function bootstrapServerRuntime() {
  if (schedulerStarted) {
    return;
  }

  engine.runtime.startAutoStartScheduler();
  schedulerStarted = true;
}
