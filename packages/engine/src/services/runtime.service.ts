import { taskScheduling } from "../modules/scheduling";

export function createRuntimeService() {
  return {
    startAutoStartScheduler: () => taskScheduling.startAutoStartScheduler(),
  };
}
