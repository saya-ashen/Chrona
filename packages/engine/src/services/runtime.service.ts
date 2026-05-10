import { startAutoStartScheduler } from "../modules/scheduler/auto-start-runner";

export function createRuntimeService() {
  return {
    startAutoStartScheduler,
  };
}
