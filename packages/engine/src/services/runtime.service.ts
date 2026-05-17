import { startTaskOrchestrator } from "../modules/orchestration";
import { listExecutionRuntimes } from "../modules/task-execution/registry";

export function createRuntimeService() {
  return {
    listExecutionRuntimes: () => listExecutionRuntimes(),
    startTaskOrchestrator: () => startTaskOrchestrator(),
  };
}
