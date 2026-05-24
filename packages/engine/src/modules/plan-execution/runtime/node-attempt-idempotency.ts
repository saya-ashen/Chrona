export type NodeAttemptIdentityInput = {
  taskId: string;
  planId: string;
  nodeId: string;
  nodeLayerId: string;
  executionEpoch: number;
  attemptNumber: number;
};

export function deriveNodeAttemptIdempotencyKey(input: NodeAttemptIdentityInput): string {
  return [
    "task-plan-node-attempt",
    input.taskId,
    input.planId,
    input.nodeId,
    input.nodeLayerId,
    String(input.executionEpoch),
    String(input.attemptNumber),
  ].join(":");
}

export function deriveProviderRunIdempotencyKey(input: NodeAttemptIdentityInput): string {
  return ["provider-run", deriveNodeAttemptIdempotencyKey(input)].join(":");
}
