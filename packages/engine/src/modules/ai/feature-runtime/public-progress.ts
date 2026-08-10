import type { AiFeatureRunStatus } from "@chrona/contracts/ai-feature-runtime";

export type AiFeaturePublicProgress = {
  phase: AiFeatureRunStatus;
  message: string;
};

const messages: Record<AiFeatureRunStatus, string> = {
  queued: "Queued",
  preparing_observations: "Preparing context",
  starting_provider: "Starting AI",
  running: "Running AI",
  validating: "Validating result",
  committing_result: "Saving result",
  completed: "Completed",
  needs_input: "Needs input",
  cannot_complete: "Cannot complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Maps only stable phase/message data; strips IDs, refs, prompts, payloads, and errors. */
export function toAiFeaturePublicProgress(phase: AiFeatureRunStatus): AiFeaturePublicProgress {
  return { phase, message: messages[phase] };
}

/** Projects a run-shaped value without leaking internal state to public SSE. */
export function projectAiFeaturePublicProgress(run: { status: AiFeatureRunStatus }): AiFeaturePublicProgress {
  return toAiFeaturePublicProgress(run.status);
}
