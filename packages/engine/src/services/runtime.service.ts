import { startAutoStartScheduler } from "../modules/scheduling/auto-start-runner";

export function createRuntimeService() {
  return {
    startAutoStartScheduler,
  };
}
