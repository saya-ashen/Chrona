import type { NodeAttempt } from "@chrona/contracts/ai";
import type { SyncPlanRunRuntimeResultInput } from "../../types";

export function externalResultForRuntimeRun(input: {
  attempt: NodeAttempt;
  mainSessionId: string;
  runtimeRunRef: string;
  status: SyncPlanRunRuntimeResultInput["status"];
  summary?: string;
  output?: unknown;
  error?: string;
}) {
  const evidence = {
    sessionId: input.mainSessionId,
    runId: input.runtimeRunRef,
  };

  if (input.status === "Completed") {
    return {
      nodeId: input.attempt.nodeId,
      status: "done" as const,
      summary:
        input.summary?.trim() ||
        `Runtime run ${input.runtimeRunRef} completed`,
      evidence,
      output: input.output,
    };
  }

  if (input.status === "Cancelled") {
    return {
      nodeId: input.attempt.nodeId,
      status: "cancelled" as const,
      reason:
        input.error?.trim() ||
        `Runtime run ${input.runtimeRunRef} was cancelled`,
      evidence,
    };
  }

  return {
    nodeId: input.attempt.nodeId,
    status: "failed" as const,
    error:
      input.error?.trim() || `Runtime run ${input.runtimeRunRef} failed`,
    evidence,
  };
}
