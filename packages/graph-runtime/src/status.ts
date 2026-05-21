import {
  runtimeProgressStatusForNodes,
  runtimeProgressStatusForWaitKind,
} from "./types/runtime";
import type { EffectivePlanGraph, WaitKind } from "./types";

export type GraphExecutionStatus =
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled"
  | "unsupported";

export function mapWaitKindToGraphStatus(
  waitKind: WaitKind | undefined,
): GraphExecutionStatus {
  return runtimeProgressStatusForWaitKind(waitKind);
}

export function mapTerminalReasonToGraphStatus(
  effective: EffectivePlanGraph,
): GraphExecutionStatus {
  return runtimeProgressStatusForNodes(effective);
}
