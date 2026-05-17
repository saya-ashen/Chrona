import { startTaskOrchestrator } from "@/modules/orchestration/task-orchestrator";

export function createAutoStartScheduler() {
  return startTaskOrchestrator();
}

export function startAutoStartScheduler() {
  return startTaskOrchestrator();
}
