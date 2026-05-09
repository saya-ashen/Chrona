import type { NodeRuntimeStatus } from "./runtime";

export interface ExecutionContextSnapshot {
  id: string;
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  graphSignature: string;
  refs?: Record<string, unknown>;
  promptSnapshot?: Record<string, unknown>;
  modelSnapshot?: Record<string, unknown>;
  runtimeSnapshot?: Record<string, unknown>;
  createdAt: string;
}

export interface NodeAttemptError {
  code: string;
  message: string;
  details?: unknown;
}

export type NodeAttemptStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface NodeAttempt {
  id: string;
  taskId: string;
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  executionContextSnapshotId: string;
  status: NodeAttemptStatus;
  idempotencyKey: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt?: string;
  error?: NodeAttemptError;
}

export interface NodeExecutionStateTransition {
  nodeId: string;
  from: NodeRuntimeStatus;
  to: NodeRuntimeStatus;
  reason?: string;
  attemptId?: string;
  timestamp: string;
}
