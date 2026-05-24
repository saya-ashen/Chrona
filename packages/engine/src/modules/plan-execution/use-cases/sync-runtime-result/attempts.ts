import type { NodeAttempt } from "@chrona/contracts/ai";
import type { RunningRuntimeAttempt } from "./types";

export function runtimeRunRefFromAttempt(attempt: NodeAttempt) {
  const output = (attempt as RunningRuntimeAttempt).runtimeSnapshot?.output;
  if (!output || typeof output !== "object") return null;

  const record = output as Record<string, unknown>;
  return typeof record.runtimeRunRef === "string" ? record.runtimeRunRef : null;
}

export function runningAttemptForRuntimeRun(input: {
  attempts: NodeAttempt[];
  runtimeRunRef: string;
}) {
  return input.attempts.find(
    (attempt) =>
      attempt.status === "running" &&
      runtimeRunRefFromAttempt(attempt) === input.runtimeRunRef,
  );
}

export function attemptForRuntimeRun(input: {
  attempts: NodeAttempt[];
  runtimeRunRef: string;
}) {
  return input.attempts.find(
    (attempt) => runtimeRunRefFromAttempt(attempt) === input.runtimeRunRef,
  );
}
