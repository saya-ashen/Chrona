/**
 * Task orchestration owns durable scheduler lifecycle, leases, active run sync,
 * graph advancement, reconciliation, degraded retry, and runtime graph mutation.
 *
 * Keep orchestration decisions in this module. Existing scheduling,
 * runtime-sync, plan-execution, server route, and web layers should delegate to
 * orchestrator-owned contracts rather than re-deriving task execution truth.
 */
export {
  acquireSchedulerLease,
  releaseSchedulerLease,
  renewSchedulerLease,
} from "./scheduler-lease-repository";
export { listSchedulerEvents, recordSchedulerEvent } from "./scheduler-event-repository";
export { recordOrchestratorEvent } from "./scheduler-events";
export type { SchedulerEventDetails, SchedulerEventType } from "./scheduler-events";
export {
  createGraphMutation,
  listPendingGraphMutations,
  updateGraphMutationStatus,
} from "./graph-mutation-repository";
export {
  assertCurrentGraphVersion,
  createGraphVersion,
  getLatestGraphVersion,
} from "./graph-version-repository";
export {
  getTaskOrchestratorOwnerId,
  readTaskOrchestratorConfig,
} from "./orchestrator-config";
export type { TaskOrchestratorConfig } from "./orchestrator-config";
export {
  createDefaultTaskOrchestrator,
  createTaskOrchestrator,
  getTaskOrchestrator,
  startTaskOrchestrator,
} from "./task-orchestrator";
export type {
  TaskOrchestrator,
  TaskOrchestratorOptions,
  TaskOrchestratorWorker,
} from "./task-orchestrator";
export { reconcileTaskState } from "./reconcile-task-state";
export type { ReconciledTaskState } from "./reconcile-task-state";
export { deriveRepairActions, detectReconciliationIssues } from "./reconcile-invariants";
export { runDueScheduledWorkWorker } from "./due-scheduled-work-worker";
export { runActiveRunSyncWorker } from "./active-run-sync-worker";
export type { ActiveRunSyncWorkerResult } from "./active-run-sync-worker";
export { runGraphAdvancementWorker } from "./graph-advancement-worker";
export { runDegradedRetryWorker } from "./degraded-retry-worker";
export { runRestartRecoveryWorker } from "./restart-recovery-worker";
