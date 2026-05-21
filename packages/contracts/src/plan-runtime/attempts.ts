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

export interface NodeExecutionAttempt {
  id: string;
  planRunId: string;
  nodeId: string;
  nodeLayerId?: string;
  executionContextSnapshotId?: string;
  idempotencyKey?: string;
  attemptNumber: number;
  status: "running" | "succeeded" | "failed" | "cancelled";
  inputSnapshot?: unknown;
  outputSnapshot?: unknown;
  toolCalls?: unknown[];
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  startedAt: string;
  finishedAt?: string;
}

export interface NodeAttempt {
  id: string;
  taskId: string;
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  executionContextSnapshotId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  idempotencyKey: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  runtimeSnapshot?: Record<string, unknown>;
}
