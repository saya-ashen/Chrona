import type { SyncPlanRunRuntimeResultInput } from "../types";

/** A provider callback that targets a no-longer-active execution attempt. */
export class StaleRuntimeResultSyncError extends Error {
  readonly code = "STALE_RUNTIME_RESULT" as const;

  constructor(
    readonly input: Pick<SyncPlanRunRuntimeResultInput, "taskId" | "runtimeRunRef">,
    readonly reason: "duplicate" | "inactive_session" | "missing_attempt",
  ) {
    super(`Runtime result sync is stale (${reason}) for ${input.runtimeRunRef}`);
    this.name = "StaleRuntimeResultSyncError";
  }
}

export function isStaleRuntimeResultSyncError(value: unknown): value is StaleRuntimeResultSyncError {
  return value instanceof StaleRuntimeResultSyncError;
}
