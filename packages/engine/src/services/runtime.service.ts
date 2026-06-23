import { getTaskOrchestrator, startTaskOrchestrator } from "../modules/orchestration";
import { listExecutionRuntimes } from "../modules/execution-runtime";

export function createRuntimeService() {
  return {
    listExecutionRuntimes: () => listExecutionRuntimes(),
    startTaskOrchestrator: () => startTaskOrchestrator(),
    /**
     * Run a single orchestrator tick on demand. Used only by the env-gated
     * E2E test-route seam so Playwright can drive the schedule→auto-execution
     * loop deterministically instead of waiting on the 15s setInterval. Calls
     * the same `tick()` the interval uses, so it acquires the lease and runs
     * the registered workers exactly once.
     */
    tickTaskOrchestrator: () => getTaskOrchestrator().tick(),
  };
}
