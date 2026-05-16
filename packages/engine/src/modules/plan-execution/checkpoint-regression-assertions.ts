export const LEGACY_CHECKPOINT_RESULT_ERROR = "OpenClaw did not return review_checkpoint_node_result";

export type CheckpointRegressionEvidence = {
  scenarioId: string;
  expected: string;
  actual: unknown;
  visibleText?: string;
  logs?: string[];
  errorSummary?: string;
};

export function collectCheckpointRegressionText(evidence: CheckpointRegressionEvidence) {
  return [
    evidence.scenarioId,
    evidence.expected,
    evidence.visibleText,
    evidence.errorSummary,
    ...evidence.logs ?? [],
    typeof evidence.actual === "string" ? evidence.actual : JSON.stringify(evidence.actual),
  ].filter(Boolean).join("\n");
}

export function assertNoLegacyCheckpointResultError(evidence: CheckpointRegressionEvidence) {
  const haystack = collectCheckpointRegressionText(evidence);

  if (haystack.includes(LEGACY_CHECKPOINT_RESULT_ERROR)) {
    throw new Error(`${evidence.scenarioId}: ${LEGACY_CHECKPOINT_RESULT_ERROR}`);
  }
}
