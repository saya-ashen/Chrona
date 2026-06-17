import type { NodeResultEvidence } from "./types";

export type GraphNodeExecutionEvidence = {
  sessionId?: string;
  runId?: string;
  runtimeName?: string;
  provider?: string;
  runtimeRunRef?: string | null;
  artifactIds?: string[];
  conversationEntryIds?: string[];
  eventIds?: string[];
};

export function normalizeResultEvidence(
  evidence: GraphNodeExecutionEvidence | undefined,
): NodeResultEvidence | undefined {
  if (!evidence) return undefined;
  return {
    sessionId: evidence.sessionId,
    runId: evidence.runId,
    runtimeName: evidence.runtimeName,
    provider: evidence.provider,
    runtimeRunRef: evidence.runtimeRunRef,
    artifactIds: evidence.artifactIds,
    conversationEntryIds: evidence.conversationEntryIds,
    eventIds: evidence.eventIds,
  };
}
