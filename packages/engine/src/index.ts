export { createChronaEngine } from "./engine";
export type { ChronaEngine } from "./engine";
export { appendTaskWorkspaceEvent, subscribeToTaskProjectionEvents } from "./modules/projections";
export { startAutoPlanGenerationForTask } from "./modules/plans/auto-generate-task-plan";
export type { TaskProjectionEvent, SpecPatch } from "./modules/projections";
export type {
  GraphExecutionEvent,
  PlanExecutionRuntimeEvent,
} from "./modules/plan-execution";
export type { TaskOrchestrator } from "./modules/orchestration/task-orchestrator";
export type { ChronaEngineLogger, ChronaEnginePorts } from "./ports";
export {
  ENGINE_ERROR_CODES,
  EngineError,
  isEngineError,
} from "./errors";
export type { EngineErrorCode } from "./errors";
