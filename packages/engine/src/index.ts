export { createChronaEngine } from "./engine";
export type { ChronaEngine } from "./engine";
export {
  appendTaskWorkspaceEvent,
  publishTaskStateSnapshot,
  publishTaskStateUpdate,
  publishTaskWorkspaceUpdatedEvent,
  rebuildTaskProjection,
  subscribeToTaskProjectionEvents,
} from "./modules/projections";
export { resolveHeaderExecutionState, headerExecutionStateToStatePaths } from "./modules/tasks/get-task-header";
export { getCurrentExecution } from "./modules/plan-execution/use-cases/get-current-execution";
export {
  executionStatusFromGraphOutcome,
  executionStatusFromWaitKind,
  executionTransition,
  graphStatusForExecutionStatus,
  planRunStatusForExecutionStatus,
} from "./modules/plan-execution/execution-state-machine";
export { getLatestTaskPlanReadModel } from "./modules/plans/task-plan-read-model";
export { startAutoPlanGenerationForTask } from "./modules/plans/auto-generate-task-plan";
export {
  isTerminalControlKind,
  submitNodeResultActionFromControl,
  toolNameFromControlKind,
} from "./modules/agent-tools/node-result-action";
export type { TaskProjectionEvent, SpecPatch } from "./modules/projections";
export type {
  GraphExecutionEvent,
  PlanExecutionRuntimeEvent,
} from "./modules/plan-execution";
export type { TaskOrchestrator } from "./modules/orchestration/task-orchestrator";
export type { DashboardAiBriefState, DashboardAiBriefStatus } from "./modules/pages/dashboard-ai-surface";
export type { ChronaEngineLogger, ChronaEnginePorts } from "./ports";
export {
  ENGINE_ERROR_CODES,
  EngineError,
  isEngineError,
} from "./errors";
export type { EngineErrorCode } from "./errors";
export { handleControlAction, ControlRouteError } from "./modules/agent-tools";
export type { HandleControlActionInput, HandleControlActionResult } from "./modules/agent-tools";
export {
  mintRunToken,
  validateRunToken,
  revokeRunToken,
  recordTerminalAction,
  latestRecordedTerminalAction,
  findRecordedTerminalAction,
  DuplicateTerminalActionError,
} from "./modules/plan-execution/runtime/agent-control-store";
export type { RunTokenScope, RecordedTerminalAction } from "./modules/plan-execution/runtime/agent-control-store";
