import { taskScheduling } from "../modules/scheduling";
import { listExecutionRuntimes } from "../modules/task-execution/registry";

export function createRuntimeService() {
  return {
    listExecutionRuntimes: () => listExecutionRuntimes(),
    startAutoStartScheduler: () => taskScheduling.startAutoStartScheduler(),
  };
}
