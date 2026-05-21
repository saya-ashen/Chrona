import type { GraphDispatchOutcome } from "@chrona/graph-runtime";
import type { NodeAttempt } from "@chrona/contracts/ai";

export type RunningRuntimeAttempt = NodeAttempt & {
  runtimeSnapshot?: { output?: unknown } | null;
};

export type SyncedRuntimeOutcome = GraphDispatchOutcome;
