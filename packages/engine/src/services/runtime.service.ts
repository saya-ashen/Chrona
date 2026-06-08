import { startTaskOrchestrator } from "../modules/orchestration";
import { listExecutionRuntimes } from "../modules/execution-runtime";

export function createRuntimeService() {
  return {
    listExecutionRuntimes: () => listExecutionRuntimes(),
    startTaskOrchestrator: () => startTaskOrchestrator(),
  };
}
