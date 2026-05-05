import type { EffectivePlanNode, EffectivePlanGraph, PlanPatch } from "@chrona/contracts/ai";

export type NodeExecutionEvidence = {
  sessionId?: string;
  runId?: string;
  childTaskId?: string;
  childSessionId?: string;
  artifactIds?: string[];
  conversationEntryIds?: string[];
  eventIds?: string[];
};

export type NodeExecutionResult =
  | { status: "done"; summary: string; evidence: NodeExecutionEvidence; output?: unknown }
  | { status: "waiting_for_user"; prompt: string; reason: string; evidence?: NodeExecutionEvidence }
  | { status: "waiting_for_approval"; prompt: string; reason: string; evidence?: NodeExecutionEvidence }
  | { status: "blocked"; reason: string; evidence?: NodeExecutionEvidence }
  | { status: "replan_required"; reason: string; evidence?: NodeExecutionEvidence; proposedPatch?: PlanPatch }
  | { status: "child_running"; summary: string; evidence: NodeExecutionEvidence; output?: unknown }
  | { status: "failed"; error: string; evidence?: NodeExecutionEvidence };

export interface NodeExecutor {
  readonly nodeType: "task" | "checkpoint" | "condition" | "wait";
  canExecute(node: EffectivePlanNode): boolean;
  execute(input: NodeExecutorInput): Promise<NodeExecutionResult>;
}

export interface NodeExecutorInput {
  taskId: string;
  planId: string;
  mainSession: {
    id: string;
    taskId: string;
    sessionKey: string;
  };
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  trigger: "manual" | "scheduler" | "system" | "auto";
  runtimeName: string;
}
