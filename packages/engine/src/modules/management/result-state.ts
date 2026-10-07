import { deriveWorkStateView, type DeriveWorkStateViewInput } from "@chrona/domain";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isCurrentCandidate(candidate: Record<string, unknown>, sourceRevision: number | null) {
  const spec = object(candidate.spec);
  return sourceRevision !== null && candidate.sourceRevision === sourceRevision &&
    typeof spec.root === "string" && Boolean(object(spec.elements)[spec.root]);
}

function activePhase(finalization: Record<string, unknown>) {
  if (finalization.status !== "Running") return null;
  return finalization.phase === "compose" || finalization.phase === "review" ? finalization.phase : null;
}

/** Only explicit, current finalized content is ready for acceptance. This
 * projection does not repair persistence or infer readiness from Task.status. */
export function managementResultFinalization(output?: Record<string, unknown> | null) {
  const manifest = object(output?.manifest), finalization = object(output?.finalization);
  const sourceRevision = typeof manifest.sourceRevision === "number" ? manifest.sourceRevision : null;
  const hasCandidate = isCurrentCandidate(object(output?.finalizedResult), sourceRevision);
  const status = ["Pending", "Running", "Ready", "Failed"].includes(String(finalization.status))
    ? finalization.status as "Pending" | "Running" | "Ready" | "Failed" : "Unavailable";
  const canAccept = status === "Ready" && hasCandidate && finalization.sourceRevision === sourceRevision;
  return {
    status: status === "Ready" && !canAccept ? "Pending" as const : status,
    sourceRevision, hasCandidate, canAccept,
    phase: activePhase(finalization),
    errorCode: status === "Failed" ? "RESULT_FINALIZATION_FAILED" : null,
  };
}

export function deriveManagementWorkState(input: DeriveWorkStateViewInput, result = managementResultFinalization()) {
  const base = deriveWorkStateView(input);
  if (base.state !== "result_ready" || result.canAccept) return base;
  const failed = result.status === "Failed", running = result.status === "Running";
  return {
    ...base,
    state: failed ? "result_failed" as const : running ? "finalizing" as const : "result_pending" as const,
    label: failed ? "Result finalization failed" : running ? "Finalizing result" : "Result not ready",
    tone: failed ? "danger" as const : "info" as const,
    nextActionLabel: failed ? "Retry result finalization; execution does not need to be repeated" : "Read the result finalization state before accepting",
    primaryActionId: failed ? "retry_result" as const : null,
    primaryActionDisabledReason: failed ? null : "The execution finished, but its result is not finalized.",
    attentionRequired: failed, showLiveProgress: running, canPause: false, canStop: false,
  };
}
