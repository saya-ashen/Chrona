export type ExecutionFence = {
  planRunId: string;
  ownerId: string;
  epoch: number;
};

export type ExecutionFenceSubject = {
  id: string;
  executionOwnerId: string | null;
  executionEpoch: number;
};

export function isExecutionFenceValid(
  fence: ExecutionFence,
  subject: ExecutionFenceSubject,
): boolean {
  return (
    fence.planRunId === subject.id &&
    fence.ownerId === subject.executionOwnerId &&
    fence.epoch === subject.executionEpoch
  );
}

export function assertExecutionFence(
  fence: ExecutionFence,
  subject: ExecutionFenceSubject,
): void {
  if (!isExecutionFenceValid(fence, subject)) {
    throw new Error("Stale execution fence rejected");
  }
}
