import type { GraphNodeExecutionEvidence } from "../evidence";
import type { GraphExecutionStatus } from "../status";
import type { CheckpointInputFields } from "@chrona/contracts/ai";
import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  ExecutionContextSnapshot,
  NodeActionForm,
  NodeAttempt,
  NodeResult,
  PlanGraph,
  WaitKind,
} from "@chrona/contracts/ai";

export type GraphExecutionTrigger = "manual" | "scheduler" | "system" | "auto";
export type GraphNodeExecutionResult =
  | { status: "started"; summary: string; evidence: GraphNodeExecutionEvidence; output?: unknown }
  | { status: "done"; summary: string; evidence: GraphNodeExecutionEvidence; output?: unknown; inputFields?: CheckpointInputFields; selectedBranch?: NodeResult["selectedBranch"]; deliverables?: NodeResult["deliverables"]; findings?: NodeResult["findings"]; decisions?: NodeResult["decisions"]; caveats?: NodeResult["caveats"]; nextActions?: NodeResult["nextActions"]; resultEvidence?: NodeResult["resultEvidence"] }
  | { status: "waiting_for_user"; prompt: string; reason: string; waitKind?: Extract<WaitKind, "user_input" | "manual_completion">; evidence?: GraphNodeExecutionEvidence; actionForm?: NodeActionForm }
  | { status: "waiting_for_approval"; prompt: string; reason: string; evidence?: GraphNodeExecutionEvidence }
  | { status: "blocked"; reason: string; evidence?: GraphNodeExecutionEvidence; actionForm?: NodeResult["actionForm"] }
  | { status: "replan_required"; reason: string; evidence?: GraphNodeExecutionEvidence; proposedPatch?: unknown }
  | { status: "failed"; error: string; evidence?: GraphNodeExecutionEvidence; details?: unknown };
type GraphSubmittedNodeResultIdentity = {
  expectedAttemptId?: string;
  runtimeRunRef?: string | null;
  providerRunId?: string | null;
};

export type GraphSubmittedNodeResult =
  | ({ nodeId: string; status: "done"; summary: string; evidence?: GraphNodeExecutionEvidence; output?: unknown; inputFields?: CheckpointInputFields; selectedBranch?: NodeResult["selectedBranch"]; deliverables?: NodeResult["deliverables"]; findings?: NodeResult["findings"]; decisions?: NodeResult["decisions"]; caveats?: NodeResult["caveats"]; nextActions?: NodeResult["nextActions"]; resultEvidence?: NodeResult["resultEvidence"] } & GraphSubmittedNodeResultIdentity)
  | ({ nodeId: string; status: "failed"; error: string; evidence?: GraphNodeExecutionEvidence } & GraphSubmittedNodeResultIdentity)
  | ({ nodeId: string; status: "blocked"; reason: string; actionForm?: NodeResult["actionForm"]; evidence?: GraphNodeExecutionEvidence } & GraphSubmittedNodeResultIdentity)
  | ({ nodeId: string; status: "cancelled"; reason?: string; evidence?: GraphNodeExecutionEvidence } & GraphSubmittedNodeResultIdentity);
export type GraphExecutionState = { graph: PlanGraph; attempts: NodeAttempt[]; results: NodeResult[]; executionContextSnapshots: ExecutionContextSnapshot[] };
export type GraphNodeExecutorInput<TContext = unknown> = { node: EffectivePlanNode; plan: EffectivePlanGraph; attempt: NodeAttempt; trigger: GraphExecutionTrigger; runtimeName: string; userInput?: string; inputFields?: CheckpointInputFields; context: TContext; signal?: AbortSignal };
export type GraphExecutionControl = { signal?: AbortSignal; shouldPause?: () => boolean };
export type GraphExecutionOutcome = { status: GraphExecutionStatus; currentNodeId: string | null; executedNodeIds: string[]; effective: EffectivePlanGraph; state: GraphExecutionState; waitKind?: WaitKind; message: string };
export type GraphNodeExecutor<TContext = unknown> = (input: GraphNodeExecutorInput<TContext>) => Promise<GraphNodeExecutionResult | null>;
