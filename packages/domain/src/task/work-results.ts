export function workResultScopeKey(occurrenceId: string | null): string {
  return occurrenceId === null ? "task" : `occurrence:${occurrenceId}`;
}

export function workResultRevision(result: { id: string; editRevision: number }): string {
  return `result-v1:${result.id}:${result.editRevision}`;
}

export function workResultWritesAllowed(task: { status: string; definitionStatus: string }, workspaceStatus: string): boolean {
  return workspaceStatus === "Active" && task.status !== "Done" && task.status !== "Cancelled" && task.definitionStatus !== "Stopped";
}

/** Availability and review facts are independent of execution and claimed completion. */
export function deriveWorkResultState(input: {
  headVersionId: string | null; acceptedVersionId: string | null; selectedVersionId: string;
  readiness: string; unavailableRequiredArtifacts: number;
}) {
  const current = input.headVersionId === input.selectedVersionId;
  const accepted = input.acceptedVersionId === input.selectedVersionId;
  const contentReady = input.readiness === "ready" || input.readiness === "ready_with_caveats";
  return {
    current, accepted, newerVersionPending: input.acceptedVersionId !== null && input.acceptedVersionId !== input.headVersionId,
    canAcceptContent: current && contentReady && input.unavailableRequiredArtifacts === 0,
    // Authorization and lifecycle checks are applied by the use case, never this claim alone.
    readinessIsSourceReported: true as const,
  };
}
