// Attempt + execution-context types are owned by @chrona/contracts/ai.
export type { NodeAttempt, ExecutionContextSnapshot } from "@chrona/contracts/ai";

import type { NodeRuntimeStatus } from "./runtime";

export type NodeAttemptStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface NodeAttemptError {
  code: string;
  message: string;
  details?: unknown;
}

export interface NodeExecutionStateTransition {
  nodeId: string;
  from: NodeRuntimeStatus;
  to: NodeRuntimeStatus;
  reason?: string;
  attemptId?: string;
  timestamp: string;
}
