import type { ExecutionCheckpoint } from "@chrona/contracts/ai";

export function checkpointNodeId(input: {
  checkpoint: ExecutionCheckpoint;
  reason: string;
}) {
  if (!input.checkpoint.nodeId) throw new Error(input.reason);
  return input.checkpoint.nodeId;
}
